import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { after, beforeEach, test } from 'node:test';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-card-tokens-'));
process.env.DATA_DIR = directory;
process.env.DATABASE_FILE = 'tokens.sqlite';
process.env.SCRYFALL_REQUEST_DELAY_MS = '0';

const { db, closeDatabase } = await import('../src/db/database.js');
const { getCardTokens, tokenFromScryfall } = await import('../src/services/card-token-service.js');
const { setExternalApiCache } = await import('../src/services/external-api-cache-service.js');

const sourceId = '0969d7f3-cec5-4118-adb1-ff957eedf6ab';
const badgerId = '4e42cb2e-578f-4fec-a9a4-33b95b78229c';
const treasureId = '10000000-0000-4000-8000-000000000001';
const doubleId = '10000000-0000-4000-8000-000000000002';
const image = 'https://cards.scryfall.io/normal/front/4/e/badger.jpg';
const badger = {
  object: 'card', id: badgerId, name: 'Badger', layout: 'token',
  type_line: 'Token Creature — Badger', mana_cost: '', colors: ['G'],
  oracle_text: '', keywords: [], power: '3', toughness: '3', image_uris: { normal: image }
};
const reference = (id = badgerId, overrides = {}) => ({
  object: 'related_card', id, component: 'token', name: id === badgerId ? 'Badger' : 'Treasure',
  type_line: id === badgerId ? 'Token Creature — Badger' : 'Token Artifact — Treasure',
  uri: 'https://untrusted.invalid/never-request-this', ...overrides
});
const response = (value, status = 200) => Response.json(value, { status });

function insertCard(id, raw) {
  db.prepare(`INSERT INTO cards (id, scryfall_id, oracle_id, name, search_name, raw_json)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, raw.id, `oracle-${id}`, raw.name, raw.name.toLowerCase(), JSON.stringify(raw));
}

function setParts(parts) {
  db.prepare('UPDATE cards SET raw_json = ? WHERE id = 1')
    .run(JSON.stringify({ object: 'card', id: sourceId, name: 'Greensleeves, Maro-Sorcerer', all_parts: parts }));
}

function protectedData() {
  return ['cards', 'collection_items', 'wanted_items', 'wanted_item_decks', 'decks', 'deck_cards',
    'deck_card_tags', 'deck_tags', 'deck_card_groups', 'deck_card_group_members', 'card_user_metadata',
    'card_printing_catalog', 'card_printing_catalog_state', 'discovery_marks']
    .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);
}

beforeEach(() => {
  db.exec(`DELETE FROM external_api_cache; DELETE FROM decks; DELETE FROM collection_items;
    DELETE FROM wanted_items; DELETE FROM cards;`);
  insertCard(1, { object: 'card', id: sourceId, name: 'Greensleeves, Maro-Sorcerer', all_parts: [reference()] });
  insertCard(2, { object: 'card', id: '20000000-0000-4000-8000-000000000001', name: 'Keep original card' });
  db.exec(`INSERT INTO collection_items (card_id, quantity, finish, location) VALUES (1, 1, 'foil', 'Binder');
    INSERT INTO collection_items (card_id, quantity, finish, location) VALUES (2, 3, 'nonfoil', 'Box');
    INSERT INTO wanted_items (card_id, quantity, notes) VALUES (2, 2, 'Keep');
    INSERT INTO decks (id,name) VALUES (1,'Keep deck');
    INSERT INTO deck_cards (deck_id,card_id,quantity,role,note) VALUES (1,1,1,'commander','Keep note');`);
});

after(() => {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('token lookup validates the parent and does not fetch for cards without token references', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected request'); });
  for (const value of [0, -1, null, true, 'bad']) await assert.rejects(getCardTokens(value), { status: 400 });
  await assert.rejects(getCardTokens(9999), { status: 404 });
  setParts([reference(treasureId, { component: 'combo_piece' }), reference(doubleId, { component: 'meld_result' })]);
  const before = protectedData();
  assert.deepEqual(await getCardTokens(1), []);
  assert.deepEqual(await getCardTokens(2), []);
  assert.deepEqual(protectedData(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM external_api_cache').get().n, 0);
});

test('Greensleeves resolves its exact Badger token once without changing cards, ownership or decks', async (t) => {
  setParts([reference(), reference(badgerId.toUpperCase()), reference(sourceId), reference(treasureId, { component: 'combo_piece' })]);
  const before = protectedData();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url);
    assert.equal(url, `https://api.scryfall.com/cards/${badgerId}`);
    return response(badger);
  });
  const tokens = await getCardTokens(1);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].scryfallId, badgerId);
  assert.equal(tokens[0].name, 'Badger');
  assert.equal(tokens[0].power, '3');
  assert.equal(tokens[0].toughness, '3');
  assert.deepEqual(tokens[0].colors, ['G']);
  assert.equal(tokens[0].images.normal, image);
  assert.equal(tokens[0].available, true);
  assert.equal(tokens[0].id, undefined, 'token never receives a local card ID');
  assert.equal(requests.length, 1);
  assert.deepEqual(protectedData(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cards WHERE scryfall_id = ?').get(badgerId).n, 0);
});

test('multiple token results isolate failures, reject malformed references and retry only missing data', async (t) => {
  setParts([reference(), reference(treasureId), reference('../private', { name: 'Bad reference' }), null]);
  let treasureAvailable = false;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url);
    if (url.endsWith(badgerId)) return response(badger);
    assert.equal(url, `https://api.scryfall.com/cards/${treasureId}`);
    return treasureAvailable
      ? response({ object: 'card', id: treasureId, name: 'Treasure', type_line: 'Token Artifact — Treasure', colors: [], oracle_text: '{T}, Sacrifice this token: Add one mana of any color.', layout: 'token' })
      : response({ details: 'Token tijdelijk niet gevonden.' }, 404);
  });
  const before = protectedData();
  const first = await getCardTokens(1);
  assert.deepEqual(first.map((token) => token.available), [true, false, false]);
  assert.equal(first[1].name, 'Treasure');
  assert.equal(first[2].scryfallId, null);
  assert.match(first[2].error, /geen geldige Scryfall/);
  treasureAvailable = true;
  const second = await getCardTokens(1);
  assert.deepEqual(second.map((token) => token.available), [true, true, false]);
  assert.equal(second[1].power, null);
  assert.equal(second[1].toughness, null);
  assert.equal(second[1].images.normal, null);
  assert.deepEqual(requests, [`https://api.scryfall.com/cards/${badgerId}`, `https://api.scryfall.com/cards/${treasureId}`, `https://api.scryfall.com/cards/${treasureId}`]);
  assert.deepEqual(protectedData(), before);
});

test('local token data and shared cached responses remain usable without a live Scryfall connection', async (t) => {
  insertCard(3, badger);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Offline'); });
  const before = protectedData();
  assert.equal((await getCardTokens(1))[0].available, true);
  assert.deepEqual(protectedData(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM external_api_cache').get().n, 0);
  db.prepare('DELETE FROM cards WHERE id = 3').run();
  setExternalApiCache(`card:id:${badgerId}`, 'scryfall', badger, 60_000);
  assert.equal((await getCardTokens(1))[0].available, true);
  db.prepare('UPDATE external_api_cache SET expires_at = 0').run();
  assert.equal((await getCardTokens(1))[0].available, true, 'existing stale-cache fallback keeps token readable offline');
});

test('concurrent detail requests share an upstream request and later requests reuse the persistent cache', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(badger); });
  const [first, second] = await Promise.all([getCardTokens(1), getCardTokens(1)]);
  assert.deepEqual(first, second);
  assert.deepEqual(await getCardTokens(1), first);
  assert.equal(calls, 1);
});

test('wrong token identities are never returned or persisted as cards and bad cached payloads can recover', async (t) => {
  let wrong = true;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return response(wrong ? { ...badger, id: treasureId, name: 'Wrong token' } : badger);
  });
  const before = protectedData();
  const failed = await getCardTokens(1);
  assert.equal(failed[0].available, false);
  assert.equal(failed[0].name, 'Badger');
  assert.match(failed[0].error, /verwachte token/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM external_api_cache').get().n, 0);
  wrong = false;
  assert.equal((await getCardTokens(1))[0].available, true);
  assert.equal(calls, 2, 'retry refetches rather than reusing the rejected payload');
  assert.deepEqual(protectedData(), before);
});

test('invalid legacy local token metadata falls back to Scryfall without rewriting the local printing', async (t) => {
  insertCard(3, { ...badger, type_line: 'Creature — Badger', layout: 'normal' });
  const before = protectedData();
  t.mock.method(globalThis, 'fetch', async () => response(badger));
  assert.equal((await getCardTokens(1))[0].typeLine, 'Token Creature — Badger');
  assert.deepEqual(protectedData(), before);
});

test('token faces preserve independent text, colors, zero stats and safe images', () => {
  const mapped = tokenFromScryfall({
    object: 'card', id: doubleId, name: 'Germ // Bird', layout: 'double_faced_token',
    card_faces: [
      { name: 'Germ', type_line: 'Token Creature — Phyrexian Germ', oracle_text: '', colors: ['B'], power: '0', toughness: '0', image_uris: { normal: image } },
      { name: 'Bird', type_line: 'Token Creature — Bird', oracle_text: 'Flying', colors: ['W'], power: '1', toughness: '1', keywords: ['Flying'], image_uris: { large: 'https://cards.scryfall.io/large/back/example.jpg' } }
    ]
  }, doubleId);
  assert.equal(mapped.cardFaces.length, 2);
  assert.equal(mapped.cardFaces[0].power, '0');
  assert.deepEqual(mapped.cardFaces.map((face) => face.colors), [['B'], ['W']]);
  assert.equal(mapped.cardFaces[1].oracle_text, 'Flying');
  assert.equal(mapped.images.backNormal, 'https://cards.scryfall.io/large/back/example.jpg');
  assert.equal(mapped.power, null, 'face stats are not incorrectly combined');
  for (const url of ['http://cards.scryfall.io/x.jpg', 'https://evil.example/x.jpg', 'https://cards.scryfall.io.evil.example/x.jpg', 'https://user:pass@cards.scryfall.io/x.jpg', 'https://cards.scryfall.io:8443/x.jpg', 'javascript:alert(1)']) {
    const safe = tokenFromScryfall({ ...badger, image_uris: { normal: url }, card_faces: [{ name: 'Badger', type_line: badger.type_line, image_uris: { normal: url } }] }, badgerId);
    assert.equal(safe.available, true);
    assert.equal(safe.images.normal, null);
    assert.equal(safe.cardFaces[0].image_uris.normal, null);
  }
  for (const raw of [null, [], {}, { ...badger, id: treasureId }, { ...badger, name: '' }, { ...badger, layout: 'normal', type_line: 'Creature — Badger' }]) {
    assert.throws(() => tokenFromScryfall(raw, badgerId), { status: 502 });
  }
});

test('malformed saved metadata reports a recoverable data error without external requests or writes', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected request'); });
  for (const raw of ['broken JSON', '[]', '{"all_parts":{}}', JSON.stringify({
    object: 'card', id: treasureId, name: 'Wrong source card', all_parts: [reference()]
  })]) {
    db.prepare('UPDATE cards SET raw_json = ? WHERE id = 1').run(raw);
    const before = protectedData();
    await assert.rejects(getCardTokens(1), { status: 502 });
    assert.deepEqual(protectedData(), before);
  }
});

test('token HTTP route exposes GET results under the real client URL without write access', async (t) => {
  let express;
  try { ({ default: express } = await import('express')); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    t.skip('Installeer Express om de HTTP-integratietest uit te voeren.');
    return;
  }
  insertCard(3, badger);
  const { cardsReadRouter } = await import('../src/routes/cards.js');
  const app = express();
  app.use('/api/read/cards', cardsReadRouter);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { message: error.message } }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const before = protectedData();
  const found = await fetch(`${base}/api/read/cards/1/tokens`);
  assert.equal(found.status, 200);
  assert.equal(found.headers.get('cache-control'), 'no-store');
  assert.equal((await found.json()).data[0].scryfallId, badgerId);
  assert.deepEqual((await (await fetch(`${base}/api/read/cards/2/tokens`)).json()).data, []);
  assert.equal((await fetch(`${base}/api/read/cards/9999/tokens`)).status, 404);
  assert.deepEqual(protectedData(), before);
});
