import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-card-cache-identity-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'collection.sqlite';

const { db, closeDatabase } = await import('../src/db/database.js');
const { ensureCard } = await import('../src/services/card-cache-service.js');
const { addDeckCard } = await import('../src/services/deck-service.js');
const { scryfallService } = await import('../src/services/scryfall-service.js');

const ids = {
  elves: 'a0000000-0000-4000-8000-000000000001',
  other: 'a0000000-0000-4000-8000-000000000002'
};
db.prepare(`INSERT INTO cards (id, scryfall_id, oracle_id, name, search_name, language, raw_json)
  VALUES (?, ?, ?, ?, ?, 'en', '{"games":["paper"]}')`)
  .run(1, 'elves-printing', ids.elves, 'Llanowar Elves', 'llanowar elves');
db.prepare(`INSERT INTO cards (id, scryfall_id, oracle_id, name, search_name, language, raw_json)
  VALUES (?, ?, ?, ?, ?, 'en', '{"games":["paper"]}')`)
  .run(2, 'other-printing', ids.other, 'Different Card', 'different card');
db.prepare(`INSERT INTO cards (id, scryfall_id, name, search_name, language, raw_json)
  VALUES (3, 'legacy-printing', 'Legacy Card', 'legacy card', 'en', '{}')`).run();
db.prepare("INSERT INTO decks (id, name) VALUES (1, 'Identity test')").run();

beforeEach(() => db.exec('DELETE FROM deck_cards'));
after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function resolveAndAdd(input) {
  // The existing POST /decks/:id/cards resolves before changing deck contents.
  const card = await ensureCard(input);
  return addDeckCard(1, { cardId: card.id, quantity: 1, role: 'main', note: '', tags: [] });
}

test('catalogusnaam met passend Oracle-ID gebruikt een bestaande printing en voegt die toe', async () => {
  const added = await resolveAndAdd({ name: 'Llanowar Elves', expectedOracleId: ids.elves.toUpperCase() });
  assert.equal(added.card.id, 1);
  assert.equal(added.card.oracleId, ids.elves);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deck_cards').get().n, 1);
});

test('een afwijkend of ontbrekend Oracle-ID weigert de toevoeging voor de deckmutatie', async () => {
  for (const input of [
    { name: 'Llanowar Elves', expectedOracleId: ids.other },
    { name: 'Legacy Card', expectedOracleId: ids.elves },
    { cardId: 2, expectedOracleId: ids.elves }
  ]) {
    await assert.rejects(() => resolveAndAdd(input), (error) => error.status === 409 && /Kaart opzoeken/.test(error.message));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deck_cards').get().n, 0);
});

test('gelijknamige catalogusvarianten kunnen niet per ongeluk elkaars nieuwere printing toevoegen', async () => {
  db.prepare(`INSERT INTO cards (id, scryfall_id, oracle_id, name, search_name, language, released_at, raw_json)
    VALUES (4, 'other-elves-printing', ?, 'Llanowar Elves', 'llanowar elves', 'en', '2026-10-03', '{"games":["paper"]}')`)
    .run(ids.other);
  try {
    assert.equal((await ensureCard({ name: 'Llanowar Elves' })).id, 4);
    await assert.rejects(() => resolveAndAdd({ name: 'Llanowar Elves', expectedOracleId: ids.elves }),
      (error) => error.status === 409);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deck_cards').get().n, 0);
  } finally {
    db.prepare('DELETE FROM cards WHERE id = 4').run();
  }
});

test('optionele identiteitscontrole verandert bestaande lokale en naamverzoeken niet', async () => {
  assert.equal((await ensureCard({ cardId: 2 })).id, 2);
  assert.equal((await ensureCard({ name: 'Llanowar Elves' })).id, 1);
  assert.equal((await ensureCard({ name: 'Legacy Card' })).id, 3);
  assert.equal((await ensureCard({ name: 'Legacy Card', expectedOracleId: null })).id, 3);
});

test('ongeldige verwachte identifiers worden geweigerd voordat een naam wordt opgezocht', async (t) => {
  const lookup = t.mock.method(scryfallService, 'getByName', () => { throw new Error('Unexpected lookup'); });
  for (const expectedOracleId of ['', 'invalid', 7, {}, [], '10000000-0000-4000-8000-zzzzzzzzzzzz']) {
    await assert.rejects(() => ensureCard({ name: 'Not cached', expectedOracleId }), (error) => error.status === 400);
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deck_cards').get().n, 0);
});
