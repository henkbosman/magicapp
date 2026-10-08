import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-printing-identity-'));
process.env.DATA_DIR = directory;
process.env.DATABASE_FILE = 'identity.sqlite';
const { db, closeDatabase } = await import('../src/db/database.js');
const { upsertScryfallCard, addCollectionItem } = await import('../src/services/card-repository.js');

after(() => {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

const raw = {
  id: 'guard-printing', oracle_id: 'guard-oracle-a', name: 'Guard Card A',
  set: 'tst', collector_number: '1', lang: 'en', type_line: 'Creature — Elf',
  games: ['paper'], finishes: ['nonfoil', 'foil'], oracle_text: 'Original text.'
};
const card = upsertScryfallCard(raw);
addCollectionItem({ cardId: card.id, quantity: 2, finish: 'foil', language: 'en',
  condition: 'near_mint', location: 'Map', notes: 'Owned A', purchasePrice: 2, reconcileWanted: false });
db.prepare('INSERT INTO wanted_items (card_id, quantity, notes) VALUES (?, 3, ?)').run(card.id, 'Wanted A');
const snapshot = () => ['cards', 'collection_items', 'wanted_items'].map((table) => db.prepare(`SELECT * FROM ${table}`).all());

test('een bestaand printing-ID kan niet naar een andere kaartidentiteit worden omgebogen', () => {
  const before = snapshot();
  assert.throws(() => upsertScryfallCard({ ...raw, oracle_id: 'guard-oracle-b', name: 'Other Card B' }),
    (error) => error.status === 409);
  assert.deepEqual(snapshot(), before);
});

test('onvolledige externe gegevens wissen geen bestaande Oracle-identiteit', () => {
  const before = snapshot();
  assert.throws(() => upsertScryfallCard({ ...raw, oracle_id: null }), (error) => error.status === 409);
  assert.deepEqual(snapshot(), before);
});

test('normale metadatarefresh behoudt identiteit en fysieke collectiegegevens', () => {
  const beforeOwned = db.prepare('SELECT * FROM collection_items').all();
  const updated = upsertScryfallCard({ ...raw, oracle_text: 'Updated rules text.', prices: { eur_foil: '5.00' } });
  assert.equal(updated.id, card.id);
  assert.equal(updated.oracleId, raw.oracle_id);
  assert.equal(updated.oracleText, 'Updated rules text.');
  assert.deepEqual(db.prepare('SELECT * FROM collection_items').all(), beforeOwned);
});
