import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-deck-synergies-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'synergies.sqlite';

const { db, transaction, closeDatabase } = await import('../src/db/database.js');
const { addDeckCard, deleteDeckCard, duplicateDeck, getDeckCards } = await import('../src/services/deck-service.js');
const { calculateDeckStats } = await import('../src/services/deck-stats-service.js');
const { getDeckRevision } = await import('../src/services/deck-revision-service.js');
const {
  createDeckCardLink, updateDeckCardLink, deleteDeckCardLink, getDeckCardLink,
  listDeckCardLinks, setDeckCardSynergies, reassignDeckCardLinks
} = await import('../src/services/deck-link-service.js');

for (let id = 1; id <= 4; id++) {
  db.prepare(`INSERT INTO cards
    (id, scryfall_id, oracle_id, name, search_name, set_code, collector_number,
     card_types_json, finishes_json, raw_json)
    VALUES (?, ?, ?, ?, ?, 'tst', ?, '["Creature"]', '["nonfoil","foil"]', '{}')`)
    .run(id, `synergy-printing-${id}`, `synergy-oracle-${id}`, `Card ${id}`, `card ${id}`, String(id));
}

beforeEach(() => {
  db.exec(`DROP TRIGGER IF EXISTS test_fail_synergy_insert;
    DELETE FROM decks; DELETE FROM collection_items; DELETE FROM wanted_items;
    INSERT INTO decks (id, name) VALUES (1, 'Synergy target'), (2, 'Other deck');
    INSERT INTO collection_items (card_id, quantity, finish, location) VALUES (1, 4, 'foil', 'Keep binder');
    INSERT INTO collection_items (card_id, quantity, finish, location) VALUES (1, 3, 'nonfoil', 'Keep box');
    INSERT INTO wanted_items (card_id, quantity, notes) VALUES (2, 5, 'Keep wanted');`);
});
after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function add(deckId, cardId, overrides = {}) {
  return addDeckCard(deckId, { cardId, quantity: 1, role: 'main', note: '', ...overrides });
}
function synergy(name, deckCardIds = [], deckId = 1) {
  return createDeckCardLink(deckId, { name, type: 'synergy', note: 'Keep note', deckCardIds });
}
function snapshot() {
  return ['decks', 'deck_cards', 'deck_tags', 'deck_card_tags', 'deck_card_groups',
    'deck_card_group_members', 'collection_items', 'wanted_items']
    .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);
}
function protectedData() {
  return ['cards', 'deck_cards', 'deck_tags', 'deck_card_tags', 'collection_items', 'wanted_items']
    .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);
}
function members(id) {
  return db.prepare('SELECT * FROM deck_card_group_members WHERE group_id = ? ORDER BY position, deck_card_id').all(id);
}

test('synergies can be created before cards, preserve per-deck identity and reject duplicate names', () => {
  const before = protectedData();
  const empty = createDeckCardLink(1, { name: '  Landfall  ' });
  assert.equal(empty.type, 'synergy');
  assert.equal(empty.name, 'Landfall');
  assert.equal(empty.memberCount, 0);
  assert.deepEqual(empty.members, []);
  synergy('Landfall', [], 2);
  const elan = synergy('Élan');
  for (const name of ['landfall', ' LANDFALL ', 'E\u0301lan']) {
    assert.throws(() => synergy(name), (error) => error.status === 409);
  }
  assert.throws(() => updateDeckCardLink(1, elan.id, { name: 'Landfall' }), (error) => error.status === 409);
  assert.deepEqual(protectedData(), before);
  assert.equal(listDeckCardLinks(1).length, 2);
});

test('a card can join multiple synergies while other members, combos, ordering and physical data remain intact', () => {
  const first = add(1, 1, { quantity: 3, tags: ['Draw'] });
  const second = add(1, 2);
  const third = add(1, 3);
  const foreignCard = add(2, 1, { quantity: 9 });
  const empty = synergy('New strategy');
  const existing = synergy('Existing order', [third.id, second.id]);
  const foreign = synergy('Other deck', [foreignCard.id], 2);
  const combo = createDeckCardLink(1, { name: 'Combo', type: 'combo', deckCardIds: [second.id, first.id] });
  const beforeProtected = protectedData();
  const beforeCombo = getDeckCardLink(1, combo.id);
  const beforeForeign = getDeckCardLink(2, foreign.id);
  const beforeExisting = members(existing.id);
  const selected = setDeckCardSynergies(1, first.id, [empty.id, existing.id, empty.id]);
  assert.deepEqual(selected.map((group) => group.id).sort(), [empty.id, existing.id].sort());
  assert.deepEqual(getDeckCardLink(1, existing.id).members.map((item) => item.deckCardId), [third.id, second.id, first.id]);
  assert.deepEqual(members(existing.id).filter((row) => row.deck_card_id !== first.id), beforeExisting);
  assert.deepEqual(getDeckCardLink(1, combo.id), beforeCombo);
  assert.deepEqual(getDeckCardLink(2, foreign.id), beforeForeign);
  assert.deepEqual(protectedData(), beforeProtected);
  assert.deepEqual(getDeckCards(1).find((item) => item.id === first.id).relations.map((group) => group.id).sort(),
    [empty.id, existing.id, combo.id].sort());
  const totalChanges = db.prepare('SELECT total_changes() AS n').get().n;
  setDeckCardSynergies(1, first.id, [existing.id, empty.id]);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, totalChanges, 'repeated assignment is a no-op');
  setDeckCardSynergies(1, first.id, []);
  assert.equal(getDeckCardLink(1, empty.id).memberCount, 0, 'unassigned synergies remain available');
  assert.deepEqual(members(existing.id), beforeExisting);
  assert.deepEqual(getDeckCardLink(1, combo.id), beforeCombo);
  assert.deepEqual(protectedData(), beforeProtected);
});

test('invalid, removed, combo and cross-deck selections reject the entire membership change', () => {
  const first = add(1, 1);
  const second = add(1, 2);
  const foreignCard = add(2, 1);
  const current = synergy('Current', [first.id]);
  const next = synergy('Next');
  const foreign = synergy('Foreign', [], 2);
  const removed = synergy('Removed');
  deleteDeckCardLink(1, removed.id);
  const combo = createDeckCardLink(1, { name: 'Keep combo', type: 'combo', deckCardIds: [first.id, second.id] });
  for (const ids of [undefined, null, '1', [0], [true], [1.5], [next.id, foreign.id], [next.id, removed.id], [combo.id]]) {
    const before = snapshot();
    assert.throws(() => setDeckCardSynergies(1, first.id, ids), (error) => [400, 409].includes(error.status));
    assert.deepEqual(snapshot(), before);
  }
  const before = snapshot();
  assert.throws(() => setDeckCardSynergies(1, foreignCard.id, [current.id]), (error) => error.status === 404);
  assert.throws(() => setDeckCardSynergies(1, 99999, []), (error) => error.status === 404);
  assert.throws(() => setDeckCardSynergies(999, first.id, []), (error) => error.status === 404);
  assert.deepEqual(snapshot(), before);
});

test('membership replacement rolls back removals when a later insertion fails', () => {
  const first = add(1, 1);
  const current = synergy('A current', [first.id]);
  const next = synergy('Z next');
  db.exec(`CREATE TEMP TRIGGER test_fail_synergy_insert BEFORE INSERT ON deck_card_group_members
    WHEN NEW.group_id = ${next.id}
    BEGIN SELECT RAISE(ABORT, 'Simulated synergy failure'); END;`);
  const before = snapshot();
  assert.throws(() => setDeckCardSynergies(1, first.id, [next.id]), /Simulated synergy failure/);
  assert.deepEqual(snapshot(), before);
  assert.equal(getDeckCardLink(1, current.id).memberCount, 1);
});

test('renaming preserves membership rows and notes and cannot move or delete another deck’s synergy', () => {
  const first = add(1, 1);
  const second = add(1, 2);
  const group = synergy('Original', [second.id, first.id]);
  const foreign = synergy('Foreign', [], 2);
  const beforeMembers = members(group.id);
  const beforeProtected = protectedData();
  const renamed = updateDeckCardLink(1, group.id, { name: 'New name' });
  assert.equal(renamed.id, group.id);
  assert.equal(renamed.type, 'synergy');
  assert.equal(renamed.note, 'Keep note');
  assert.equal(renamed.name, 'New name');
  assert.deepEqual(members(group.id), beforeMembers);
  assert.deepEqual(protectedData(), beforeProtected);
  const before = snapshot();
  assert.throws(() => updateDeckCardLink(1, foreign.id, { name: 'Moved' }), (error) => error.status === 404);
  assert.throws(() => deleteDeckCardLink(1, foreign.id), (error) => error.status === 404);
  assert.deepEqual(snapshot(), before);
  deleteDeckCardLink(1, group.id);
  assert.deepEqual(protectedData(), beforeProtected);
  assert.deepEqual(members(group.id), []);
  assert.ok(getDeckCardLink(2, foreign.id));
});

test('combos still require two valid deck cards and invalid edits do not delete existing memberships', () => {
  const first = add(1, 1);
  const second = add(1, 2);
  const foreign = add(2, 1);
  const current = synergy('Singleton', [first.id]);
  const before = snapshot();
  for (const deckCardIds of [[], [first.id], [first.id, first.id], [first.id, foreign.id], [first.id, true]]) {
    assert.throws(() => createDeckCardLink(1, { name: 'Invalid', type: 'combo', deckCardIds }),
      (error) => error.status === 400);
  }
  assert.throws(() => updateDeckCardLink(1, current.id, { type: 'combo' }), (error) => error.status === 400);
  assert.throws(() => updateDeckCardLink(1, current.id, { deckCardIds: [foreign.id] }), (error) => error.status === 400);
  assert.deepEqual(snapshot(), before);
  const combo = createDeckCardLink(1, { name: 'Legacy input', type: 'combo', firstDeckCardId: second.id, secondDeckCardId: first.id });
  assert.deepEqual(combo.members.map((member) => member.deckCardId), [second.id, first.id]);
});

test('card deletion keeps singleton and empty synergies available while collapsed combos are removed', () => {
  const first = add(1, 1);
  const second = add(1, 2);
  const empty = synergy('Empty');
  const paired = synergy('Pair', [first.id, second.id]);
  const combo = createDeckCardLink(1, { name: 'Pair combo', type: 'combo', deckCardIds: [first.id, second.id] });
  deleteDeckCard(1, first.id);
  assert.equal(getDeckCardLink(1, paired.id).memberCount, 1);
  assert.equal(getDeckCardLink(1, combo.id), null);
  deleteDeckCard(1, second.id);
  assert.deepEqual(listDeckCardLinks(1).map((group) => [group.id, group.memberCount]).sort(), [[empty.id, 0], [paired.id, 0]].sort());
});

test('merging printings keeps a collapsed synergy and still cleans up its collapsed combo', () => {
  const old = add(1, 1);
  const target = add(1, 2);
  const group = synergy('Merge survives', [old.id, target.id]);
  const combo = createDeckCardLink(1, { name: 'Collapsed combo', type: 'combo', deckCardIds: [old.id, target.id] });
  transaction(() => {
    reassignDeckCardLinks(1, old.id, target.id);
    db.prepare('DELETE FROM deck_cards WHERE id = ?').run(old.id);
  });
  assert.deepEqual(getDeckCardLink(1, group.id).members.map((member) => member.deckCardId), [target.id]);
  assert.equal(getDeckCardLink(1, combo.id), null);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('deck duplication copies empty and singleton definitions with new IDs and remapped memberships', () => {
  const first = add(1, 1);
  synergy('Empty');
  synergy('Single', [first.id]);
  const originals = listDeckCardLinks(1);
  const duplicate = duplicateDeck(1, 'Copied');
  const copied = listDeckCardLinks(duplicate.id);
  assert.deepEqual(copied.map((group) => [group.name, group.memberCount, group.note]),
    originals.map((group) => [group.name, group.memberCount, group.note]));
  assert.ok(copied.every((group) => !originals.some((original) => original.id === group.id)));
  const copiedCard = getDeckCards(duplicate.id)[0];
  assert.deepEqual(copied.find((group) => group.name === 'Single').members.map((member) => member.deckCardId), [copiedCard.id]);
  assert.deepEqual(listDeckCardLinks(1), originals);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('empty groups and membership changes update live revisions and statistics handle empty groups', () => {
  const first = add(1, 1);
  let previous = getDeckRevision(1).revision;
  const assertChanged = () => {
    const revision = getDeckRevision(1).revision;
    assert.notEqual(revision, previous);
    previous = revision;
  };
  const group = synergy('Empty');
  assertChanged();
  const emptyStats = calculateDeckStats(1);
  assert.equal(emptyStats.links.totalGroups, 1);
  assert.equal(emptyStats.links.memberships, 0);
  assert.equal(emptyStats.links.averageGroupSize, 0);
  setDeckCardSynergies(1, first.id, [group.id]);
  assertChanged();
  updateDeckCardLink(1, group.id, { name: 'Renamed' });
  assertChanged();
  setDeckCardSynergies(1, first.id, []);
  assertChanged();
  deleteDeckCardLink(1, group.id);
  assertChanged();
});

test('HTTP links and per-card synergy routes support empty creation, rename and validated membership replacement', async (t) => {
  let express;
  try {
    ({ default: express } = await import('express'));
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    t.skip('Installeer de Express-afhankelijkheid om de HTTP-integratietest uit te voeren.');
    return;
  }
  const { decksReadRouter, decksWriteRouter } = await import('../src/routes/decks.js');
  const first = add(1, 1);
  const foreignCard = add(2, 1);
  const app = express();
  app.use(express.json());
  app.use('/api/read/decks', decksReadRouter);
  app.use('/api/write/decks', decksWriteRouter);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { message: error.message } }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (method, route, body) => fetch(`${origin}/api/${method === 'GET' ? 'read' : 'write'}/decks/${route}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const created = await request('POST', '1/links', { name: 'HTTP synergy', type: 'synergy', deckCardIds: [] });
  assert.equal(created.status, 201);
  const group = (await created.json()).data;
  assert.equal(group.memberCount, 0);
  const assigned = await request('PUT', `1/cards/${first.id}/synergies`, { synergyIds: [group.id] });
  assert.equal(assigned.status, 200);
  assert.deepEqual((await assigned.json()).data.map((entry) => entry.id), [group.id]);
  const renamed = await request('PATCH', `1/links/${group.id}`, { name: 'HTTP renamed' });
  assert.equal(renamed.status, 200);
  assert.deepEqual((await renamed.json()).data.members.map((member) => member.deckCardId), [first.id]);
  const listed = await request('GET', '1/links');
  assert.equal(listed.headers.get('cache-control'), 'no-store');
  assert.equal((await listed.json()).data[0].name, 'HTTP renamed');
  assert.equal((await request('PUT', `1/cards/${foreignCard.id}/synergies`, { synergyIds: [group.id] })).status, 404);
  assert.equal((await request('PUT', `1/cards/${first.id}/synergies`, {})).status, 400);
  assert.equal((await request('POST', '1/links', { name: 'Invalid combo', type: 'combo', deckCardIds: [] })).status, 400);
  assert.equal((await request('PUT', `1/cards/${first.id}/synergies`, { synergyIds: [] })).status, 200);
  assert.equal(getDeckCardLink(1, group.id).memberCount, 0);
});
