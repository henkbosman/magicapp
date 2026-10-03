import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-discovery-marks-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'collection.sqlite';
process.env.CARD_CATALOG_DATABASE_FILE = 'catalog.sqlite';

// Start with an existing collection database that predates discovery marks.
const schema = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
const previousDatabase = new DatabaseSync(path.join(dataDir, 'collection.sqlite'));
previousDatabase.exec(schema);
previousDatabase.exec(`
  DROP TABLE IF EXISTS discovery_marks;
  INSERT INTO cards (id, scryfall_id, name, search_name, raw_json)
  VALUES (1, 'existing-printing', 'Existing Card', 'existing card', '{}');
  INSERT INTO collection_items (card_id, quantity, notes) VALUES (1, 7, 'Keep this collection');
  INSERT INTO decks (id, name, notes) VALUES (1, 'Existing deck', 'Keep this deck');
  INSERT INTO deck_cards (deck_id, card_id, quantity) VALUES (1, 1, 3);
`);
previousDatabase.close();

const { db, closeDatabase } = await import('../src/db/database.js');
const { setDiscoveryMark, listDiscoveryMarks, discoveryMarkContext } = await import('../src/services/discovery-mark-service.js');
const { buildCardCatalogDatabase } = await import('../src/card-catalog/builder.js');
const { activateCardCatalog, closeCardCatalogDatabase } = await import('../src/card-catalog/database.js');
const { searchCardCatalog, cardCatalogOptions } = await import('../src/card-catalog/repository.js');

const ids = {
  alpha: 'a0000000-0000-4000-8000-000000000001',
  beta: '10000000-0000-4000-8000-000000000002',
  gamma: '10000000-0000-4000-8000-000000000003',
  delta: '10000000-0000-4000-8000-000000000004',
  fallback: '10000000-0000-4000-8000-000000000005'
};

function card(name, oracleId, overrides = {}) {
  return {
    name, manaValue: 2, manaCost: '{1}{G}', colors: ['G'], colorIdentity: ['G'],
    type: 'Instant', types: ['Instant'], subtypes: [], supertypes: [],
    keywords: ['Flashback'], text: 'Draw a card.', legalities: { commander: 'Legal' },
    identifiers: oracleId ? { scryfallOracleId: oracleId } : {}, layout: 'normal',
    ...overrides
  };
}

const alpha = card('Alpha Bloom', ids.alpha);
const beta = card('Beta Tide', ids.beta, {
  colors: ['U'], colorIdentity: ['U'], manaValue: 4, keywords: ['Storm']
});
const gamma = card('Gamma Druid', ids.gamma, {
  type: 'Creature — Elf Druid', types: ['Creature'], subtypes: ['Elf', 'Druid'],
  manaValue: 1, keywords: ['Landfall'], text: 'Landfall — Create a 2/2 green Beast creature token.'
});
const delta = card('Delta Stone', ids.delta, {
  type: 'Artifact', types: ['Artifact'], colors: [], colorIdentity: [],
  manaValue: 6, keywords: [], text: 'Add {C}.'
});
const fallback = card('Éowyn’s Gift', null, { keywords: ['Cycling'] });
const fixtureCards = [alpha, beta, gamma, delta, fallback];

async function replaceCatalog(cards = fixtureCards) {
  const data = {};
  for (const item of cards) data[item.name] = [item];
  if (data[alpha.name]) data[alpha.name].push({ ...alpha, side: 'a' });
  const candidatePath = path.join(dataDir, 'candidate.sqlite');
  await buildCardCatalogDatabase({
    source: Readable.from([JSON.stringify({
      meta: { date: '2026-10-03', version: '5.3.0+marks-test' }, data
    })]),
    databasePath: candidatePath,
    sourceUrl: 'fixture://marks.json',
    sourceSha256: 'd'.repeat(64)
  });
  activateCardCatalog(candidatePath);
}

await replaceCatalog();

beforeEach(() => db.exec('DELETE FROM discovery_marks'));
after(() => {
  closeCardCatalogDatabase();
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function mark(item, marked = true) {
  return setDiscoveryMark({
    name: item.name, scryfallOracleId: item.identifiers.scryfallOracleId, marked
  });
}

function search(input = {}) {
  return searchCardCatalog(input, discoveryMarkContext());
}

function names(result) {
  return result.items.map((item) => item.name).sort();
}

function counts(options, facet) {
  return Object.fromEntries(options[facet].map((entry) => [entry.value.toLowerCase(), entry.count]));
}

test('startup adds independent marks storage while keeping existing collection and decks', () => {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'discovery_marks'").get();
  assert.equal(table.name, 'discovery_marks');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_list(discovery_marks)').all(), []);
  assert.deepEqual(db.prepare('PRAGMA database_list').all().map((row) => row.name), ['main']);
  db.exec(schema);
  const collection = db.prepare('SELECT quantity, notes FROM collection_items WHERE card_id = 1').get();
  assert.equal(collection.quantity, 7);
  assert.equal(collection.notes, 'Keep this collection');
  assert.equal(db.prepare('SELECT quantity FROM deck_cards WHERE deck_id = 1').get().quantity, 3);
  assert.equal(db.prepare('SELECT notes FROM decks WHERE id = 1').get().notes, 'Keep this deck');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('mark and unmark are idempotent and durable in the collection database only', () => {
  const catalogPath = path.join(dataDir, 'catalog.sqlite');
  const originalHash = createHash('sha256').update(fs.readFileSync(catalogPath)).digest('hex');
  mark(alpha);
  setDiscoveryMark({ name: alpha.name, scryfallOracleId: ids.alpha.toUpperCase(), marked: true });
  assert.equal(listDiscoveryMarks().length, 1);
  const independentConnection = new DatabaseSync(path.join(dataDir, 'collection.sqlite'), { readOnly: true });
  try {
    assert.equal(independentConnection.prepare('SELECT COUNT(*) AS total FROM discovery_marks').get().total, 1);
  } finally {
    independentConnection.close();
  }
  const results = search();
  assert.equal(results.items.find((item) => item.name === alpha.name).marked, true);
  assert.equal(results.items.find((item) => item.name === alpha.name).markKey, `oracle:${ids.alpha}`);
  assert.equal(results.items.find((item) => item.name === beta.name).marked, false);
  assert.ok(results.items.every((item) => typeof item.marked === 'boolean' && typeof item.markKey === 'string'));
  mark(alpha, false);
  mark(alpha, false);
  assert.deepEqual(listDiscoveryMarks(), []);
  assert.equal(createHash('sha256').update(fs.readFileSync(catalogPath)).digest('hex'), originalHash);
});

test('invalid mark bodies are rejected before any row is saved', () => {
  for (const input of [
    null, [], {}, { name: '', marked: true }, { name: '   ', marked: true },
    { name: alpha.name }, { name: alpha.name, marked: 'true' },
    { name: alpha.name, marked: 1 }, { name: alpha.name, marked: null },
    { name: alpha.name, scryfallOracleId: 'not-an-oracle-id', marked: true },
    { name: alpha.name, scryfallOracleId: [], marked: true },
    { name: alpha.name, scryfallOracleId: {}, marked: true }
  ]) {
    assert.throws(() => setDiscoveryMark(input), (error) => error.status === 400, JSON.stringify(input));
  }
  assert.deepEqual(listDiscoveryMarks(), []);
});

test('Gemarkeerd filters before totals, deduplication, sorting and pagination', () => {
  mark(alpha);
  mark(gamma);
  mark(delta);
  const firstPage = search({ marked: 'true', sort: 'mana', limit: 2, page: 1 });
  assert.equal(firstPage.total, 3);
  assert.deepEqual(firstPage.items.map((item) => item.name), [gamma.name, alpha.name]);
  assert.ok(firstPage.items.every((item) => item.marked));
  assert.deepEqual(names(search({ marked: 'true', sort: 'mana', limit: 2, page: 2 })), [delta.name]);
  assert.deepEqual(names(search({ marked: 'true', type: 'Instant' })), [alpha.name]);
  assert.equal(search({ marked: 'false' }).total, fixtureCards.length);
});

test('all reactive facet counts retain the Gemarkeerd restriction', () => {
  mark(alpha);
  mark(gamma);
  const context = discoveryMarkContext();
  const options = cardCatalogOptions({ marked: 'true', type: 'Instant' }, context);
  assert.deepEqual(counts(options, 'types'), { creature: 1, instant: 1 });
  assert.deepEqual(counts(options, 'abilities'), { flashback: 1 });
  assert.deepEqual(counts(options, 'colors'), { g: 1 });
  assert.deepEqual(counts(options, 'manaValues'), { 2: 1 });
  assert.deepEqual(counts(options, 'legalities'), { commander: 1 });
  assert.deepEqual(options.tokenPowers, []);
  assert.equal(search({ marked: 'true', type: 'Instant', ability: 'Landfall' }).total, 0);
  const changed = cardCatalogOptions({ marked: 'true', type: 'Creature' }, context);
  assert.deepEqual(counts(changed, 'tokenPowers'), { 2: 1 });
  assert.deepEqual(counts(changed, 'subtypes'), { druid: 1, elf: 1 });
});

test('an empty mark list yields zero results and empty reactive options', () => {
  const result = search({ marked: 'true' });
  assert.equal(result.total, 0);
  assert.deepEqual(result.items, []);
  const options = cardCatalogOptions({ marked: 'true' }, discoveryMarkContext());
  for (const value of Object.values(options)) {
    if (Array.isArray(value)) assert.deepEqual(value, []);
  }
  assert.deepEqual(options.manaRange, { min: null, max: null });
  assert.equal(search().total, fixtureCards.length);
});

test('large stored mark sets avoid SQLite placeholder limits', () => {
  mark(alpha);
  const example = listDiscoveryMarks()[0];
  const unrelated = Array.from({ length: 35000 }, (_, index) => ({
    ...example,
    name: `Missing ${index}`,
    scryfallOracleId: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    markKey: `oracle:20000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  }));
  const context = { marks: [...unrelated, example] };
  assert.deepEqual(names(searchCardCatalog({ marked: 'true' }, context)), [alpha.name]);
  assert.deepEqual(counts(cardCatalogOptions({ marked: 'true' }, context), 'types'), { instant: 1 });
});

test('name fallback normalizes punctuation and accents, without conflating different Oracle IDs', () => {
  setDiscoveryMark({ name: "EOWYN'S GIFT", marked: true });
  assert.deepEqual(names(search({ marked: 'true' })), [fallback.name]);
  assert.equal(search({ marked: 'true' }).items[0].markKey, "name:eowyn's gift");
  setDiscoveryMark({ name: "Éowyn’s Gift", marked: false });
  assert.deepEqual(listDiscoveryMarks(), []);
  setDiscoveryMark({ name: alpha.name, scryfallOracleId: ids.beta, marked: true });
  assert.deepEqual(names(search({ marked: 'true' })), [beta.name]);
});

test('missing-identity updates preserve distinct known Oracle identities with the same name', () => {
  const name = 'Shared card name';
  setDiscoveryMark({ name, scryfallOracleId: ids.alpha, marked: true });
  setDiscoveryMark({ name, scryfallOracleId: ids.beta, marked: true });
  setDiscoveryMark({ name, marked: true });
  const known = () => listDiscoveryMarks().map((entry) => entry.scryfallOracleId).filter(Boolean).sort();
  assert.deepEqual(known(), [ids.alpha, ids.beta].sort());
  setDiscoveryMark({ name, scryfallOracleId: ids.alpha, marked: false });
  assert.deepEqual(known(), [ids.beta]);
  setDiscoveryMark({ name, marked: false });
  assert.deepEqual(listDiscoveryMarks(), []);
});

test('replacing and reordering the catalog preserves Oracle and name-based marks', async () => {
  mark(alpha);
  mark(fallback);
  const primarySchema = db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
  const originalKeys = search({ marked: 'true' }).items.map((item) => item.markKey).sort();
  await replaceCatalog([delta, { ...fallback, uuid: 'new-source-key' }, gamma, beta, alpha]);
  assert.deepEqual(names(search({ marked: 'true' })), [alpha.name, fallback.name].sort());
  assert.deepEqual(search({ marked: 'true' }).items.map((item) => item.markKey).sort(), originalKeys);

  const upgradedFallback = { ...fallback, identifiers: { scryfallOracleId: ids.fallback } };
  await replaceCatalog([beta, upgradedFallback, gamma, alpha, delta]);
  assert.deepEqual(names(search({ marked: 'true' })), [alpha.name, fallback.name].sort());
  mark(upgradedFallback);
  assert.equal(listDiscoveryMarks().length, 2, 'upgrading a name mark must not create a duplicate');
  mark(upgradedFallback, false);
  assert.deepEqual(names(search({ marked: 'true' })), [alpha.name]);
  assert.deepEqual(db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all(), primarySchema);
});

test('HTTP mark endpoints persist selection and supply it to catalog search and facets', async (t) => {
  let express;
  try {
    ({ default: express } = await import('express'));
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    t.skip('Installeer de Express-afhankelijkheid om de HTTP-integratietest uit te voeren.');
    return;
  }
  const { discoveryMarksReadRouter, discoveryMarksWriteRouter } = await import('../src/routes/discovery-marks.js');
  const { cardCatalogReadRouter } = await import('../src/routes/card-catalog.js');
  const { apiPath } = await import('../public/js/api.js');
  const app = express();
  app.use(express.json());
  app.use('/api/read/discovery-marks', discoveryMarksReadRouter);
  app.use('/api/write/discovery-marks', discoveryMarksWriteRouter);
  app.use('/api/read/card-catalog', cardCatalogReadRouter);
  app.use((error, _request, response, _next) => {
    response.status(error.status || 500).json({ error: { message: error.message } });
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const change = (marked) => fetch(`${origin}${apiPath('/discovery-marks', { method: 'POST' })}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: alpha.name, scryfallOracleId: ids.alpha, marked })
  });
  const saved = await change(true);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).data.marked, true);
  const listed = await fetch(`${origin}${apiPath('/discovery-marks')}`);
  assert.equal((await listed.json()).data.length, 1);
  const filtered = await fetch(`${origin}${apiPath('/card-catalog/search?marked=1')}`);
  assert.deepEqual(names((await filtered.json()).data), [alpha.name]);
  const options = await fetch(`${origin}${apiPath('/card-catalog/options?marked=1')}`);
  assert.deepEqual(counts((await options.json()).data, 'types'), { instant: 1 });
  const invalid = await change('true');
  assert.equal(invalid.status, 400);
  assert.equal((await change(false)).status, 200);
  const empty = await fetch(`${origin}${apiPath('/card-catalog/search?marked=1')}`);
  assert.equal((await empty.json()).data.total, 0);
});
