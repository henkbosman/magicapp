import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-add-card-identity-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'collection.sqlite';

const { db, closeDatabase } = await import('../src/db/database.js');
const { ensureCard, ensureCardsByIdentifiers, ensureCardsByCollectorLanguage } = await import('../src/services/card-cache-service.js');
const { upsertScryfallCard } = await import('../src/services/card-repository.js');
const { scryfallService } = await import('../src/services/scryfall-service.js');

const oracleA = '10000000-0000-4000-8000-000000000001';
const oracleB = '10000000-0000-4000-8000-000000000002';
const rawA = {
  id: 'printing-a', oracle_id: oracleA, name: 'New Card A', set: 'aaa', collector_number: '1',
  lang: 'en', type_line: 'Creature', finishes: ['nonfoil', 'foil'], prices: { eur: '1.00' }, games: ['paper']
};
const rawB = {
  ...rawA, id: 'printing-b', oracle_id: oracleB, name: 'Existing Card B', set: 'bbb', collector_number: '2',
  flavor_name: 'Alternate B', oracle_text: 'Keep this text.', prices: { eur: '2.00', eur_foil: '4.00' }
};
let cardB;
beforeEach(() => {
  db.exec('DELETE FROM wanted_items; DELETE FROM deck_cards; DELETE FROM decks; DELETE FROM collection_items; DELETE FROM cards;');
  cardB = upsertScryfallCard(rawB);
  db.prepare(`INSERT INTO collection_items (card_id, quantity, finish, notes, purchase_price)
    VALUES (?, 3, 'foil', 'Keep foil B', 4.5), (?, 2, 'nonfoil', 'Keep nonfoil B', 1.5)`).run(cardB.id, cardB.id);
  db.prepare("INSERT INTO decks (id, name, commander_card_id) VALUES (1, 'Keep B deck', ?)").run(cardB.id);
  db.prepare("INSERT INTO deck_cards (deck_id, card_id, quantity, note) VALUES (1, ?, 1, 'Keep deck B')").run(cardB.id);
  db.prepare("INSERT INTO wanted_items (card_id, printing_card_id, quantity, notes) VALUES (?, ?, 5, 'Keep wanted B')").run(cardB.id, cardB.id);
});
after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function snapshotB() {
  return {
    card: db.prepare('SELECT * FROM cards WHERE id = ?').get(cardB.id),
    collection: db.prepare('SELECT * FROM collection_items ORDER BY id').all(),
    decks: db.prepare('SELECT * FROM decks ORDER BY id').all(),
    deckCards: db.prepare('SELECT * FROM deck_cards ORDER BY id').all(),
    wanted: db.prepare('SELECT * FROM wanted_items ORDER BY id').all()
  };
}

function assertUntouched(before, cardCount = 1) {
  assert.deepEqual(snapshotB(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cards').get().n, cardCount);
}

test('ophalen van printing A met antwoord B wijzigt geen kaart- of gebruikersgegevens van B', async (t) => {
  const before = snapshotB();
  t.mock.method(scryfallService, 'getById', async () => ({ ...rawB, finishes: ['nonfoil'], prices: {}, oracle_text: 'Wrong replacement' }));
  await assert.rejects(() => ensureCard({ scryfallId: rawA.id }), (error) => error.status === 409);
  assertUntouched(before);
});

test('Oracle-identiteit wordt gecontroleerd voordat een remote alias een bestaande kaart kan verversen', async (t) => {
  const before = snapshotB();
  t.mock.method(scryfallService, 'getByName', async () => ({ ...rawB, finishes: ['nonfoil'], oracle_text: 'Wrong replacement' }));
  await assert.rejects(() => ensureCard({ name: 'Alternate B', expectedOracleId: oracleA }), (error) => error.status === 409);
  assertUntouched(before);
});

test('kaartnaam, set, kaartnummer en collectortaal worden vóór opslag aan de gekozen printing gebonden', async (t) => {
  const before = snapshotB();
  let response;
  t.mock.method(scryfallService, 'getByCollectorNumber', async () => response);
  for (const change of [{ set: 'bbb' }, { collector_number: '9' }, { lang: 'fr' }, { name: 'Other name' }]) {
    response = { ...rawA, ...change };
    await assert.rejects(() => ensureCard({ setCode: 'aaa', collectorNumber: '1', name: rawA.name, language: 'en' }),
      (error) => error.status === 409);
    assertUntouched(before);
  }
});

test('tegenstrijdige aanvullende identifiers bij een lokale kaart worden ook geweigerd', async () => {
  const before = snapshotB();
  for (const mismatch of [
    { name: rawA.name }, { setCode: 'aaa' }, { collectorNumber: '1' }, { expectedOracleId: oracleA }, { scryfallId: rawA.id }
  ]) {
    await assert.rejects(() => ensureCard({ cardId: cardB.id, ...mismatch }), (error) => error.status === 409);
    assertUntouched(before);
  }
});

test('een remote antwoord mag een bestaand Scryfall-ID niet voor een andere kaart hergebruiken', async (t) => {
  const before = snapshotB();
  t.mock.method(scryfallService, 'getByName', async () => ({ ...rawA, id: rawB.id }));
  await assert.rejects(() => ensureCard({ name: rawA.name }), (error) => error.status === 409);
  assertUntouched(before);
});

test('een geldige remote alias van een bestaande kaart leest zonder metadata te verversen', async (t) => {
  const before = snapshotB();
  t.mock.method(scryfallService, 'getByName', async () => ({ ...rawB, finishes: ['nonfoil'], prices: { eur: '9.99' } }));
  const found = await ensureCard({ name: 'Alternate B' });
  assert.equal(found.id, cardB.id);
  assertUntouched(before);
});

test('batchimport bewaart uitsluitend aangevraagde en overeenkomende kaarten', async (t) => {
  const before = snapshotB();
  const requested = { name: rawA.name, set: rawA.set };
  t.mock.method(scryfallService, 'getCollection', async () => ({
    cards: [{ ...rawB, oracle_text: 'Unsolicited replacement', finishes: ['nonfoil'] }, rawA], notFound: []
  }));
  const result = await ensureCardsByIdentifiers([requested]);
  assert.deepEqual(result.resolved.map(({ card }) => card.scryfallId), [rawA.id]);
  assert.deepEqual(result.notFound, []);
  assertUntouched(before, 2);
});

test('batchfouten in set of samengestelde identifiers schrijven niets weg', async (t) => {
  const before = snapshotB();
  t.mock.method(scryfallService, 'getCollection', async () => ({ cards: [rawA, { ...rawB, oracle_text: 'No write' }], notFound: [] }));
  for (const identifier of [
    { name: rawA.name, set: 'wrong' }, { id: rawA.id, name: rawB.name },
    { set: rawA.set, collector_number: rawA.collector_number, expectedOracleId: oracleB }, {}
  ]) {
    const result = await ensureCardsByIdentifiers([identifier]);
    assert.deepEqual(result.resolved, []);
    assert.deepEqual(result.notFound, [identifier]);
    assertUntouched(before);
  }
});

test('batchimport weigert hergebruik van een bestaande printing-identiteit zonder nevenmutaties', async (t) => {
  const before = snapshotB();
  const requested = { name: rawA.name };
  t.mock.method(scryfallService, 'getCollection', async () => ({ cards: [{ ...rawA, id: rawB.id }], notFound: [] }));
  const result = await ensureCardsByIdentifiers([requested]);
  assert.deepEqual(result.resolved, []);
  assert.deepEqual(result.notFound, [requested]);
  assertUntouched(before);
});

test('niet-Engelse setlookup weigert hetzelfde kaartnummer uit een andere set of taal', async (t) => {
  const before = snapshotB();
  const identifier = { set: 'aaa', collector_number: '1' };
  let response;
  t.mock.method(scryfallService, 'cardsBySetAndLanguage', async () => response);
  for (const wrong of [
    { ...rawB, collector_number: '1', lang: 'fr' },
    { ...rawA, lang: 'de' }
  ]) {
    response = [wrong];
    const result = await ensureCardsByCollectorLanguage([identifier], 'fr');
    assert.deepEqual(result.resolved, []);
    assert.deepEqual(result.notFound, [identifier]);
    assertUntouched(before);
  }
  response = [{ ...rawB, lang: 'fr' }, { ...rawA, lang: 'fr' }];
  const result = await ensureCardsByCollectorLanguage([identifier], 'fr');
  assert.equal(result.resolved[0].card.language, 'fr');
  assertUntouched(before, 2);
});

test('Engelse collectorbatch weigert andere talen en ongevraagde kaarten', async (t) => {
  const before = snapshotB();
  const identifier = { set: 'aaa', collector_number: '1' };
  t.mock.method(scryfallService, 'getCollection', async () => ({ cards: [rawB, { ...rawA, lang: 'ja' }], notFound: [] }));
  const result = await ensureCardsByCollectorLanguage([identifier], 'en');
  assert.deepEqual(result.resolved, []);
  assert.deepEqual(result.notFound, [identifier]);
  assertUntouched(before);
});

test('naamcontrole behoudt DFC-zijden en precieze Unicode-namen zonder fuzzy matching', async (t) => {
  const before = snapshotB();
  const raw = {
    ...rawA, name: 'Front A // Back A', printed_name: 'カード // 裏面',
    card_faces: [{ name: 'Front A', printed_name: 'カード' }, { name: 'Back A', printed_name: '裏面' }]
  };
  t.mock.method(scryfallService, 'getByName', async () => raw);
  assert.equal((await ensureCard({ name: 'Back A' })).scryfallId, raw.id);
  assert.equal((await ensureCard({ name: 'カード' })).scryfallId, raw.id);
  await assert.rejects(() => ensureCard({ name: 'カート' }), (error) => error.status === 409);
  assertUntouched(before, 2);
});
