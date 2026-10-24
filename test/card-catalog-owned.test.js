import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { after, beforeEach, test } from 'node:test';
import { discoverySearchParams } from '../public/js/views/card-discovery.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-catalog-owned-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'collection.sqlite';
process.env.CARD_CATALOG_DATABASE_FILE = 'catalog.sqlite';

const { db, closeDatabase } = await import('../src/db/database.js');
const { cardDiscoveryContext } = await import('../src/services/card-discovery-context-service.js');
const { setDiscoveryMark } = await import('../src/services/discovery-mark-service.js');
const { buildCardCatalogDatabase } = await import('../src/card-catalog/builder.js');
const { activateCardCatalog, closeCardCatalogDatabase, withCardCatalog } = await import('../src/card-catalog/database.js');
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
const alpha = card('Alpha Bloom', 1);
const beta = card('Beta Tide', 2, { colors: ['U'], colorIdentity: ['U'], manaValue: 4, keywords: ['Storm'] });
const gamma = card('Gamma Druid', 3, {
  type: 'Creature — Elf Druid', types: ['Creature'], subtypes: ['Elf', 'Druid'],
  manaValue: 1, keywords: ['Landfall'], text: 'Landfall — Create a 2/2 green Beast creature token.'
});
const delta = card('Delta Stone', 4, {
  type: 'Artifact', types: ['Artifact'], colors: [], colorIdentity: [], manaValue: 6,
  keywords: [], text: '{T}: Add {C}.'
});
const fallback = card('Éowyn’s Gift', null, { manaValue: 3, keywords: ['Cycling'] });
const fixtureCards = [alpha, beta, gamma, delta, fallback,
  card('Zero Copies', 6), card('Wanted Only', 7), card('Deck Only', 8)];
const data = Object.fromEntries(fixtureCards.map((item) => [item.name, [item]]));
data[alpha.name].push({ ...alpha, side: 'a' });
const candidatePath = path.join(dataDir, 'candidate.sqlite');
await buildCardCatalogDatabase({
  source: Readable.from([JSON.stringify({ meta: { date: '2026-10-22', version: '5.3.0+owned-test' }, data })]),
  databasePath: candidatePath, sourceUrl: 'fixture://owned.json', sourceSha256: 'a'.repeat(64)
});
activateCardCatalog(candidatePath);

beforeEach(() => {
  db.exec('DELETE FROM discovery_marks; DELETE FROM decks; DELETE FROM wanted_items; DELETE FROM collection_items; DELETE FROM cards;');
  const insert = db.prepare('INSERT INTO cards (id, scryfall_id, oracle_id, name, search_name, raw_json) VALUES (?, ?, ?, ?, ?, ?)');
  fixtureCards.forEach((item, index) => insert.run(index + 1, `printing-${index + 1}`,
    item.identifiers.scryfallOracleId || null, item.name, item.name.toLowerCase(), '{}'));
  insert.run(30, 'other-printing', alpha.identifiers.scryfallOracleId.toUpperCase(), 'Historical Bloom Name', 'historical bloom name', '{}');
  db.exec(`
    INSERT INTO collection_items (card_id, quantity) VALUES (6, 0);
    INSERT INTO wanted_items (card_id, quantity) VALUES (7, 4);
    INSERT INTO decks (id, name) VALUES (1, 'Deck reference');
    INSERT INTO deck_cards (deck_id, card_id, quantity) VALUES (1, 8, 2);
  `);
});
after(() => {
  closeCardCatalogDatabase();
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function own(id, quantity = 1, finish = 'nonfoil', location = '') {
  db.prepare('INSERT INTO collection_items (card_id, quantity, finish, location) VALUES (?, ?, ?, ?)')
    .run(id, quantity, finish, location);
}
function search(input = {}) {
  return searchCardCatalog(input, cardDiscoveryContext(input));
}
function options(input = {}) {
  return cardCatalogOptions(input, cardDiscoveryContext(input));
}
function names(result) { return result.items.map((item) => item.name).sort(); }
function counts(result, facet) { return Object.fromEntries(result[facet].map((entry) => [entry.value.toLowerCase(), entry.count])); }
function mark(item) {
  setDiscoveryMark({ name: item.name, scryfallOracleId: item.identifiers.scryfallOracleId, marked: true });
}
function databaseSnapshot() {
  return {
    changes: db.prepare('SELECT total_changes() AS n').get().n,
    schema: db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all(),
    tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]),
    catalogHash: createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'catalog.sqlite'))).digest('hex')
  };
}

test('owned filter distinguishes physical ownership from cache, zero quantities, Wanted and decks', () => {
  assert.equal(search().total, fixtureCards.length);
  assert.equal(search({ owned: 1 }).total, 0);
  assert.deepEqual(names(search({ owned: true })), []);
  assert.deepEqual(options({ owned: 1 }).types, []);
  assert.deepEqual(cardDiscoveryContext().ownedCards, []);
  own(30, 2, 'foil');
  own(1, 4, 'nonfoil');
  own(1, 3, 'etched', 'Binder');
  own(3);
  assert.deepEqual(names(search({ owned: 1 })), [alpha.name, gamma.name]);
  assert.equal(search({ owned: 1 }).total, 2, 'copies, finishes, printing IDs and duplicate catalog variants do not duplicate cards');
  assert.deepEqual(names(search()), fixtureCards.map((item) => item.name).sort());
});

test('owned status is refreshed after acquiring or removing the final physical copy', () => {
  own(30, 1);
  assert.deepEqual(names(search({ owned: 1 })), [alpha.name]);
  own(1, 2);
  db.exec('DELETE FROM collection_items WHERE card_id=30');
  assert.deepEqual(names(search({ owned: 1 })), [alpha.name]);
  db.exec('UPDATE collection_items SET quantity=0 WHERE card_id=1');
  assert.equal(search({ owned: 1 }).total, 0);
  assert.deepEqual(options({ owned: 1 }).types, []);
  db.exec('UPDATE collection_items SET quantity=1 WHERE card_id=6');
  assert.deepEqual(names(search({ owned: 1 })), ['Zero Copies']);
});

test('owned identity uses Oracle across printings and whole-name fallback only when an Oracle ID is absent', () => {
  const ownedNames = (ownedCards) => names(searchCardCatalog({ owned: 1 }, { ownedCards }));
  assert.deepEqual(ownedNames([{ name: 'A historical name', scryfallOracleId: alpha.identifiers.scryfallOracleId.toUpperCase() }]), [alpha.name]);
  assert.deepEqual(ownedNames([{ name: alpha.name, scryfallOracleId: beta.identifiers.scryfallOracleId }]), [beta.name],
    'different known Oracle IDs do not match by name');
  assert.deepEqual(ownedNames([{ name: 'ALPHA BLOOM' }]), [alpha.name]);
  assert.deepEqual(ownedNames([{ name: "EOWYN'S GIFT", scryfallOracleId: 'unknown-oracle' }]), [fallback.name]);
  assert.deepEqual(ownedNames([{ name: "EOWYN'S GIFT" }]), [fallback.name]);
  assert.deepEqual(ownedNames([{ name: 'Gift' }]), []);
  assert.deepEqual(names(searchCardCatalog({ owned: 1 })), [], 'missing ownership context cannot leak the full catalog');
});

test('owned filter applies before pagination and every reactive facet', () => {
  for (const id of [1, 2, 3, 4, 5]) own(id);
  const pages = [1, 2, 3].map((page) => search({ owned: 1, limit: 2, page, sort: 'name' }));
  assert.ok(pages.every((result) => result.total === 5 && result.totalPages === 3));
  assert.deepEqual(pages.map((result) => result.items.length), [2, 2, 1]);
  assert.deepEqual(pages.flatMap((result) => names(result)).sort(), [alpha, beta, gamma, delta, fallback].map((item) => item.name).sort());
  const selected = options({ owned: 1, type: 'Instant', page: 99, limit: 1 });
  assert.deepEqual(counts(selected, 'types'), { artifact: 1, creature: 1, instant: 3 });
  assert.deepEqual(counts(selected, 'keywords'), { cycling: 1, flashback: 1, storm: 1 });
  assert.deepEqual(counts(selected, 'colors'), { g: 2, u: 1 });
  assert.deepEqual(counts(selected, 'manaValues'), { 2: 1, 3: 1, 4: 1 });
  assert.deepEqual(counts(selected, 'legalities'), { commander: 3 });
  assert.equal(counts(selected, 'effects').draw, 3);
  const tokens = options({ owned: 1, type: 'Creature' });
  assert.deepEqual(counts(tokens, 'tokenPowers'), { 2: 1 });
  assert.deepEqual(counts(tokens, 'tokenToughnesses'), { 2: 1 });
  assert.deepEqual(counts(tokens, 'tokenTypes'), { beast: 1, creature: 1 });
});

test('owned combines with marks and normal filters without changing selected-deck highlighting', () => {
  own(1); own(2); own(3);
  mark(beta); mark(gamma); mark(fixtureCards[6]);
  db.prepare('INSERT INTO deck_cards (deck_id, card_id, quantity) VALUES (1, 2, 1)').run();
  const selected = search({ owned: 1, marked: 1, deckId: 1, sort: 'mana' });
  assert.deepEqual(names(selected), [beta.name, gamma.name]);
  assert.ok(selected.items.every((item) => item.marked));
  assert.equal(selected.items.find((item) => item.name === beta.name).inDeck, true);
  assert.equal(selected.items.find((item) => item.name === gamma.name).inDeck, false);
  assert.deepEqual(names(search({ owned: 1, marked: 1, type: 'Instant' })), [beta.name]);
  assert.deepEqual(counts(options({ owned: 1, marked: 1 }), 'types'), { creature: 1, instant: 1 });
  assert.equal(selected.query.owned, true);
  assert.equal(Object.hasOwn(selected.query, '_ownedCards'), false);
});

test('owned discovery UI queries apply commander colors to real catalog results and facets', () => {
  own(1); own(2); own(4);
  const before = databaseSnapshot();
  for (const [colorIdentity, colorMode, expected] of [
    ['G', 'subset', [alpha.name, delta.name]],
    ['G', 'exact', [alpha.name]],
    ['G', 'contains', [alpha.name]],
    ['C', 'subset', [delta.name]],
    ['G,U', 'subset', [alpha.name, beta.name, delta.name]]
  ]) {
    const input = Object.fromEntries(discoverySearchParams({ owned: true, colorIdentity, colorMode }));
    assert.deepEqual(names(search(input)), expected, `${colorIdentity}/${colorMode}`);
  }
  const green = Object.fromEntries(discoverySearchParams({ owned: '1', colorIdentity: 'G', colorMode: 'subset' }));
  const facets = options(green);
  assert.deepEqual(counts(facets, 'types'), { artifact: 1, instant: 1 });
  assert.deepEqual(counts(facets, 'keywords'), { flashback: 1 });
  assert.deepEqual(counts(facets, 'colors'), { c: 1, g: 1, u: 1 }, 'color choices retain own-filter facet behavior within ownership');
  assert.deepEqual(databaseSnapshot(), before);
});

test('owned scalar validation matches marked and handles large collections with bound identity lists', () => {
  own(1);
  for (const owned of [1, true, '1', 'true', ' TRUE ', ['1']]) assert.equal(search({ owned }).total, 1);
  for (const owned of [0, false, '0', 'false', '', undefined]) assert.equal(search({ owned }).total, fixtureCards.length);
  for (const owned of ['yes', '2', -1, {}, '1 OR 1=1', 'x'.repeat(11)]) {
    for (const run of [search, options]) assert.throws(() => run({ owned }), (error) => error.status === 400);
  }
  const ownedCards = Array.from({ length: 20000 }, (_, i) => ({ name: `Other Card ${i}`, scryfallOracleId: `other-${i}` }));
  ownedCards.push({ name: alpha.name, scryfallOracleId: alpha.identifiers.scryfallOracleId });
  assert.deepEqual(names(searchCardCatalog({ owned: 1 }, { ownedCards })), [alpha.name]);
});

test('owned discovery is read-only and does not attach or modify either database', () => {
  own(30, 2, 'foil'); own(3);
  mark(alpha);
  const before = databaseSnapshot();
  search({ owned: 1 });
  options({ owned: 1 });
  search({ owned: 1, marked: 1, deckId: 1, type: 'Instant' });
  options({ owned: 1, marked: 1, type: 'Instant' });
  assert.throws(() => search({ owned: 'invalid' }));
  assert.deepEqual(databaseSnapshot(), before);
  assert.deepEqual(db.prepare('PRAGMA database_list').all().map((row) => row.name), ['main']);
  withCardCatalog((catalog) => {
    assert.deepEqual(catalog.prepare('PRAGMA database_list').all().map((row) => row.name), ['main']);
  });
});
