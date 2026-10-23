import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-deck-import-result-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'collection.sqlite';

const { db, closeDatabase } = await import('../src/db/database.js');
const { upsertScryfallCard } = await import('../src/services/card-repository.js');
const { importDeckList, parseDeckList } = await import('../src/services/import-export-service.js');
const { scryfallService } = await import('../src/services/scryfall-service.js');

const cards = ['Alpha Card', 'Bravo Card', '+2 Mace', '10,000 Year Storm'].map((name, index) => upsertScryfallCard({
  id: `import-report-${index}`, oracle_id: `oracle-report-${index}`, name,
  set: 'tst', set_name: 'Test', collector_number: String(index + 1),
  lang: 'en', type_line: 'Artifact', mana_cost: '{1}', cmc: 1,
  colors: [], color_identity: [], games: ['paper'], finishes: ['nonfoil', 'foil'], prices: {}
}));
const [alpha, bravo] = cards;

beforeEach((t) => {
  db.exec('DELETE FROM wanted_items; DELETE FROM collection_items; DELETE FROM decks;');
  db.exec("INSERT INTO decks (id, name) VALUES (1, 'Import target'), (2, 'Unrelated deck');");
  db.prepare("INSERT INTO deck_cards (deck_id, card_id, quantity, note) VALUES (2, ?, 3, 'Keep this note')").run(alpha.id);
  db.prepare("INSERT INTO collection_items (card_id, quantity, finish, location) VALUES (?, 4, 'foil', 'Binder')").run(alpha.id);
  db.prepare("INSERT INTO collection_items (card_id, quantity, finish, location) VALUES (?, 2, 'nonfoil', 'Box')").run(alpha.id);
  db.prepare("INSERT INTO wanted_items (card_id, quantity, notes) VALUES (?, 5, 'Keep wanted')").run(bravo.id);
  t.mock.method(scryfallService, 'getCollection', async (identifiers) => ({ cards: [], notFound: identifiers }));
});

after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function otherUserData() {
  return {
    collection: db.prepare('SELECT * FROM collection_items ORDER BY id').all(),
    wanted: db.prepare('SELECT * FROM wanted_items ORDER BY id').all(),
    otherDeck: db.prepare('SELECT * FROM decks WHERE id=2').get(),
    otherCards: db.prepare('SELECT * FROM deck_cards WHERE deck_id=2 ORDER BY id').all()
  };
}

test('deckparser preserves physical input lines and interprets compact quantities consistently', () => {
  const text = '# comment\r\n\r\nCommander\r\n1 Bravo Card\r\nDeck\r\n  2xAlpha Card (TST) 1  \r\n// comment\r\nSB: 3xAlpha Card\r\n+2 Mace\r\n10,000 Year Storm';
  assert.deepEqual(parseDeckList(text), [
    { line: 4, rawLine: '1 Bravo Card', quantity: 1, name: 'Bravo Card', set: '', collectorNumber: '', role: 'commander' },
    { line: 6, rawLine: '  2xAlpha Card (TST) 1  ', quantity: 2, name: 'Alpha Card', set: 'tst', collectorNumber: '1', role: 'main' },
    { line: 8, rawLine: 'SB: 3xAlpha Card', quantity: 3, name: 'Alpha Card', set: '', collectorNumber: '', role: 'sideboard' },
    { line: 9, rawLine: '+2 Mace', quantity: 1, name: '+2 Mace', set: '', collectorNumber: '', role: 'main' },
    { line: 10, rawLine: '10,000 Year Storm', quantity: 1, name: '10,000 Year Storm', set: '', collectorNumber: '', role: 'main' }
  ]);
});

test('successful import reports current input quantities rather than accumulated deck-row quantities', async () => {
  db.prepare("INSERT INTO deck_cards (deck_id, card_id, quantity, note) VALUES (1, ?, 7, 'Existing note')").run(alpha.id);
  const before = otherUserData();
  const result = await importDeckList(1, '3xAlpha Card (TST) 1\n2 Alpha Card (TST) 1\nCommander\n4 Bravo Card (TST) 2');
  assert.equal(result.totalRows, 3);
  assert.equal(result.importedCount, 3);
  assert.equal(result.importedQuantity, 6, 'two successful main rows plus one singleton commander');
  assert.equal(result.failedCount, 0);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.notFound, []);
  assert.deepEqual(result.imported.map((row) => row.quantity), [10, 12, 1]);
  const target = db.prepare('SELECT card_id, quantity, role, note FROM deck_cards WHERE deck_id=1 ORDER BY card_id').all();
  assert.deepEqual(target.map((row) => ({ ...row })), [
    { card_id: alpha.id, quantity: 12, role: 'main', note: 'Existing note' },
    { card_id: bravo.id, quantity: 1, role: 'commander', note: '' }
  ]);
  assert.deepEqual(otherUserData(), before);
});

test('partial import reports each skipped original line including repeated unresolved names', async () => {
  const text = '# deck\r\nCommander\r\n1 Missing Leader\r\n\r\nDeck\r\n2 Alpha Card (TST) 1\r\n// note\r\n  SB: 3 Missing Thing (ZZZ) 9  \r\n1 Missing Thing\r\n1 Missing Thing';
  const before = otherUserData();
  const result = await importDeckList(1, text);
  assert.equal(result.totalRows, 5);
  assert.equal(result.importedCount, 1);
  assert.equal(result.importedQuantity, 2);
  assert.equal(result.failedCount, 4);
  assert.equal(result.importedCount + result.failedCount, result.totalRows);
  assert.deepEqual(result.failed, [
    { line: 3, rawLine: '1 Missing Leader', quantity: 1, name: 'Missing Leader', set: '', collectorNumber: '', role: 'commander', reason: 'Niet gevonden bij Scryfall' },
    { line: 8, rawLine: '  SB: 3 Missing Thing (ZZZ) 9  ', quantity: 3, name: 'Missing Thing', set: 'zzz', collectorNumber: '9', role: 'sideboard', reason: 'Niet gevonden bij Scryfall' },
    { line: 9, rawLine: '1 Missing Thing', quantity: 1, name: 'Missing Thing', set: '', collectorNumber: '', role: 'main', reason: 'Niet gevonden bij Scryfall' },
    { line: 10, rawLine: '1 Missing Thing', quantity: 1, name: 'Missing Thing', set: '', collectorNumber: '', role: 'main', reason: 'Niet gevonden bij Scryfall' }
  ]);
  assert.equal(db.prepare('SELECT SUM(quantity) AS total FROM deck_cards WHERE deck_id=1').get().total, 2);
  assert.deepEqual(otherUserData(), before);
});

test('all-failed import reports both unknown cards and wrong name/printing with no deck changes', async () => {
  const before = otherUserData();
  const result = await importDeckList(1, '\nDeck\n1 Missing Card\n2 Wrong Name (TST) 1');
  assert.equal(result.totalRows, 2);
  assert.equal(result.importedCount, 0);
  assert.equal(result.importedQuantity, 0);
  assert.equal(result.failedCount, 2);
  assert.deepEqual(result.imported, []);
  assert.deepEqual(result.failed.map((row) => row.line), [3, 4]);
  assert.equal(result.failed[1].rawLine, '2 Wrong Name (TST) 1');
  assert.equal(result.failed[1].name, 'Wrong Name');
  assert.match(result.failed[1].reason, /TST #1 hoort bij “Alpha Card”, niet bij “Wrong Name”/);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM deck_cards WHERE deck_id=1').get().total, 0);
  assert.deepEqual(otherUserData(), before);
});

test('an individual write failure keeps its source line and permits later valid rows', async () => {
  const before = otherUserData();
  db.exec(`CREATE TEMP TRIGGER reject_test_card BEFORE INSERT ON deck_cards
    WHEN NEW.deck_id = 1 AND NEW.card_id = ${alpha.id}
    BEGIN SELECT RAISE(ABORT, 'Test write failure'); END;`);
  let result;
  try {
    result = await importDeckList(1, '2 Alpha Card (TST) 1\n\n3 Bravo Card (TST) 2');
  } finally {
    db.exec('DROP TRIGGER reject_test_card');
  }
  assert.equal(result.totalRows, 2);
  assert.equal(result.failedCount, 1);
  assert.equal(result.importedCount, 1);
  assert.equal(result.importedQuantity, 3);
  assert.equal(result.failed[0].line, 1);
  assert.equal(result.failed[0].rawLine, '2 Alpha Card (TST) 1');
  assert.equal(result.failed[0].reason, 'Test write failure');
  assert.deepEqual(db.prepare('SELECT card_id, quantity FROM deck_cards WHERE deck_id=1').all().map((row) => ({ ...row })),
    [{ card_id: bravo.id, quantity: 3 }]);
  assert.deepEqual(otherUserData(), before);
});

test('invalid quantities still abort before resolving or adding any input row', async () => {
  const before = otherUserData();
  const allDecks = db.prepare('SELECT * FROM decks ORDER BY id').all();
  for (const quantity of ['0', '-2', '1.5', '10001', '9007199254740993']) {
    await assert.rejects(() => importDeckList(1, `Deck\n1 Missing Card\n1 Alpha Card\n${quantity}xBravo Card`),
      (error) => error.status === 400 && /^Regel 4: Aantal/.test(error.message));
  }
  assert.equal(scryfallService.getCollection.mock.callCount(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM deck_cards WHERE deck_id=1').get().total, 0);
  assert.deepEqual(db.prepare('SELECT * FROM decks ORDER BY id').all(), allDecks);
  assert.deepEqual(otherUserData(), before);
});
