import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-discovery-deck-exclusion-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'collection.sqlite';
process.env.CARD_CATALOG_DATABASE_FILE = 'catalog.sqlite';

const { db, closeDatabase } = await import('../src/db/database.js');
const { cardDiscoveryContext } = await import('../src/services/card-discovery-context-service.js');
const { setDiscoveryMark } = await import('../src/services/discovery-mark-service.js');
const { buildCardCatalogDatabase } = await import('../src/card-catalog/builder.js');
const { activateCardCatalog, closeCardCatalogDatabase } = await import('../src/card-catalog/database.js');
const { searchCardCatalog, cardCatalogOptions } = await import('../src/card-catalog/repository.js');

function card(name, number, overrides = {}) {
  return {
    name, manaValue: 2, manaCost: '{1}{G}', colors: ['G'], colorIdentity: ['G'],
    type: 'Instant', types: ['Instant'], subtypes: [], supertypes: [],
    keywords: ['Flashback'], text: 'Draw a card.', legalities: { commander: 'Legal' },
    identifiers: number ? { scryfallOracleId: `a0000000-0000-4000-8000-${String(number).padStart(12, '0')}` } : {},
    layout: 'normal', ...overrides
  };
}

const existing = [
  card('Main Bloom', 1),
  card('Commander Reference', 2),
  card('Partner Reference', 3),
  card('Commander Row', 4),
  card('Partner Row', 5),
  card('Companion Row', 6),
  card('Sideboard Row', 7),
  card('Maybeboard Row', 8)
];
const tide = card('Remaining Tide', 9, { colors: ['U'], colorIdentity: ['U'], manaValue: 4, keywords: ['Storm'] });
const druid = card('Remaining Druid', 10, {
  type: 'Creature — Elf Druid', types: ['Creature'], subtypes: ['Elf', 'Druid'],
  manaValue: 1, keywords: ['Landfall'], text: 'Landfall — Create a 2/2 green Beast creature token.'
});
const stone = card('Remaining Stone', 11, {
  type: 'Artifact', types: ['Artifact'], colors: [], colorIdentity: [],
  manaValue: 6, keywords: [], text: 'Add {C}.'
});
const fallback = card('Éowyn’s Gift', null, { keywords: ['Kicker'] });
const remaining = [tide, druid, stone, fallback];
const fixtureCards = [...existing, ...remaining];
const data = Object.fromEntries(fixtureCards.map((item) => [item.name, [item]]));
data[existing[0].name].push({ ...existing[0], side: 'a' });
const candidatePath = path.join(dataDir, 'candidate.sqlite');
await buildCardCatalogDatabase({
  source: Readable.from([JSON.stringify({ meta: { date: '2026-10-03', version: '5.3.0+deck-exclusion-test' }, data })]),
  databasePath: candidatePath, sourceUrl: 'fixture://deck-exclusion.json', sourceSha256: 'e'.repeat(64)
});
activateCardCatalog(candidatePath);

beforeEach(() => {
  db.exec('DELETE FROM discovery_marks; DELETE FROM deck_cards; DELETE FROM decks; DELETE FROM cards;');
  const insert = db.prepare('INSERT INTO cards (id, scryfall_id, oracle_id, name, search_name, raw_json) VALUES (?, ?, ?, ?, ?, ?)');
  fixtureCards.forEach((item, index) => insert.run(
    index + 1, `printing-${index}`, item.identifiers.scryfallOracleId || null, item.name, item.name.toLowerCase(), '{}'
  ));
  db.exec(`
    INSERT INTO decks (id, name, commander_card_id, second_commander_card_id) VALUES (1, 'Existing cards', 2, 3);
    INSERT INTO decks (id, name) VALUES (2, 'Empty deck'), (3, 'Other deck');
    INSERT INTO deck_cards (deck_id, card_id, quantity, role) VALUES
      (1, 1, 17, 'main'), (1, 4, 1, 'commander'), (1, 5, 1, 'partner'),
      (1, 6, 1, 'companion'), (1, 7, 1, 'sideboard'), (1, 8, 1, 'maybeboard'),
      (3, 9, 1, 'main');
  `);
  // A different printing (and historical name) still denotes the same card.
  insert.run(30, 'other-printing', existing[0].identifiers.scryfallOracleId.toUpperCase(), 'Old Main Bloom', 'old main bloom', '{}');
  db.prepare('INSERT INTO deck_cards (deck_id, card_id, quantity, role) VALUES (1, 30, 1, ?)').run('sideboard');
});

after(() => {
  closeCardCatalogDatabase();
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function search(input = {}) {
  return searchCardCatalog(input, cardDiscoveryContext(input));
}

function names(result) {
  return result.items.map((item) => item.name).sort();
}

function counts(options, facet) {
  return Object.fromEntries(options[facet].map((entry) => [entry.value.toLowerCase(), entry.count]));
}

test('no selection and an empty deck leave the full catalog available', () => {
  for (const excludeDeckId of [undefined, null, '', ' ', '2', 2]) {
    const result = search({ excludeDeckId });
    assert.equal(result.total, fixtureCards.length);
    assert.equal(result.query.excludeDeckId, Number(excludeDeckId) === 2 ? 2 : null);
    assert.deepEqual(names(result), fixtureCards.map((item) => item.name).sort());
  }
  assert.equal(search({ excludeDeckId: 3 }).total, fixtureCards.length - 1);
  assert.ok(names(search({ excludeDeckId: 3 })).includes(existing[0].name));
});

test('deck exclusion covers every role, commander references, quantities and other printings before pagination', () => {
  const query = { excludeDeckId: '1', sort: 'mana', limit: 2 };
  const first = search(query);
  assert.equal(first.total, remaining.length);
  assert.equal(first.totalPages, 2);
  assert.deepEqual(first.items.map((item) => item.name), [druid.name, fallback.name]);
  assert.deepEqual(names(search({ ...query, page: 2 })), [stone.name, tide.name].sort());
  assert.equal(first.query.excludeDeckId, 1);
  assert.ok(!Object.hasOwn(first.query, '_excludedCards'), 'internal identities must not leak into the public query');
  assert.ok(!names(search(query)).includes(existing[0].name));
  // Removing one printing does not make a card available while another remains.
  db.exec('DELETE FROM deck_cards WHERE deck_id = 1 AND card_id = 1;');
  assert.equal(search({ excludeDeckId: 1, name: existing[0].name }).total, 0);
});

test('all reactive facets retain the selected deck exclusion alongside their other dimensions', () => {
  const query = { excludeDeckId: 1, type: 'Instant' };
  const options = cardCatalogOptions(query, cardDiscoveryContext(query));
  assert.deepEqual(counts(options, 'types'), { artifact: 1, creature: 1, instant: 2 });
  assert.deepEqual(counts(options, 'abilities'), { kicker: 1, storm: 1 });
  assert.deepEqual(counts(options, 'keywords'), { kicker: 1, storm: 1 });
  assert.deepEqual(counts(options, 'colors'), { g: 1, u: 1 });
  assert.deepEqual(counts(options, 'manaValues'), { 2: 1, 4: 1 });
  assert.deepEqual(counts(options, 'legalities'), { commander: 2 });
  assert.deepEqual(counts(options, 'effects'), { draw: 2 });
  assert.deepEqual(options.subtypes, []);
  assert.deepEqual(options.tutorTargets, []);
  assert.deepEqual(options.tokenPowers, []);
  assert.deepEqual(options.tokenToughnesses, []);
  assert.deepEqual(options.tokenTypes, []);
  const creatures = { ...query, type: 'Creature' };
  const tokenOptions = cardCatalogOptions(creatures, cardDiscoveryContext(creatures));
  assert.deepEqual(counts(tokenOptions, 'tokenPowers'), { 2: 1 });
  assert.deepEqual(counts(tokenOptions, 'tokenToughnesses'), { 2: 1 });
  assert.deepEqual(counts(tokenOptions, 'tokenTypes'), { beast: 1, creature: 1 });
});

test('marked cards and deck exclusion combine before result counts and facet counts', () => {
  for (const item of [existing[0], tide, druid]) {
    setDiscoveryMark({ name: item.name, scryfallOracleId: item.identifiers.scryfallOracleId, marked: true });
  }
  const query = { excludeDeckId: 1, marked: 1, sort: 'mana', limit: 1 };
  const result = search(query);
  assert.equal(result.total, 2);
  assert.equal(result.items[0].name, druid.name);
  assert.equal(result.items[0].marked, true);
  assert.deepEqual(names(search({ ...query, page: 2 })), [tide.name]);
  const options = cardCatalogOptions({ ...query, type: 'Instant' }, cardDiscoveryContext(query));
  assert.deepEqual(counts(options, 'types'), { creature: 1, instant: 1 });
  assert.deepEqual(counts(options, 'abilities'), { storm: 1 });
});

test('identity matching uses normalized whole-name fallback only when either side lacks an Oracle ID', () => {
  function excluded(cards) {
    return names(searchCardCatalog({ excludeDeckId: 99 }, { excludedDeck: { id: 99, cards } }));
  }
  assert.ok(!excluded([{ name: "EOWYN'S GIFT", scryfallOracleId: null }]).includes(fallback.name));
  assert.ok(!excluded([{ name: "EOWYN'S GIFT", scryfallOracleId: tide.identifiers.scryfallOracleId }]).includes(fallback.name));
  assert.ok(!excluded([{ name: existing[0].name.toUpperCase(), scryfallOracleId: null }]).includes(existing[0].name));
  const namesake = excluded([{ name: tide.name, scryfallOracleId: existing[0].identifiers.scryfallOracleId }]);
  assert.ok(namesake.includes(tide.name), 'different known Oracle identities must not be merged by name');
  assert.ok(!namesake.includes(existing[0].name), 'Oracle ID wins even when the supplied name differs');
  assert.ok(namesake.includes(fallback.name), 'unrelated NULL Oracle IDs must survive a negated SQL identity match');
  assert.ok(excluded([{ name: 'Gift', scryfallOracleId: null }]).includes(fallback.name), 'fallback must not match a name fragment');
});

test('invalid IDs and deleted or unavailable deck contexts never silently remove the exclusion', () => {
  for (const excludeDeckId of [-1, 0, 1.2, '1.2', '1e0', '0x1', 'abc', '1 OR 1=1', true, {}, [], ['1'], '9007199254740992']) {
    const query = { excludeDeckId };
    for (const action of [() => cardDiscoveryContext(query), () => searchCardCatalog(query), () => cardCatalogOptions(query)]) {
      assert.throws(action, (error) => error.status === 400, JSON.stringify(excludeDeckId));
    }
  }
  assert.throws(() => cardDiscoveryContext({ excludeDeckId: 404 }), (error) => error.status === 404 && /deck/u.test(error.message));
  for (const action of [searchCardCatalog, cardCatalogOptions]) {
    assert.throws(() => action({ excludeDeckId: 1 }), (error) => error.status === 404);
    assert.throws(() => action({ excludeDeckId: 1 }, { excludedDeck: { id: 2, cards: [] } }), (error) => error.status === 404);
  }
  db.exec('DELETE FROM decks WHERE id = 2;');
  assert.throws(() => cardDiscoveryContext({ excludeDeckId: 2 }), (error) => error.status === 404);
});

test('fresh context reflects deck additions immediately without writing either database during discovery', () => {
  assert.ok(names(search({ excludeDeckId: 1 })).includes(druid.name));
  db.prepare('INSERT INTO deck_cards (deck_id, card_id, quantity, role) VALUES (1, 10, 1, ?)').run('main');
  const schemaBefore = db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all();
  const changedBefore = db.prepare('SELECT total_changes() AS total').get().total;
  const hash = () => createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'catalog.sqlite'))).digest('hex');
  const hashBefore = hash();
  const query = { excludeDeckId: 1 };
  assert.ok(!names(search(query)).includes(druid.name));
  assert.deepEqual(counts(cardCatalogOptions(query, cardDiscoveryContext(query)), 'types'), { artifact: 1, instant: 2 });
  assert.equal(db.prepare('SELECT total_changes() AS total').get().total, changedBefore);
  assert.deepEqual(db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all(), schemaBefore);
  assert.deepEqual(db.prepare('PRAGMA database_list').all().map((row) => row.name), ['main']);
  assert.equal(hash(), hashBefore);
});

test('HTTP search and reactive options use the selected deck and report invalid or deleted selections', async (t) => {
  let express;
  try {
    ({ default: express } = await import('express'));
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    t.skip('Installeer de Express-afhankelijkheid om de HTTP-integratietest uit te voeren.');
    return;
  }
  const { cardCatalogReadRouter } = await import('../src/routes/card-catalog.js');
  const app = express();
  app.use('/api/read/card-catalog', cardCatalogReadRouter);
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}/api/read/card-catalog`;
  const result = await fetch(`${origin}/search?excludeDeckId=1&limit=2`);
  assert.equal(result.status, 200);
  const payload = (await result.json()).data;
  assert.equal(payload.total, remaining.length);
  assert.equal(payload.items.length, 2);
  const options = await fetch(`${origin}/options?excludeDeckId=1&type=Instant`);
  assert.equal(options.status, 200);
  assert.deepEqual(counts((await options.json()).data, 'abilities'), { kicker: 1, storm: 1 });
  for (const endpoint of ['search', 'options']) {
    assert.equal((await fetch(`${origin}/${endpoint}?excludeDeckId=bad`)).status, 400);
    assert.equal((await fetch(`${origin}/${endpoint}?excludeDeckId=404`)).status, 404);
  }
});
