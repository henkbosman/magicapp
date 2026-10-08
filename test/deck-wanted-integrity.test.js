import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-deck-wanted-integrity-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'collection.sqlite';

const { db, closeDatabase } = await import('../src/db/database.js');
const { addCollectionItem, getCardById } = await import('../src/services/card-repository.js');
const {
  addDeckCard, addMissingToWanted, deleteDeckCard, getDeck, getDeckCard, deleteDeck, updateDeckCard
} = await import('../src/services/deck-service.js');
const { createDeckCardLink, listDeckCardLinks } = await import('../src/services/deck-link-service.js');
const { getWantedItem, upsertWanted, updateWanted } = await import('../src/services/wanted-service.js');
const { replacePrintingCatalog } = await import('../src/services/printing-catalog-service.js');
const { groupPrintings, summarizeLocalPrinting } = await import('../src/services/printing-service.js');

for (let id = 1; id <= 4; id += 1) {
  db.prepare(`INSERT INTO cards
    (id, scryfall_id, oracle_id, name, search_name, set_code, collector_number,
     card_types_json, finishes_json, raw_json)
    VALUES (?, ?, ?, ?, ?, 'tst', ?, '["Creature"]', '["nonfoil","foil"]', '{}')`)
    .run(id, `printing-${id}`, `oracle-${id}`, `Test Card ${id}`, `test card ${id}`, String(id));
  const card = getCardById(id);
  replacePrintingCatalog(card.cardKey, groupPrintings([summarizeLocalPrinting(card)]));
}
db.exec(`INSERT INTO cards
  (id, scryfall_id, oracle_id, name, search_name, set_code, collector_number,
   card_types_json, finishes_json, raw_json)
  VALUES (5, 'printing-5', 'oracle-1', 'Test Card 1', 'test card 1', 'alt', '5',
    '["Creature"]', '["nonfoil","foil"]', '{}');`);

beforeEach(() => {
  db.exec(`
    DROP TRIGGER IF EXISTS test_fail_wanted_link;
    DROP TRIGGER IF EXISTS test_fail_wanted_printing;
    DELETE FROM decks;
    DELETE FROM wanted_items;
    DELETE FROM collection_items;
    INSERT INTO decks (id, name) VALUES (1, 'First deck'), (2, 'Second deck');
  `);
});

after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function add(deckId, cardId, overrides = {}) {
  return addDeckCard(deckId, { cardId, quantity: 1, role: 'main', note: '', tags: [], ...overrides });
}

function wanted(overrides = {}) {
  return upsertWanted({ cardId: 1, quantity: 1, priority: 3, maximumPrice: null, notes: '', ...overrides });
}

function snapshot() {
  return ['decks', 'deck_cards', 'deck_card_tags', 'deck_card_groups', 'deck_card_group_members', 'wanted_items', 'wanted_item_decks', 'collection_items']
    .map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]);
}

test('a deck-card deletion with another deck ID cannot clear commander or partner pointers', () => {
  for (const role of ['commander', 'partner']) {
    const first = add(1, 1, { role });
    const other = add(2, 2, { role });
    const original = snapshot();
    assert.throws(() => deleteDeckCard(1, other.id), (error) => error.status === 404);
    assert.deepEqual(snapshot(), original);
    const pointer = role === 'commander' ? 'commanderCardId' : 'secondCommanderCardId';
    assert.equal(getDeck(1)[pointer], first.card.id);
    assert.equal(getDeck(2)[pointer], other.card.id);
    deleteDeckCard(1, first.id);
    assert.equal(getDeck(1)[pointer], null);
    assert.equal(getDeck(2)[pointer], other.card.id);
  }
});

test('demoting and merging an old commander preserves quantity, notes, tags and combo membership', () => {
  const old = add(1, 1, { role: 'commander', note: 'Commander plan', tags: ['Ramp', 'Shared'] });
  const main = add(1, 1, { quantity: 2, note: 'Main plan', tags: ['Draw', 'Shared'] });
  const companion = add(1, 3);
  const group = createDeckCardLink(1, {
    name: 'Keep combo', type: 'combo', note: 'Keep explanation', deckCardIds: [old.id, companion.id]
  });
  add(1, 2, { role: 'commander' });
  const merged = getDeckCard(main.id);
  assert.equal(merged.quantity, 3);
  assert.equal(merged.note, 'Main plan\n\nCommander plan');
  assert.deepEqual(merged.tags, ['Draw', 'Ramp', 'Shared']);
  assert.equal(getDeckCard(old.id), null);
  assert.equal(getDeck(1).commanderCardId, 2);
  const groups = listDeckCardLinks(1);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, group.id);
  assert.deepEqual(groups[0].members.map((item) => item.deckCardId), [main.id, companion.id]);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('Wanted insert rolls back when a dependent deck link cannot be saved', () => {
  db.exec(`CREATE TEMP TRIGGER test_fail_wanted_link BEFORE INSERT ON wanted_item_decks
    BEGIN SELECT RAISE(ABORT, 'Simulated link failure'); END;`);
  const original = snapshot();
  assert.throws(() => wanted({ deckIds: [1] }), /Simulated link failure/);
  assert.deepEqual(snapshot(), original);
});

test('Wanted increment rolls back quantity, price and notes if selecting a printing fails', () => {
  const item = wanted({ quantity: 2, maximumPrice: 5, notes: 'Original wanted note' });
  db.exec(`CREATE TEMP TRIGGER test_fail_wanted_printing BEFORE UPDATE OF printing_card_id ON wanted_items
    BEGIN SELECT RAISE(ABORT, 'Simulated printing failure'); END;`);
  const original = snapshot();
  assert.throws(() => wanted({ quantity: 4, priority: 1, maximumPrice: 9, notes: 'New note', printingCardId: 1 }),
    /Simulated printing failure/);
  assert.deepEqual(snapshot(), original);
  assert.equal(getWantedItem(item.id).quantity, 2);
});

test('two simultaneous missing-to-Wanted requests add the current shortage only once', async () => {
  add(1, 1, { quantity: 3 });
  const results = await Promise.all([addMissingToWanted(1), addMissingToWanted(1)]);
  assert.equal(db.prepare('SELECT quantity FROM wanted_items WHERE card_id = 1').get().quantity, 3);
  assert.deepEqual(results.map((result) => result.added.length).sort(), [0, 1]);
  assert.equal(results[1].missing.summary.notOnWanted, 0);
});

test('cards acquired during printing lookup reduce the quantity automatically added to Wanted', async () => {
  add(1, 1, { quantity: 3 });
  const pending = addMissingToWanted(1);
  db.prepare('INSERT INTO collection_items (card_id, quantity, finish) VALUES (1, 2, ?)').run('foil');
  const result = await pending;
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].quantity, 1);
  assert.equal(db.prepare('SELECT quantity, finish FROM collection_items WHERE card_id = 1').get().finish, 'foil');
});

test('removing the last needed card while resolving a printing does not leave an unwanted Wanted item', async () => {
  const item = add(1, 1, { quantity: 3 });
  const pending = addMissingToWanted(1);
  deleteDeckCard(1, item.id);
  assert.deepEqual((await pending).added, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wanted_items').get().n, 0);
});

test('deleting the deck during printing lookup rejects without adding orphaned Wanted entries', async () => {
  add(1, 1);
  const pending = addMissingToWanted(1);
  deleteDeck(1);
  await assert.rejects(pending, (error) => error.status === 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wanted_items').get().n, 0);
});

test('a commander merge with oversized notes rejects and preserves both full notes and deck roles', () => {
  add(1, 1, { role: 'commander', note: 'A'.repeat(3000), tags: ['Ramp'] });
  add(1, 1, { note: 'B'.repeat(3000), tags: ['Draw'] });
  const original = snapshot();
  assert.throws(() => add(1, 2, { role: 'commander' }), (error) => error.status === 409);
  assert.deepEqual(snapshot(), original);
});

test('acquiring a printing rolls back collection, Wanted and deck when merging notes would truncate them', () => {
  add(1, 1, { note: 'A'.repeat(3000), tags: ['Ramp'] });
  add(1, 5, { note: 'B'.repeat(3000), tags: ['Draw'] });
  wanted({ quantity: 2, deckIds: [1] });
  const original = snapshot();
  assert.throws(() => addCollectionItem({
    cardId: 5, quantity: 1, finish: 'foil', language: 'en', condition: 'near_mint',
    location: '', notes: '', purchasePrice: null
  }), (error) => error.status === 409);
  assert.deepEqual(snapshot(), original);
});

test('successful printing alignment keeps both full notes, all tags and quantity', () => {
  const old = add(1, 1, { quantity: 2, note: 'Old printing plan', tags: ['Ramp'] });
  const target = add(1, 5, { quantity: 3, note: 'New printing plan', tags: ['Draw'] });
  const acquired = addCollectionItem({
    cardId: 5, quantity: 1, finish: 'foil', language: 'en', condition: 'near_mint',
    location: '', notes: '', purchasePrice: null
  });
  assert.equal(acquired.finish, 'foil');
  assert.equal(getDeckCard(old.id), null);
  const aligned = getDeckCard(target.id);
  assert.equal(aligned.quantity, 5);
  assert.equal(aligned.note, 'New printing plan\n\nOld printing plan');
  assert.deepEqual(aligned.tags, ['Draw', 'Ramp']);
});

test('adding to deck and Wanted quantities rejects overflow before any data is changed', () => {
  add(1, 1, { quantity: Number.MAX_SAFE_INTEGER });
  const beforeDeck = snapshot();
  assert.throws(() => add(1, 1), (error) => error.status === 400);
  assert.deepEqual(snapshot(), beforeDeck);
  deleteDeck(1);
  wanted({ quantity: Number.MAX_SAFE_INTEGER });
  const beforeWanted = snapshot();
  assert.throws(() => wanted(), (error) => error.status === 400);
  assert.deepEqual(snapshot(), beforeWanted);
});

test('adding extra deck copies preserves existing notes and tags while merging supplied notes', () => {
  const original = add(1, 1, { quantity: 2, note: 'Personal deck plan', tags: ['Ramp'] });
  const added = add(1, 1, { quantity: 3, note: 'Extra copies from import', tags: ['Draw'] });
  assert.equal(added.id, original.id);
  assert.equal(added.quantity, 5);
  assert.equal(added.note, 'Personal deck plan\n\nExtra copies from import');
  assert.deepEqual(added.tags, ['Draw', 'Ramp']);
  assert.equal(add(1, 1).note, added.note);
});

test('promoting a main-deck card through add preserves its previous personal note', () => {
  const original = add(1, 1, { note: 'Existing card plan', tags: ['Ramp'] });
  const commander = add(1, 1, { role: 'commander', note: 'Commander plan' });
  assert.equal(commander.id, original.id);
  assert.equal(commander.note, 'Existing card plan\n\nCommander plan');
  assert.deepEqual(commander.tags, ['Ramp']);
});

test('adding extra Wanted copies preserves the prior note and merges supplied notes', () => {
  const original = wanted({ quantity: 2, notes: 'Personal shopping note' });
  const added = wanted({ quantity: 3, notes: 'Extra copies needed' });
  assert.equal(added.id, original.id);
  assert.equal(added.quantity, 5);
  assert.equal(added.notes, 'Personal shopping note\n\nExtra copies needed');
  assert.equal(wanted().notes, added.notes);
});

test('missing-to-Wanted keeps personal notes when topping up a partially covered shortage', async () => {
  add(1, 1, { quantity: 3 });
  const original = wanted({ notes: 'Only buy the English version' });
  const result = await addMissingToWanted(1);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].id, original.id);
  assert.equal(result.added[0].quantity, 3);
  assert.equal(result.added[0].notes, 'Only buy the English version\n\nOntbreekt voor deck: First deck');
});

test('oversized additive notes roll back deck and Wanted increments', () => {
  add(1, 1, { note: 'A'.repeat(3000), tags: ['Ramp'] });
  const beforeDeck = snapshot();
  assert.throws(() => add(1, 1, { note: 'B'.repeat(3000), tags: ['Draw'] }),
    (error) => error.status === 409);
  assert.deepEqual(snapshot(), beforeDeck);
  wanted({ notes: 'A'.repeat(3000) });
  const beforeWanted = snapshot();
  assert.throws(() => wanted({ notes: 'B'.repeat(3000), deckIds: [1] }),
    (error) => error.status === 409);
  assert.deepEqual(snapshot(), beforeWanted);
});

test('explicit deck and Wanted edits can still replace and clear notes', () => {
  const deckItem = add(1, 1, { note: 'Original deck note' });
  const wantedItem = wanted({ notes: 'Original Wanted note' });
  for (const note of ['Replacement note', '']) {
    assert.equal(updateDeckCard(1, deckItem.id, { quantity: 1, role: 'main', note, tags: [] }).note, note);
    assert.equal(updateWanted(wantedItem.id, { quantity: 1, priority: 3, maximumPrice: null, notes: note }).notes, note);
  }
});
