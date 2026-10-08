import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-import-cache-integrity-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'collection.sqlite';

const { db, closeDatabase } = await import('../src/db/database.js');
const { ensureCard, ensureCardsByIdentifiers } = await import('../src/services/card-cache-service.js');
const { upsertScryfallCard, getCollectionItem } = await import('../src/services/card-repository.js');
const { importCollectionList, previewCollectionImport, importDeckList } = await import('../src/services/import-export-service.js');
const { scryfallService } = await import('../src/services/scryfall-service.js');
const {
  loadGroupedPrintingsByName, loadGroupedPrintingsForCard, replacePrintingCatalog,
  getCatalogPrintings, ensurePrintingCatalogForCard
} = await import('../src/services/printing-catalog-service.js');
const { groupPrintings, summarizeLocalPrinting } = await import('../src/services/printing-service.js');

function rawCard(id, name, set, collectorNumber, extra = {}) {
  return {
    id, oracle_id: `oracle-${name}`, name, set, set_name: set.toUpperCase(), collector_number: collectorNumber,
    lang: 'en', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [],
    games: ['paper'], finishes: ['nonfoil', 'foil', 'etched'], prices: {}, ...extra
  };
}

const localRaw = rawCard('integrity-local', 'Integrity Card', 'int', '1');
const local = upsertScryfallCard(localRaw);
db.prepare("INSERT INTO decks (id, name) VALUES (1, 'Import integrity')").run();

after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('een verdwenen expliciete kaart-ID valt niet terug op een andere printing via naam of Scryfall-ID', async (t) => {
  const lookup = t.mock.method(scryfallService, 'getByName', async () => localRaw);
  for (const input of [
    { cardId: local.id + 10000, name: local.name },
    { cardId: local.id + 10000, scryfallId: local.scryfallId },
    { cardId: 0, name: local.name },
    { cardId: '', name: local.name },
    { cardId: -1, name: local.name },
    { cardId: 1.5, name: local.name }
  ]) {
    await assert.rejects(() => ensureCard(input), (error) => [400, 404].includes(error.status));
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal((await ensureCard({ cardId: local.id, name: local.name })).id, local.id);
});

test('tegenstrijdige lokale en externe printing-identifiers worden geweigerd', async () => {
  await assert.rejects(() => ensureCard({ cardId: local.id, scryfallId: 'different-printing' }),
    (error) => error.status === 409);
  assert.equal((await ensureCard({ cardId: local.id, scryfallId: local.scryfallId })).id, local.id);
});

test('batchimport gebruikt nooit een andere set voor een expliciet naam-plus-set-verzoek', async (t) => {
  const identifier = { name: 'Set Restricted Card', set: 'aaa' };
  t.mock.method(scryfallService, 'getCollection', async () => ({
    cards: [rawCard('wrong-set-printing', identifier.name, 'bbb', '1')],
    notFound: []
  }));
  const result = await ensureCardsByIdentifiers([identifier]);
  assert.deepEqual(result.resolved, []);
  assert.deepEqual(result.notFound, [identifier]);
});

test('dezelfde batch kan een naam in twee sets correct koppelen en onbekende sets afwijzen', async (t) => {
  const name = 'Multiple Set Card';
  const identifiers = ['one', 'two', 'missing'].map((set) => ({ name, set }));
  t.mock.method(scryfallService, 'getCollection', async () => ({
    cards: [rawCard('set-one', name, 'one', '1'), rawCard('set-two', name, 'two', '1')],
    notFound: [identifiers[2]]
  }));
  const result = await ensureCardsByIdentifiers(identifiers);
  assert.deepEqual(result.resolved.map(({ identifier, card }) => [identifier.set, card.setCode]), [
    ['one', 'one'], ['two', 'two']
  ]);
  assert.deepEqual(result.notFound, [identifiers[2]]);
});

test('kaartnummers met lettervarianten worden lokaal en op afstand hoofdletterongevoelig gekoppeld', async (t) => {
  const identifier = { set: 'alt', collector_number: '7A' };
  const lookup = t.mock.method(scryfallService, 'getCollection', async () => ({
    cards: [rawCard('collector-letter', 'Letter Card', 'alt', '7a')], notFound: []
  }));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await ensureCardsByIdentifiers([identifier]);
    assert.equal(result.resolved.length, 1);
    assert.equal(result.resolved[0].card.scryfallId, 'collector-letter');
    assert.deepEqual(result.notFound, []);
  }
  assert.equal(lookup.mock.callCount(), 1);
});

test('deckimport weigert een kaartnaam die niet bij de expliciete set en het kaartnummer hoort', async () => {
  const rejected = await importDeckList(1, '2 Wrong Card (INT) 1');
  assert.equal(rejected.importedCount, 0);
  assert.equal(rejected.failed.length, 1);
  assert.match(rejected.failed[0].reason, /hoort bij “Integrity Card”/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deck_cards').get().n, 0);
  const accepted = await importDeckList(1, '2 Integrity Card (INT) 1');
  assert.equal(accepted.importedCount, 1);
  assert.equal(accepted.imported[0].quantity, 2);
});

test('ongeldige deckaantallen worden vóór enige mutatie afgewezen, met het regelnummer', async () => {
  const before = db.prepare('SELECT * FROM deck_cards ORDER BY id').all();
  for (const quantity of ['0', '-2', '1.5', '10001', '9007199254740993', '9'.repeat(400)]) {
    await assert.rejects(() => importDeckList(1, `1 Integrity Card (INT) 1\n${quantity} Integrity Card (INT) 1`),
      (error) => error.status === 400 && /^Regel 2: Aantal/.test(error.message));
    assert.deepEqual(db.prepare('SELECT * FROM deck_cards ORDER BY id').all(), before);
  }
});

test('gemengde afwerkingen blijven gescheiden bij import, herimport, uitlezen en verversen van kaartmetadata', async () => {
  const defaults = {
    finish: 'nonfoil', language: 'en', condition: 'near_mint', location: 'Integrity box',
    notes: 'Preserve finish', reconcileWanted: false
  };
  const text = '2 Integrity Card (INT) 1\n3 Integrity Card (INT) 1 *F*\n1 Integrity Card (INT) 1 *E*';
  const preview = await previewCollectionImport(text, defaults);
  assert.deepEqual(preview.items.map((item) => [item.finish, item.quantity]), [
    ['nonfoil', 2], ['foil', 3], ['etched', 1]
  ]);
  const first = await importCollectionList(text, defaults, preview.previewToken);
  assert.equal(first.imported.length, 3);
  await importCollectionList(text, defaults, preview.previewToken);
  const snapshot = () => db.prepare(`
    SELECT id, card_id, quantity, finish, language, condition, location, notes
    FROM collection_items WHERE card_id = ? ORDER BY finish
  `).all(local.id);
  const beforeRefresh = snapshot();
  assert.deepEqual(beforeRefresh.map((item) => [item.finish, item.quantity]), [
    ['etched', 2], ['foil', 6], ['nonfoil', 4]
  ]);
  upsertScryfallCard({ ...localRaw, finishes: ['foil'], prices: { eur_foil: '4.20' }, oracle_text: 'Updated rules.' });
  assert.deepEqual(snapshot(), beforeRefresh);
  for (const row of beforeRefresh) {
    const item = getCollectionItem(row.id);
    assert.equal(item.finish, row.finish);
    assert.equal(item.quantity, row.quantity);
    assert.deepEqual(item.card.finishes, ['foil']);
  }
});

test('de printingkeuze neemt lokale digitale kaarten niet over als fysieke of foil-printing', async (t) => {
  const name = 'Paper Printing Only';
  const paper = upsertScryfallCard(rawCard('physical-printing', name, 'pap', '10', { finishes: ['nonfoil'] }));
  upsertScryfallCard(rawCard('digital-printing', name, 'dig', '10', {
    games: ['arena'], finishes: ['foil'], released_at: '2026-10-01'
  }));
  t.mock.method(scryfallService, 'printings', async () => { throw new Error('Offline'); });
  for (const result of [await loadGroupedPrintingsByName(name), await loadGroupedPrintingsForCard(paper)]) {
    assert.equal(result.offline, true);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].scryfallId, paper.scryfallId);
    assert.deepEqual(result.data[0].finishes, ['nonfoil']);
  }
});

test('een oude volledige printingcatalogus verbergt digitale printings bij een cachehit en offline fallback', async (t) => {
  const name = 'Legacy Cached Printings';
  const paper = upsertScryfallCard(rawCard('legacy-physical', name, 'lph', '1', { finishes: ['nonfoil'] }));
  const digital = upsertScryfallCard(rawCard('legacy-digital', name, 'ldg', '1', { games: ['arena'], finishes: ['foil'] }));
  replacePrintingCatalog(paper.cardKey, groupPrintings([paper, digital].map(summarizeLocalPrinting)), { complete: true });
  const lookup = t.mock.method(scryfallService, 'printings', async () => { throw new Error('Offline'); });

  const cached = await ensurePrintingCatalogForCard(paper);
  assert.equal(lookup.mock.callCount(), 0);
  const offline = await loadGroupedPrintingsByName(name);
  assert.equal(offline.offline, true);
  assert.equal(offline.complete, true);
  for (const printings of [cached, offline.data, getCatalogPrintings(paper.cardKey)]) {
    assert.equal(printings.length, 1);
    assert.equal(printings[0].scryfallId, paper.scryfallId);
    assert.deepEqual(printings[0].finishes, ['nonfoil']);
  }
});

test('een gemengde oude catalogusgroep herbouwt finishes, talen en hoofdafbeelding zonder digitale variant', async () => {
  const name = 'Legacy Mixed Printing';
  const paper = upsertScryfallCard(rawCard('mixed-physical', name, 'mix', '1', {
    lang: 'fr', finishes: ['nonfoil'], image_uris: { normal: 'https://example.test/paper.jpg' }
  }));
  const digital = upsertScryfallCard(rawCard('mixed-digital', name, 'mix', '1', {
    lang: 'en', games: ['arena'], finishes: ['foil'], image_uris: { normal: 'https://example.test/digital.jpg' }
  }));
  const old = groupPrintings([paper, digital].map(summarizeLocalPrinting));
  assert.equal(old[0].scryfallId, digital.scryfallId);
  assert.deepEqual(old[0].finishes, ['nonfoil', 'foil']);
  replacePrintingCatalog(paper.cardKey, old, { complete: true });

  const [printing] = getCatalogPrintings(paper.cardKey);
  assert.equal(printing.scryfallId, paper.scryfallId);
  assert.equal(printing.cardId, paper.id);
  assert.deepEqual(printing.finishes, ['nonfoil']);
  assert.deepEqual(printing.languages, ['fr']);
  assert.equal(printing.variants.length, 1);
  assert.equal(printing.imageNormal, paper.images.normal);
});
