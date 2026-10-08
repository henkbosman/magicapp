import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-collection-integrity-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'integrity.sqlite';

const repository = await import('../src/services/card-repository.js');
const { db, closeDatabase } = await import('../src/db/database.js');
let sequence = 0;

function fixture(finishes = ['nonfoil', 'foil', 'etched']) {
  const number = ++sequence;
  const id = `aa000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
  const raw = {
    id, oracle_id: id, name: `Integrity card ${number}`, cmc: 1,
    mana_cost: '{G}', colors: ['G'], color_identity: ['G'], type_line: 'Creature — Elf',
    oracle_text: 'A test card.', keywords: [], set: 'tst', set_name: 'Integrity Test',
    collector_number: String(number), rarity: 'common', lang: 'en', games: ['paper'],
    finishes, prices: { eur: '1.00', eur_foil: '2.00' }
  };
  return { raw, card: repository.upsertScryfallCard(raw) };
}

function input(card, overrides = {}) {
  return {
    cardId: card.id, quantity: 1, finish: 'nonfoil', language: 'en', condition: 'near_mint',
    location: '', notes: '', purchasePrice: null, reconcileWanted: false, ...overrides
  };
}

function rowSnapshot() {
  return db.prepare('SELECT * FROM collection_items ORDER BY id').all();
}

function status(expected) {
  return (error) => error.status === expected;
}

after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('owned finish remains attached to its collection row across adds, listing, filtering and cache refresh', () => {
  const { card, raw } = fixture();
  const other = fixture().card;
  const foil = repository.addCollectionItem(input(card, { finish: 'foil', quantity: 2 }));
  const plain = repository.addCollectionItem(input(card, { quantity: 3 }));
  const etched = repository.addCollectionItem(input(card, { finish: 'etched' }));
  repository.addCollectionItem(input(other, { quantity: 9, finish: 'foil' }));
  repository.addCollectionItem(input(card, { finish: 'foil', quantity: 4 }));
  const beforeRead = rowSnapshot();
  const expected = new Map([[foil.id, ['foil', 6]], [plain.id, ['nonfoil', 3]], [etched.id, ['etched', 1]]]);
  for (const item of repository.listCollection({ cardKey: card.cardKey }).items) {
    assert.deepEqual([item.finish, item.quantity], expected.get(item.id));
    const detail = repository.getCollectionItem(item.id);
    assert.deepEqual([detail.finish, detail.quantity, detail.revision], [item.finish, item.quantity, item.revision]);
    assert.equal(item.card.id, card.id);
  }
  assert.deepEqual(repository.listCollection({ cardKey: card.cardKey, finish: 'foil' }).items.map((item) => item.id), [foil.id]);
  assert.deepEqual(rowSnapshot(), beforeRead, 'reads may not mutate physical ownership');
  const revision = repository.getCollectionItem(foil.id).revision;
  repository.upsertScryfallCard({ ...raw, finishes: ['etched', 'foil', 'nonfoil'], prices: { eur_foil: '99.99' } });
  assert.deepEqual(rowSnapshot(), beforeRead, 'refreshing printing metadata may not alter owned variants');
  assert.equal(repository.getCollectionItem(foil.id).revision, revision);
});

test('unsupported finish writes fail without changing collection or Wanted; legacy rows are not silently repaired', () => {
  const { card } = fixture(['nonfoil']);
  const item = repository.addCollectionItem(input(card));
  db.prepare('INSERT INTO wanted_items (card_id, quantity) VALUES (?, ?)').run(card.id, 4);
  const before = rowSnapshot();
  assert.throws(() => repository.addCollectionItem(input(card, { finish: 'foil', reconcileWanted: true })), status(400));
  assert.throws(() => repository.updateCollectionItem(item.id, input(card, { finish: 'etched' })), status(400));
  assert.deepEqual(rowSnapshot(), before);
  assert.equal(db.prepare('SELECT quantity FROM wanted_items WHERE card_id = ?').get(card.id).quantity, 4);

  db.prepare("UPDATE collection_items SET finish = 'foil' WHERE id = ?").run(item.id);
  const historical = repository.getCollectionItem(item.id);
  const updated = repository.updateCollectionItem(item.id, { ...historical, quantity: 2, expectedRevision: historical.revision });
  assert.equal(updated.finish, 'foil');
  assert.equal(updated.quantity, 2);
});

test('adding the same physical variant preserves both notes and known purchase price', () => {
  const { card } = fixture();
  const first = repository.addCollectionItem(input(card, { quantity: 2, notes: 'Purchased at the fair', purchasePrice: 1.25 }));
  const merged = repository.addCollectionItem(input(card, { quantity: 3, notes: 'Gift from a friend' }));
  assert.equal(merged.id, first.id);
  assert.equal(merged.quantity, 5);
  assert.equal(merged.notes, 'Purchased at the fair\n\nGift from a friend');
  assert.equal(merged.purchasePrice, 1.25);
  const repeated = repository.addCollectionItem(input(card, { notes: merged.notes, purchasePrice: 1.25 }));
  assert.equal(repeated.notes, merged.notes);
});

test('conflicting acquisition prices fail atomically instead of overwriting existing purchase data', () => {
  const { card } = fixture();
  repository.addCollectionItem(input(card, { notes: 'Existing purchase', purchasePrice: 1.25 }));
  db.prepare('INSERT INTO wanted_items (card_id, quantity) VALUES (?, ?)').run(card.id, 3);
  const before = rowSnapshot();
  assert.throws(() => repository.addCollectionItem(input(card, { quantity: 2, notes: 'New purchase', purchasePrice: 2.5, reconcileWanted: true })), status(409));
  assert.deepEqual(rowSnapshot(), before);
  assert.equal(db.prepare('SELECT quantity FROM wanted_items WHERE card_id = ?').get(card.id).quantity, 3);
});

test('edit collision preserves quantities and notes, rejecting price conflicts without deleting either source row', () => {
  const { card } = fixture();
  const target = repository.addCollectionItem(input(card, { quantity: 2, finish: 'foil', notes: 'Target notes', purchasePrice: 2 }));
  const source = repository.addCollectionItem(input(card, { quantity: 3, notes: 'Source notes', purchasePrice: 1 }));
  const before = rowSnapshot();
  assert.throws(() => repository.updateCollectionItem(source.id, { ...source, finish: 'foil', expectedRevision: source.revision }), status(409));
  assert.deepEqual(rowSnapshot(), before);
  const merged = repository.updateCollectionItem(source.id, { ...source, finish: 'foil', purchasePrice: 2, expectedRevision: source.revision });
  assert.equal(merged.id, target.id);
  assert.equal(merged.finish, 'foil');
  assert.equal(merged.quantity, 5);
  assert.equal(merged.notes, 'Target notes\n\nSource notes');
  assert.equal(repository.getCollectionItem(source.id), null);
});

test('merging oversized notes rejects without truncating or partially changing ownership', () => {
  const { card } = fixture();
  repository.addCollectionItem(input(card, { notes: 'a'.repeat(3000) }));
  const source = repository.addCollectionItem(input(card, { finish: 'foil', notes: 'b'.repeat(3000) }));
  const before = rowSnapshot();
  assert.throws(() => repository.addCollectionItem(input(card, { notes: 'c'.repeat(3000) })), status(409));
  assert.throws(() => repository.updateCollectionItem(source.id, { ...source, finish: 'nonfoil' }), status(409));
  assert.deepEqual(rowSnapshot(), before);
});

test('a stale quantity edit cannot restore an old finish and a stale delete cannot remove new acquisitions', () => {
  const { card } = fixture();
  const original = repository.addCollectionItem(input(card, { finish: 'foil' }));
  const current = repository.updateCollectionItem(original.id, { ...original, finish: 'nonfoil', expectedRevision: original.revision });
  assert.throws(() => repository.updateCollectionItem(original.id, { ...original, quantity: 5, expectedRevision: original.revision }), status(409));
  assert.equal(repository.getCollectionItem(original.id).finish, 'nonfoil');
  assert.notEqual(current.revision, original.revision);
  repository.addCollectionItem(input(card, { quantity: 2 }));
  const before = rowSnapshot();
  assert.throws(() => repository.deleteCollectionItem(current.id, { expectedRevision: current.revision }), status(409));
  assert.throws(() => repository.updateCollectionItem(current.id, { ...current, quantity: 0, expectedRevision: current.revision }), status(409));
  assert.deepEqual(rowSnapshot(), before);
  const latest = repository.getCollectionItem(current.id);
  repository.deleteCollectionItem(latest.id, { expectedRevision: latest.revision });
  assert.equal(repository.getCollectionItem(latest.id), null);
});

test('invalid revision values fail closed; legacy callers can still edit without the optional revision', () => {
  const { card } = fixture();
  const item = repository.addCollectionItem(input(card));
  const before = rowSnapshot();
  for (const expectedRevision of ['', null, [], 1, 'invalid']) {
    assert.throws(() => repository.updateCollectionItem(item.id, { ...item, quantity: 0, expectedRevision }), status(400));
    assert.throws(() => repository.deleteCollectionItem(item.id, { expectedRevision }), status(400));
  }
  assert.deepEqual(rowSnapshot(), before);
  assert.equal(repository.updateCollectionItem(item.id, { ...item, quantity: 2 }).quantity, 2);
});

test('quantity aggregation rejects totals outside safe integer precision before changing either row', () => {
  const { card } = fixture();
  repository.addCollectionItem(input(card, { quantity: Number.MAX_SAFE_INTEGER - 1 }));
  const source = repository.addCollectionItem(input(card, { finish: 'foil' }));
  const before = rowSnapshot();
  assert.throws(() => repository.addCollectionItem(input(card, { quantity: 2 })), status(400));
  assert.throws(() => repository.updateCollectionItem(source.id, { ...source, quantity: 2, finish: 'nonfoil' }), status(400));
  assert.deepEqual(rowSnapshot(), before);
});

test('HTTP collection PATCH rejects empty finish and preserves stale-revision protection for PATCH and DELETE', async (t) => {
  let express;
  try {
    ({ default: express } = await import('express'));
  } catch {
    t.skip('Installeer Express om de HTTP-integratietest uit te voeren.');
    return;
  }
  const { collectionWriteRouter } = await import('../src/routes/collection.js');
  const app = express();
  app.use(express.json());
  app.use('/collection', collectionWriteRouter);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { card } = fixture();
  const item = repository.addCollectionItem(input(card, { finish: 'foil' }));
  const url = `http://127.0.0.1:${server.address().port}/collection/${item.id}`;
  const request = (method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const finish of ['', null, 'wrong']) {
    assert.equal((await request('PATCH', { finish })).status, 400);
    assert.equal(repository.getCollectionItem(item.id).finish, 'foil');
  }
  const response = await request('PATCH', { quantity: 2, expectedRevision: item.revision });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.finish, 'foil');
  assert.equal((await request('PATCH', { finish: 'nonfoil', expectedRevision: item.revision })).status, 409);
  assert.equal((await request('DELETE', { expectedRevision: item.revision })).status, 409);
  assert.equal(repository.getCollectionItem(item.id).quantity, 2);
});
