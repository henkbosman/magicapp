import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-discovery-deck-membership-'));
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
  source: Readable.from([JSON.stringify({ meta: { date: '2026-10-03', version: '5.3.0+deck-membership-test' }, data })]),
  databasePath: candidatePath, sourceUrl: 'fixture://deck-membership.json', sourceSha256: 'e'.repeat(64)
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

test('no selection and an empty deck leave the full catalog unhighlighted', () => {
  for (const deckId of [undefined, null, '', ' ', '2', 2]) {
    const result = search({ deckId });
    assert.equal(result.total, fixtureCards.length);
    assert.equal(result.query.deckId, Number(deckId) === 2 ? 2 : null);
    assert.deepEqual(names(result), fixtureCards.map((item) => item.name).sort());
    assert.ok(result.items.every((item) => item.inDeck === false));
  }
  const otherDeck = search({ deckId: 3 });
  assert.equal(otherDeck.total, fixtureCards.length);
  assert.deepEqual(otherDeck.items.filter((item) => item.inDeck).map((item) => item.name), [tide.name]);
});

test('deck membership covers every role, commander references, quantities and other printings', () => {
  const query = { deckId: '1' };
  const first = search(query);
  assert.equal(first.total, fixtureCards.length);
  assert.deepEqual(first.items.filter((item) => item.inDeck).map((item) => item.name).sort(), existing.map((item) => item.name).sort());
  assert.deepEqual(first.items.filter((item) => !item.inDeck).map((item) => item.name).sort(), remaining.map((item) => item.name).sort());
  assert.equal(first.query.deckId, 1);
  assert.ok(!Object.hasOwn(first.query, '_deckCards'), 'internal identities must not leak into the public query');
  assert.ok(!Object.hasOwn(first.query, 'excludeDeckId'), 'the public query uses the canonical deckId');
  // Removing one printing does not clear membership while another remains.
  db.exec('DELETE FROM deck_cards WHERE deck_id = 1 AND card_id = 1;');
  assert.equal(search({ deckId: 1, name: existing[0].name }).items[0].inDeck, true);
  db.exec('DELETE FROM deck_cards WHERE deck_id = 1 AND card_id = 30;');
  assert.equal(search({ deckId: 1, name: existing[0].name }).items[0].inDeck, false);
});

test('deck selection never changes result ordering, pagination, totals or total pages', () => {
  for (const sort of ['name', 'mana', 'relevance']) {
    for (let page = 1; page <= Math.ceil(fixtureCards.length / 2); page += 1) {
      const input = { sort, page, limit: 2 };
      const baseline = search(input);
      const selected = search({ ...input, deckId: 1 });
      assert.equal(selected.total, baseline.total);
      assert.equal(selected.totalPages, baseline.totalPages);
      assert.equal(selected.page, baseline.page);
      assert.deepEqual(selected.items.map(({ inDeck, ...item }) => item), baseline.items.map(({ inDeck, ...item }) => item));
    }
  }
});

test('all reactive facets remain identical when a deck is selected alongside real filters', () => {
  const query = { deckId: 1, type: 'Instant' };
  const options = cardCatalogOptions(query, cardDiscoveryContext(query));
  assert.deepEqual(options, cardCatalogOptions({ type: 'Instant' }));
  assert.deepEqual(counts(options, 'types'), { artifact: 1, creature: 1, instant: 10 });
  assert.deepEqual(counts(options, 'abilities'), { flashback: 8, kicker: 1, storm: 1 });
  assert.deepEqual(counts(options, 'keywords'), { flashback: 8, kicker: 1, storm: 1 });
  assert.deepEqual(counts(options, 'colors'), { g: 9, u: 1 });
  assert.deepEqual(counts(options, 'manaValues'), { 2: 9, 4: 1 });
  assert.deepEqual(counts(options, 'legalities'), { commander: 10 });
  assert.deepEqual(counts(options, 'effects'), { draw: 10, graveyard: 8 });
  assert.deepEqual(options.subtypes, []);
  assert.deepEqual(options.tutorTargets, []);
  assert.deepEqual(options.tokenPowers, []);
  assert.deepEqual(options.tokenToughnesses, []);
  assert.deepEqual(options.tokenTypes, []);
  const creatures = { ...query, type: 'Creature' };
  const tokenOptions = cardCatalogOptions(creatures, cardDiscoveryContext(creatures));
  assert.deepEqual(tokenOptions, cardCatalogOptions({ type: 'Creature' }));
  assert.deepEqual(counts(tokenOptions, 'tokenPowers'), { 2: 1 });
  assert.deepEqual(counts(tokenOptions, 'tokenToughnesses'), { 2: 1 });
  assert.deepEqual(counts(tokenOptions, 'tokenTypes'), { beast: 1, creature: 1 });
});

test('manual marks and deck membership stay independent in results and reactive facets', () => {
  for (const item of [existing[0], tide, druid]) {
    setDiscoveryMark({ name: item.name, scryfallOracleId: item.identifiers.scryfallOracleId, marked: true });
  }
  const query = { deckId: 1, marked: 1, sort: 'mana', limit: 1 };
  const result = search(query);
  assert.equal(result.total, 3);
  assert.equal(result.items[0].name, druid.name);
  assert.equal(result.items[0].marked, true);
  assert.equal(result.items[0].inDeck, false);
  const member = search({ ...query, page: 2 }).items[0];
  assert.equal(member.name, existing[0].name);
  assert.equal(member.marked, true);
  assert.equal(member.inDeck, true);
  assert.deepEqual(names(search({ ...query, page: 3 })), [tide.name]);
  const unmarkedMember = search({ deckId: 1, name: existing[1].name }).items[0];
  assert.equal(unmarkedMember.marked, false);
  assert.equal(unmarkedMember.inDeck, true);
  const options = cardCatalogOptions({ ...query, type: 'Instant' }, cardDiscoveryContext(query));
  assert.deepEqual(options, cardCatalogOptions({ marked: 1, type: 'Instant' }, cardDiscoveryContext()));
  assert.deepEqual(counts(options, 'types'), { creature: 1, instant: 2 });
  assert.deepEqual(counts(options, 'abilities'), { flashback: 1, storm: 1 });
});

test('identity matching uses normalized whole-name fallback only when either side lacks an Oracle ID', () => {
  function members(cards) {
    return searchCardCatalog({ deckId: 99 }, { selectedDeck: { id: 99, cards } }).items.filter((item) => item.inDeck).map((item) => item.name);
  }
  assert.ok(members([{ name: "EOWYN'S GIFT", scryfallOracleId: null }]).includes(fallback.name));
  assert.ok(members([{ name: "EOWYN'S GIFT", scryfallOracleId: tide.identifiers.scryfallOracleId }]).includes(fallback.name));
  assert.ok(members([{ name: existing[0].name.toUpperCase(), scryfallOracleId: null }]).includes(existing[0].name));
  const namesake = members([{ name: tide.name, scryfallOracleId: existing[0].identifiers.scryfallOracleId }]);
  assert.ok(!namesake.includes(tide.name), 'different known Oracle identities must not be merged by name');
  assert.ok(namesake.includes(existing[0].name), 'Oracle ID wins even when the supplied name differs');
  assert.ok(!namesake.includes(fallback.name), 'an unrelated NULL Oracle ID is not a deck member');
  assert.ok(!members([{ name: 'Gift', scryfallOracleId: null }]).includes(fallback.name), 'fallback must not match a name fragment');
});

test('legacy exclusion links select visual deck membership and canonical values take precedence', () => {
  assert.deepEqual(search({ excludeDeckId: '001' }), search({ deckId: 1 }));
  assert.deepEqual(cardDiscoveryContext({ excludeDeckId: 1 }), cardDiscoveryContext({ deckId: 1 }));
  for (const deckId of [undefined, null, '', ' ']) {
    const query = { deckId, excludeDeckId: 1 };
    const result = search(query);
    assert.equal(result.query.deckId, null);
    assert.ok(result.items.every((item) => item.inDeck === false));
    assert.equal(cardDiscoveryContext(query).selectedDeck, null);
  }
  assert.deepEqual(search({ deckId: 3, excludeDeckId: 1 }), search({ deckId: 3 }));
  assert.deepEqual(search({ deckId: 1, excludeDeckId: 'invalid' }), search({ deckId: 1 }));
  assert.throws(() => cardDiscoveryContext({ deckId: 'invalid', excludeDeckId: 1 }), (error) => error.status === 400);
});

test('invalid IDs and deleted or unavailable deck contexts never silently clear deck membership', () => {
  for (const key of ['deckId', 'excludeDeckId']) {
    for (const id of [-1, 0, 1.2, '1.2', '1e0', '0x1', 'abc', '1 OR 1=1', true, {}, [], ['1'], '9007199254740992']) {
      const query = { [key]: id };
      for (const action of [() => cardDiscoveryContext(query), () => searchCardCatalog(query), () => cardCatalogOptions(query)]) {
        assert.throws(action, (error) => error.status === 400, `${key}: ${JSON.stringify(id)}`);
      }
    }
  }
  assert.throws(() => cardDiscoveryContext({ deckId: 404 }), (error) => error.status === 404 && /deck/u.test(error.message));
  for (const action of [searchCardCatalog, cardCatalogOptions]) {
    assert.throws(() => action({ deckId: 1 }), (error) => error.status === 404);
    assert.throws(() => action({ deckId: 1 }, { selectedDeck: { id: 2, cards: [] } }), (error) => error.status === 404);
  }
  db.exec('DELETE FROM decks WHERE id = 2;');
  assert.throws(() => cardDiscoveryContext({ deckId: 2 }), (error) => error.status === 404);
});

test('fresh context updates membership after additions without hiding cards or writing either database during discovery', () => {
  const query = { deckId: 1 };
  const before = search(query);
  const optionsBefore = cardCatalogOptions(query, cardDiscoveryContext(query));
  assert.equal(before.items.find((item) => item.name === druid.name).inDeck, false);
  db.prepare('INSERT INTO deck_cards (deck_id, card_id, quantity, role) VALUES (1, 10, 1, ?)').run('main');
  const schemaBefore = db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all();
  const changedBefore = db.prepare('SELECT total_changes() AS total').get().total;
  const hash = () => createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'catalog.sqlite'))).digest('hex');
  const hashBefore = hash();
  const updated = search(query);
  assert.equal(updated.items.find((item) => item.name === druid.name).inDeck, true);
  assert.equal(updated.total, before.total);
  assert.deepEqual(names(updated), names(before));
  assert.deepEqual(cardCatalogOptions(query, cardDiscoveryContext(query)), optionsBefore);
  assert.equal(db.prepare('SELECT total_changes() AS total').get().total, changedBefore);
  assert.deepEqual(db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all(), schemaBefore);
  assert.deepEqual(db.prepare('PRAGMA database_list').all().map((row) => row.name), ['main']);
  assert.equal(hash(), hashBefore);
});

test('HTTP search annotates selected-deck membership, keeps all facets and validates both query spellings', async (t) => {
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
  const result = await fetch(`${origin}/search?deckId=1&limit=2`);
  assert.equal(result.status, 200);
  const payload = (await result.json()).data;
  assert.equal(payload.total, fixtureCards.length);
  assert.equal(payload.items.length, 2);
  assert.ok(payload.items.every((item) => item.inDeck === true));
  const legacy = await fetch(`${origin}/search?excludeDeckId=1&limit=2`);
  assert.deepEqual((await legacy.json()).data, payload);
  const options = await fetch(`${origin}/options?deckId=1&type=Instant`);
  assert.equal(options.status, 200);
  assert.deepEqual(counts((await options.json()).data, 'abilities'), { flashback: 8, kicker: 1, storm: 1 });
  for (const endpoint of ['search', 'options']) {
    for (const key of ['deckId', 'excludeDeckId']) {
      assert.equal((await fetch(`${origin}/${endpoint}?${key}=bad`)).status, 400);
      assert.equal((await fetch(`${origin}/${endpoint}?${key}=404`)).status, 404);
    }
  }
});
