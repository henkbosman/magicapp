import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-add-wanted-printing-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'collection.sqlite';

const { db, closeDatabase } = await import('../src/db/database.js');
const { upsertScryfallCard } = await import('../src/services/card-repository.js');
const { replacePrintingCatalog, resolveSinglePrintingCard } = await import('../src/services/printing-catalog-service.js');
const { scryfallService } = await import('../src/services/scryfall-service.js');

const rawA = {
  id: 'wanted-a', oracle_id: 'wanted-oracle-a', name: 'Wanted A',
  set: 'tst', collector_number: '1', lang: 'en', type_line: 'Creature',
  finishes: ['nonfoil', 'foil'], games: ['paper'], prices: { eur: '1.00' }
};
const rawB = {
  ...rawA, id: 'owned-b', oracle_id: 'owned-oracle-b', name: 'Owned B', collector_number: '2',
  oracle_text: 'Preserve B rules.', prices: { eur: '2.00', eur_foil: '4.00' }
};
let cardA;
let cardB;

beforeEach(() => {
  db.exec(`DELETE FROM wanted_items; DELETE FROM deck_cards; DELETE FROM decks;
    DELETE FROM collection_items; DELETE FROM card_printing_catalog;
    DELETE FROM card_printing_catalog_state; DELETE FROM cards;`);
  cardA = upsertScryfallCard(rawA);
  cardB = upsertScryfallCard(rawB);
  db.prepare(`INSERT INTO collection_items (card_id, quantity, finish, notes, purchase_price)
    VALUES (?, 2, 'foil', 'Keep foil B', 4), (?, 3, 'nonfoil', 'Keep nonfoil B', 2)`).run(cardB.id, cardB.id);
  db.prepare("INSERT INTO decks (id, name, commander_card_id) VALUES (1, 'B deck', ?)").run(cardB.id);
  db.prepare("INSERT INTO deck_cards (deck_id, card_id, quantity, note) VALUES (1, ?, 1, 'Keep deck B')").run(cardB.id);
  db.prepare("INSERT INTO wanted_items (card_id, printing_card_id, quantity, notes) VALUES (?, ?, 2, 'Keep Wanted B')").run(cardB.id, cardB.id);
  replacePrintingCatalog(cardA.cardKey, [{
    printingKey: 'tst|3', scryfallId: 'wanted-a-new', oracleId: cardA.oracleId,
    name: cardA.name, setCode: 'tst', collectorNumber: '3',
    variants: [{ scryfallId: 'wanted-a-new', language: 'en' }]
  }]);
});

after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function snapshot() {
  return Object.fromEntries(['cards', 'collection_items', 'decks', 'deck_cards', 'wanted_items',
    'card_printing_catalog', 'card_printing_catalog_state'].map((table) => [table,
    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
  ]));
}

test('automatische Wanted-printingkeuze controleert antwoordidentiteit vóór gegevens van B kunnen wijzigen', async (t) => {
  const before = snapshot();
  t.mock.method(scryfallService, 'getById', async () => ({
    ...rawB, oracle_text: 'Wrong overwrite of B', finishes: ['nonfoil'], prices: {}
  }));
  await assert.rejects(() => resolveSinglePrintingCard(cardA), (error) => error.status === 409);
  assert.deepEqual(snapshot(), before);
});

test('automatische Wanted-printingkeuze weigert een andere Oracle-identiteit vóór het cachen', async (t) => {
  const before = snapshot();
  t.mock.method(scryfallService, 'getById', async () => ({
    ...rawB, id: 'wanted-a-new', name: cardA.name
  }));
  await assert.rejects(() => resolveSinglePrintingCard(cardA), (error) => error.status === 409);
  assert.deepEqual(snapshot(), before);
});

test('geldige automatische Wanted-printingkeuze bewaart de nieuwe printing en laat alle andere gegevens intact', async (t) => {
  const before = snapshot();
  t.mock.method(scryfallService, 'getById', async () => ({
    ...rawA, id: 'wanted-a-new', collector_number: '3'
  }));
  const printing = await resolveSinglePrintingCard(cardA);
  assert.equal(printing.scryfallId, 'wanted-a-new');
  assert.equal(printing.cardKey, cardA.cardKey);
  const after = snapshot();
  after.cards = after.cards.filter((row) => row.id !== printing.id);
  assert.deepEqual(after, before);
});
