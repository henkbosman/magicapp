import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-deck-tags-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'tags.sqlite';

const { db, transaction, closeDatabase } = await import('../src/db/database.js');
const { migrateDeckTags } = await import('../src/db/deck-tags-migration.js');
const { addCollectionItem } = await import('../src/services/card-repository.js');
const { addDeckCard, updateDeckCard, getDeckCard, getDeckCards, duplicateDeck, deleteDeck } = await import('../src/services/deck-service.js');
const { listDeckTags, createDeckTag, renameDeckTag, deleteDeckTag } = await import('../src/services/deck-tag-service.js');

function seedCards(database) {
  const insert = database.prepare(`INSERT INTO cards
    (id, scryfall_id, oracle_id, name, search_name, set_code, collector_number,
     card_types_json, finishes_json, raw_json)
    VALUES (?, ?, ?, ?, ?, 'tst', ?, '["Creature"]', '["nonfoil","foil"]', '{}')`);
  for (let id = 1; id <= 4; id++) insert.run(id, `tags-printing-${id}`, `tags-oracle-${id}`, `Card ${id}`, `card ${id}`, String(id));
}

function userSnapshot(database = db) {
  return ['decks', 'deck_cards', 'deck_card_tags', 'collection_items', 'wanted_items']
    .map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);
}

function fullSnapshot() {
  return [...userSnapshot(), ['deck_tags', db.prepare('SELECT * FROM deck_tags ORDER BY id').all()]];
}

function otherData() {
  return {
    deck: db.prepare('SELECT * FROM decks WHERE id=2').get(),
    cards: db.prepare('SELECT * FROM deck_cards WHERE deck_id=2 ORDER BY id').all(),
    tags: db.prepare(`SELECT dct.* FROM deck_card_tags dct JOIN deck_cards dc ON dc.id=dct.deck_card_id
      WHERE dc.deck_id=2 ORDER BY dct.deck_card_id, dct.tag`).all(),
    registry: db.prepare('SELECT * FROM deck_tags WHERE deck_id=2 ORDER BY id').all(),
    collection: db.prepare('SELECT * FROM collection_items ORDER BY id').all(),
    wanted: db.prepare('SELECT * FROM wanted_items ORDER BY id').all()
  };
}

function add(deckId, cardId, overrides = {}) {
  return addDeckCard(deckId, { cardId, quantity: 1, role: 'main', note: '', ...overrides });
}

function edit(deckId, item, overrides = {}) {
  return updateDeckCard(deckId, item.id, { quantity: item.quantity, role: item.role, note: item.note, ...overrides });
}

seedCards(db);
beforeEach(() => {
  db.exec(`DELETE FROM decks; DELETE FROM collection_items; DELETE FROM wanted_items;
    INSERT INTO decks (id, name) VALUES (1, 'Tag target'), (2, 'Other deck');
    INSERT INTO collection_items (card_id, quantity, finish, location) VALUES (1, 4, 'foil', 'Keep binder');
    INSERT INTO collection_items (card_id, quantity, finish, location) VALUES (1, 3, 'nonfoil', 'Keep box');
    INSERT INTO wanted_items (card_id, quantity, notes) VALUES (2, 5, 'Keep wanted');`);
});
after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('migration preserves existing assignments and physical data, folds Unicode names and is idempotent', () => {
  const legacy = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  try {
    const schema = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
    legacy.exec(schema);
    seedCards(legacy);
    legacy.exec(`DROP TABLE deck_tags;
      INSERT INTO decks (id, name) VALUES (1, 'Existing one'), (2, 'Existing two');
      INSERT INTO deck_cards (id, deck_id, card_id, quantity, note) VALUES
        (11, 1, 1, 2, 'Keep first'), (12, 1, 2, 3, 'Keep second'), (21, 2, 1, 4, 'Keep other');
      INSERT INTO deck_card_tags (deck_card_id, tag) VALUES
        (11, 'Ramp'), (12, 'ramp'), (11, 'Élan'), (12, 'élan'), (21, 'Ramp');
      INSERT INTO collection_items (card_id, quantity, finish) VALUES (1, 4, 'foil');
      INSERT INTO wanted_items (card_id, quantity) VALUES (2, 5);`);
    const before = userSnapshot(legacy);
    legacy.exec(schema);
    migrateDeckTags(legacy);
    const registry = legacy.prepare('SELECT * FROM deck_tags ORDER BY deck_id, name_key').all();
    assert.deepEqual(registry.map((row) => [row.deck_id, row.name_key]), [[1, 'ramp'], [1, 'élan'], [2, 'ramp']]);
    assert.deepEqual(userSnapshot(legacy), before);
    migrateDeckTags(legacy);
    assert.deepEqual(legacy.prepare('SELECT * FROM deck_tags ORDER BY deck_id, name_key').all(), registry);
    assert.deepEqual(userSnapshot(legacy), before);
    assert.deepEqual(legacy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    legacy.close();
  }
});

test('unused tags persist per deck, validate names and reject duplicate Unicode identities', () => {
  const ramp = createDeckTag(1, '  Ramp  ');
  const draw = createDeckTag(1, 'Draw');
  const elan = createDeckTag(1, 'Élan');
  const otherRamp = createDeckTag(2, 'Ramp');
  assert.equal(ramp.name, 'Ramp');
  assert.ok(ramp.id !== otherRamp.id);
  assert.deepEqual(listDeckTags(1).map((tag) => [tag.name, tag.cardCount]), [['Draw', 0], ['Élan', 0], ['Ramp', 0]]);
  assert.deepEqual(listDeckTags(2).map((tag) => [tag.name, tag.cardCount]), [['Ramp', 0]]);
  for (const name of ['', '   ', 'x'.repeat(61)]) {
    assert.throws(() => createDeckTag(1, name), (error) => error.status === 400);
  }
  for (const name of ['ramp', ' ÉLAN ', 'E\u0301lan']) {
    assert.throws(() => createDeckTag(1, name), (error) => error.status === 409);
  }
  assert.deepEqual(listDeckTags(1).map((tag) => tag.id).sort((a, b) => a - b), [ramp.id, draw.id, elan.id].sort((a, b) => a - b));
  assert.throws(() => listDeckTags(999), (error) => error.status === 404);
});

test('renaming updates all assigned rows only in that deck, keeping IDs, quantities and unrelated data', () => {
  const first = add(1, 1, { quantity: 2, tags: ['Ramp', 'Draw'] });
  const second = add(1, 2, { quantity: 3, tags: ['ramp'] });
  add(2, 1, { quantity: 4, tags: ['Ramp'] });
  const ramp = listDeckTags(1).find((tag) => tag.name === 'Ramp');
  const protectedData = otherData();
  const beforeCards = db.prepare('SELECT * FROM deck_cards ORDER BY id').all();
  const renamed = renameDeckTag(1, ramp.id, 'Mana versnellen');
  assert.equal(renamed.id, ramp.id);
  assert.equal(renamed.name, 'Mana versnellen');
  assert.equal(renamed.cardCount, 2, 'cardCount counts assigned rows, not physical quantity');
  assert.deepEqual(getDeckCard(first.id).tags, ['Draw', 'Mana versnellen']);
  assert.deepEqual(getDeckCard(second.id).tags, ['Mana versnellen']);
  assert.deepEqual(db.prepare('SELECT * FROM deck_cards ORDER BY id').all(), beforeCards);
  assert.deepEqual(otherData(), protectedData);
  renameDeckTag(1, ramp.id, 'MANA VERSNELLEN');
  assert.equal(listDeckTags(1).find((tag) => tag.id === ramp.id).name, 'MANA VERSNELLEN');
  assert.deepEqual(getDeckCard(second.id).tags, ['MANA VERSNELLEN']);
});

test('rename collisions and cross-deck CRUD are rejected without any changes', () => {
  add(1, 1, { tags: ['Ramp', 'Draw'] });
  const other = createDeckTag(2, 'Protection');
  const ramp = listDeckTags(1).find((tag) => tag.name === 'Ramp');
  const before = fullSnapshot();
  assert.throws(() => renameDeckTag(1, ramp.id, ' draw '), (error) => error.status === 409);
  assert.throws(() => renameDeckTag(1, other.id, 'Moved'), (error) => error.status === 404);
  assert.throws(() => deleteDeckTag(1, other.id), (error) => error.status === 404);
  assert.deepEqual(fullSnapshot(), before);
});

test('deleting a tag removes only its assignments and never removes cards or another deck’s tag', () => {
  const first = add(1, 1, { quantity: 2, tags: ['Ramp', 'Draw'] });
  add(1, 2, { tags: ['Ramp'] });
  add(2, 1, { tags: ['Ramp'] });
  const ramp = listDeckTags(1).find((tag) => tag.name === 'Ramp');
  const protectedData = otherData();
  const beforeCards = db.prepare('SELECT * FROM deck_cards ORDER BY id').all();
  deleteDeckTag(1, ramp.id);
  assert.deepEqual(listDeckTags(1).map((tag) => tag.name), ['Draw']);
  assert.deepEqual(getDeckCard(first.id).tags, ['Draw']);
  assert.deepEqual(db.prepare('SELECT * FROM deck_cards ORDER BY id').all(), beforeCards);
  assert.deepEqual(otherData(), protectedData);
  migrateDeckTags(db);
  assert.deepEqual(listDeckTags(1).map((tag) => tag.name), ['Draw'], 'restart migration does not resurrect deleted tags');
});

test('stable selected IDs follow renames while deleted or foreign IDs fail before deck mutations', () => {
  const ramp = createDeckTag(1, 'Ramp');
  const other = createDeckTag(2, 'Foreign');
  renameDeckTag(1, ramp.id, 'Acceleration');
  const added = add(1, 1, { quantity: 2, tagIds: [ramp.id, ramp.id] });
  assert.deepEqual(added.tags, ['Acceleration']);
  assert.deepEqual(added.tagIds, [ramp.id]);
  deleteDeckTag(1, ramp.id);
  const before = fullSnapshot();
  for (const id of [ramp.id, other.id]) {
    assert.throws(() => add(1, 1, { quantity: 3, tagIds: [id] }), (error) => error.status === 409);
    assert.throws(() => edit(1, added, { quantity: 9, tagIds: [id] }), (error) => error.status === 409);
  }
  assert.deepEqual(fullSnapshot(), before);
});

test('strict name selection only uses registered tags and omitted editing selection preserves assignments', () => {
  const ramp = createDeckTag(1, 'Ramp');
  const added = add(1, 1, { tags: ['ramp'], strictTags: true });
  assert.deepEqual(added.tags, ['Ramp']);
  assert.deepEqual(added.tagIds, [ramp.id]);
  const before = fullSnapshot();
  assert.throws(() => add(1, 2, { tags: ['Invented'], strictTags: true }), (error) => error.status === 409);
  assert.deepEqual(fullSnapshot(), before);
  const edited = edit(1, added, { quantity: 4, note: 'Changed note' });
  assert.deepEqual(edited.tags, ['Ramp']);
  assert.equal(edited.quantity, 4);
  const cleared = edit(1, edited, { tagIds: [] });
  assert.deepEqual(cleared.tags, []);
  assert.equal(listDeckTags(1)[0].id, ramp.id, 'clearing assignment preserves reusable tag definition');
});

test('a rejected tag selection rolls back a combined collection/deck transaction including Wanted reconciliation', () => {
  const stale = createDeckTag(1, 'Removed');
  deleteDeckTag(1, stale.id);
  const before = fullSnapshot();
  assert.throws(() => transaction(() => {
    addCollectionItem({ cardId: 2, quantity: 2, finish: 'nonfoil', language: 'en', condition: 'near_mint',
      location: 'New box', notes: '', purchasePrice: null, reconcileWanted: true });
    add(1, 2, { tagIds: [stale.id] });
  }), (error) => error.status === 409);
  assert.deepEqual(fullSnapshot(), before);
  assert.equal(db.isTransaction, false);
});

test('duplicating a deck copies assigned and unused definitions with new IDs and independent lifecycle', () => {
  add(1, 1, { quantity: 2, tags: ['Ramp'] });
  createDeckTag(1, 'Unused protection');
  const originalTags = listDeckTags(1);
  const copy = duplicateDeck(1, 'Deck copy');
  const copiedTags = listDeckTags(copy.id);
  assert.deepEqual(copiedTags.map((tag) => [tag.name, tag.cardCount]), originalTags.map((tag) => [tag.name, tag.cardCount]));
  assert.ok(copiedTags.every((tag) => originalTags.every((source) => source.id !== tag.id)));
  assert.deepEqual(getDeckCards(copy.id).map((row) => [row.quantity, row.tags]), [[2, ['Ramp']]]);
  const copiedRamp = copiedTags.find((tag) => tag.name === 'Ramp');
  renameDeckTag(copy.id, copiedRamp.id, 'Different plan');
  assert.deepEqual(getDeckCards(1).map((row) => row.tags), [['Ramp']]);
  deleteDeck(copy.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deck_tags WHERE deck_id=?').get(copy.id).n, 0);
  assert.deepEqual(listDeckTags(1), originalTags);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
