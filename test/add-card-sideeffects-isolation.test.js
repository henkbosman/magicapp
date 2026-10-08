import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-add-isolation-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'collection.sqlite';

const { db, closeDatabase, transaction } = await import('../src/db/database.js');
const { addCollectionItem } = await import('../src/services/card-repository.js');
const { addDeckCard } = await import('../src/services/deck-service.js');

const tables = [
  'cards', 'collection_items', 'decks', 'deck_cards', 'deck_card_tags',
  'deck_card_groups', 'deck_card_group_members', 'wanted_items', 'wanted_item_decks',
  'card_user_metadata', 'discovery_marks', 'card_printing_catalog', 'card_printing_catalog_state'
];

function rows(table, where = '') {
  return db.prepare(`SELECT * FROM ${table} ${where} ORDER BY rowid`).all();
}

function snapshot() {
  return Object.fromEntries(tables.map((table) => [table, rows(table)]));
}

function addInput(overrides = {}) {
  return {
    cardId: 2, quantity: 1, finish: 'foil', language: 'en', condition: 'near_mint',
    location: 'Binder A', notes: 'New purchase', purchasePrice: 4.5, ...overrides
  };
}

function group(id, deckId, name, members) {
  db.prepare('INSERT INTO deck_card_groups (id, deck_id, name, link_type, note) VALUES (?, ?, ?, ?, ?)')
    .run(id, deckId, name, 'combo', `${name} description`);
  members.forEach((member, index) => {
    db.prepare('INSERT INTO deck_card_group_members (group_id, deck_card_id, position) VALUES (?, ?, ?)')
      .run(id, member, index);
  });
}

beforeEach(() => {
  db.exec(`
    DROP TRIGGER IF EXISTS test_fail_collection_deck;
    DELETE FROM decks;
    DELETE FROM wanted_items;
    DELETE FROM collection_items;
    DELETE FROM cards;
    DELETE FROM card_user_metadata;
    DELETE FROM discovery_marks;
  `);
  const insert = db.prepare(`INSERT INTO cards
    (id, scryfall_id, oracle_id, name, search_name, set_code, collector_number,
     card_types_json, finishes_json, raw_json)
    VALUES (?, ?, ?, ?, ?, 'tst', ?, '["Creature"]', '["nonfoil","foil","etched"]', '{}')`);
  for (const [id, key, name] of [
    [1, 'oracle-a', 'Card A'], [2, 'oracle-a', 'Card A'],
    [3, 'oracle-b', 'Card B'], [4, 'oracle-b', 'Card B'],
    [5, 'oracle-c', 'Card C'], [6, null, 'Card without Oracle ID'],
    [7, 'oracle-new', 'A genuinely new card']
  ]) insert.run(id, `printing-${id}`, key, name, name.toLowerCase(), String(id));
  db.exec(`
    INSERT INTO collection_items (id, card_id, quantity, finish, language, condition, location, notes, purchase_price)
      VALUES (1, 3, 4, 'foil', 'en', 'near_mint', 'Binder B', 'Keep B foil note', 3.75),
             (2, 3, 2, 'nonfoil', 'en', 'played', 'Trade box', 'Keep B plain note', 1.25),
             (3, 4, 3, 'etched', 'de', 'mint', 'Binder C', 'Keep alternative B printing', 8),
             (4, 6, 2, 'foil', 'en', 'near_mint', '', 'Keep fallback identity', 2);
    INSERT INTO decks (id, name, description, commander_card_id, notes)
      VALUES (1, 'A deck', 'A deck description', 3, 'Keep mixed deck note'),
             (2, 'Another deck', 'Other deck description', 5, 'Keep unrelated deck note');
    INSERT INTO deck_cards (id, deck_id, card_id, quantity, role, note)
      VALUES (11, 1, 1, 2, 'main', 'Old A printing plan'),
             (12, 1, 2, 3, 'main', 'New A printing plan'),
             (13, 1, 3, 1, 'commander', 'Keep B commander'),
             (15, 1, 5, 1, 'main', 'Keep C plan'),
             (21, 2, 1, 2, 'main', 'A plan in second deck'),
             (23, 2, 4, 2, 'main', 'Keep second-deck B plan'),
             (25, 2, 5, 1, 'commander', 'Keep second-deck commander');
    INSERT INTO deck_card_tags (deck_card_id, tag)
      VALUES (11, 'Ramp'), (12, 'Draw'), (13, 'Commander'), (23, 'Other plan');
    INSERT INTO wanted_items (id, card_id, printing_card_id, quantity, priority, maximum_price, notes)
      VALUES (1, 1, 2, 5, 2, 10, 'Wanted A'),
             (3, 3, 4, 8, 1, 20, 'Keep Wanted B');
    INSERT INTO wanted_item_decks (wanted_item_id, deck_id) VALUES (1, 1), (3, 1), (3, 2);
    INSERT INTO card_user_metadata (card_key, mana_production_json, mana_production_note, library_search_targets_json, library_search_note)
      VALUES ('oracle-a', '["G"]', 'Personal A mana note', '["land"]', 'Personal A search note'),
             ('oracle-b', '["U"]', 'Keep B mana note', '["creature"]', 'Keep B search note');
    INSERT INTO discovery_marks (mark_key, oracle_id, name, normalized_name)
      VALUES ('oracle:oracle-a', 'oracle-a', 'Card A', 'card a'),
             ('oracle:oracle-b', 'oracle-b', 'Card B', 'card b');
  `);
  group(1, 1, 'A with B', [11, 13]);
  group(2, 1, 'Unrelated B with C', [13, 15]);
  group(3, 2, 'Other-deck B with C', [23, 25]);
});

after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('adding a genuinely new card changes no existing collection, deck, Wanted or personal-data row', () => {
  const before = snapshot();
  const added = addCollectionItem(addInput({ cardId: 7 }));
  const after = snapshot();
  after.collection_items = after.collection_items.filter((row) => row.id !== added.id);
  assert.deepEqual(after, before);
  assert.equal(added.card.id, 7);
  assert.equal(added.finish, 'foil');
  assert.equal(added.quantity, 1);
  assert.equal(added.deckPrintingAlignment.updatedDeckCards, 0);
});

test('adding one physical variant changes only its exact row, preserving other finishes and printings', () => {
  const before = snapshot();
  const added = addCollectionItem(addInput({
    cardId: 3, quantity: 2, location: 'Binder B', notes: 'Second B purchase', purchasePrice: 3.75,
    reconcileWanted: false
  }));
  const after = snapshot();
  const original = before.collection_items.find((row) => row.id === 1);
  const changed = after.collection_items.find((row) => row.id === 1);
  assert.equal(added.id, 1);
  assert.equal(changed.quantity, 6);
  assert.equal(changed.notes, 'Keep B foil note\n\nSecond B purchase');
  assert.equal(changed.purchase_price, 3.75);
  assert.equal(changed.finish, 'foil');
  assert.deepEqual({ ...changed, updated_at: original.updated_at }, {
    ...original, quantity: 6, notes: 'Keep B foil note\n\nSecond B purchase'
  });
  after.collection_items = after.collection_items.map((row) => row.id === 1 ? original : row);
  assert.deepEqual(after, before);
});

test('same-Oracle acquisition aligns linked deck printing and Wanted only, preserving unrelated rows', () => {
  const before = snapshot();
  const added = addCollectionItem(addInput({ sourceWantedId: 1 }));
  assert.deepEqual(added.deckPrintingAlignment.deckIds, [1]);
  const after = snapshot();
  for (const table of ['cards', 'card_user_metadata', 'discovery_marks', 'card_printing_catalog', 'card_printing_catalog_state']) {
    assert.deepEqual(after[table], before[table], table);
  }
  assert.deepEqual(after.collection_items.filter((row) => row.id !== added.id), before.collection_items);
  assert.deepEqual(after.decks.filter((row) => row.id !== 1), before.decks.filter((row) => row.id !== 1));
  assert.deepEqual(after.deck_cards.filter((row) => ![11, 12].includes(row.id)), before.deck_cards.filter((row) => ![11, 12].includes(row.id)));
  assert.deepEqual(after.deck_card_tags.filter((row) => ![11, 12].includes(row.deck_card_id)), before.deck_card_tags.filter((row) => ![11, 12].includes(row.deck_card_id)));
  assert.deepEqual(after.deck_card_groups.filter((row) => row.id !== 1), before.deck_card_groups.filter((row) => row.id !== 1));
  assert.deepEqual(after.deck_card_group_members.filter((row) => row.group_id !== 1), before.deck_card_group_members.filter((row) => row.group_id !== 1));
  assert.deepEqual(after.wanted_items.filter((row) => row.id !== 1), before.wanted_items.filter((row) => row.id !== 1));
  assert.deepEqual(after.wanted_item_decks, before.wanted_item_decks);
  assert.equal(after.wanted_items.find((row) => row.id === 1).quantity, 4);
  assert.deepEqual(after.deck_card_group_members.filter((row) => row.group_id === 1).map((row) => row.deck_card_id).sort(), [12, 13]);
  assert.equal(after.deck_cards.find((row) => row.id === 12).quantity, 5);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('a missing or different-card source Wanted reference rejects without touching any existing data', () => {
  for (const [sourceWantedId, status] of [[3, 409], [999999, 404]]) {
    const before = snapshot();
    assert.throws(() => addCollectionItem(addInput({ sourceWantedId })), (error) => error.status === status);
    assert.deepEqual(snapshot(), before);
  }
});

test('printing reassignment does not clean up an unrelated incomplete historical combo', () => {
  group(4, 1, 'Historical B group', [13]);
  group(5, 1, 'Two A printings', [11, 12]);
  const beforeGroup = rows('deck_card_groups', 'WHERE id = 4');
  const beforeMembers = rows('deck_card_group_members', 'WHERE group_id = 4');
  addCollectionItem(addInput({ sourceWantedId: 1 }));
  assert.deepEqual(rows('deck_card_groups', 'WHERE id = 4'), beforeGroup);
  assert.deepEqual(rows('deck_card_group_members', 'WHERE group_id = 4'), beforeMembers);
  assert.deepEqual(rows('deck_card_groups', 'WHERE id = 5'), [], 'a group collapsed by this actual merge is still cleaned up');
});

test('failure in the combined deck add rolls back collection, printing alignment, links and Wanted together', () => {
  db.exec(`CREATE TEMP TRIGGER test_fail_collection_deck BEFORE INSERT ON deck_cards
    WHEN NEW.deck_id = 2 AND NEW.card_id = 2
    BEGIN SELECT RAISE(ABORT, 'Simulated deck write failure'); END;`);
  const before = snapshot();
  assert.throws(() => transaction(() => {
    addCollectionItem(addInput({ sourceWantedId: 1 }));
    addDeckCard(2, { cardId: 2, quantity: 1, role: 'main', note: '', tags: [] });
  }), /Simulated deck write failure/);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
