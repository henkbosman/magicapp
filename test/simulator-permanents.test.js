import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  simulatorItem, isSimulatorCreature, isSimulatorBasicLand, simulatorStackKey,
  tokenChoices, addSimulatorTokens, duplicateSimulatorCreature,
  setSimulatorCounters, simulatorCounterLabel
} from '../public/js/simulator-permanents.js';

const creature = () => ({
  id: 101, oracleId: 'oracle-elf', scryfallId: 'printing-elf', cardKey: 'oracle-elf',
  name: 'Llanowar Elves', typeLine: 'Creature — Elf Druid', power: '1', toughness: '1',
  images: { normal: 'https://cards.scryfall.io/normal/front/a/b/elf.jpg' }, colors: ['G']
});
const token = (overrides = {}) => ({
  scryfallId: 'badger-printing', name: 'Badger', typeLine: 'Token Creature — Badger',
  oracleText: '', manaCost: '', colors: ['G'], power: '3', toughness: '3', keywords: [],
  images: { normal: 'https://cards.scryfall.io/normal/front/a/b/badger.jpg' }, available: true,
  ...overrides
});
const initial = () => ({ zones: { battlefield: [], hand: [], library: [], graveyard: [], exile: [], command: [] }, updatedAt: 0 });

test('type checks use front types, including snow basics and Wastes, without confusing subtypes or back faces', () => {
  for (const typeLine of ['Basic Land — Forest', 'Basic Snow Land — Forest', 'Basic Land']) {
    assert.equal(isSimulatorBasicLand({ typeLine }), true);
  }
  assert.equal(isSimulatorBasicLand({ typeLine: 'Land — Forest' }), false);
  assert.equal(isSimulatorBasicLand({ typeLine: 'Enchantment — Basic Land' }), false);
  assert.equal(isSimulatorCreature({ typeLine: 'Artifact Creature — Golem' }), true);
  assert.equal(isSimulatorCreature({ typeLine: 'Enchantment — Creature' }), false);
  assert.equal(isSimulatorCreature({ typeLine: 'Land // Creature — Elemental' }), false);
  assert.equal(isSimulatorBasicLand({ typeLine: 'Creature // Basic Land', cardFaces: [{ type_line: 'Creature — Spirit' }] }), false);
  assert.equal(isSimulatorCreature({ cardFaces: [{ typeLine: 'Creature — Elf' }] }), true);
});

test('item resolution uses the original printing for existing instances and the generated snapshot for copies', () => {
  const original = { id: 3, card: creature() };
  const byId = new Map([[3, original]]);
  assert.equal(simulatorItem({ deckCardId: '3' }, byId), original);
  assert.equal(simulatorItem({ deckCardId: 99 }, byId), null);
  const snapshot = { ...creature(), name: 'Snapshot' };
  assert.equal(simulatorItem({ deckCardId: 3, card: snapshot }, byId).card, snapshot);
});

test('stack keys group card printings and keep tapped or counter-modified instances distinct', () => {
  const first = { id: '3:1', tapped: false };
  const card = creature();
  const otherPrinting = { ...card, scryfallId: 'another-printing', id: 102 };
  assert.equal(simulatorStackKey(first, card), simulatorStackKey({ id: '4:1' }, otherPrinting));
  assert.notEqual(simulatorStackKey(first, card), simulatorStackKey({ ...first, tapped: true }, card));
  const modified = { ...first };
  setSimulatorCounters(modified, card, { power: 1, toughness: 2 });
  assert.notEqual(simulatorStackKey(first, card), simulatorStackKey(modified, card));
  setSimulatorCounters(modified, card, { power: 0, toughness: 0 });
  assert.equal(simulatorStackKey(first, card), simulatorStackKey(modified, card));
  assert.equal(simulatorStackKey(first, { name: ' Forest ', scryfallId: 'one', cardKey: 'one' }),
    simulatorStackKey(first, { name: 'forest', scryfallId: 'two', cardKey: 'two' }));
});

test('identical tokens stack across art while meaningful token characteristics keep separate stacks', () => {
  const [first, second] = tokenChoices([token(), token({ scryfallId: 'different-art', colors: ['G', 'G'], keywords: ['Other face only'] })]);
  const instance = { id: 'generated:1' };
  assert.equal(simulatorStackKey(instance, first), simulatorStackKey(instance, second));
  for (const change of [{ power: '2' }, { toughness: '4' }, { colors: ['B'] }, { oracleText: 'Flying' }, { typeLine: 'Token Creature — Beast' }]) {
    const [different] = tokenChoices([token(change)]);
    assert.notEqual(simulatorStackKey(instance, first), simulatorStackKey(instance, different));
  }
});

test('token choices flatten faces, preserve each face stats and approved images, and do not invent unavailable tokens', () => {
  const raw = token({
    id: 999, name: 'Badger // Treasure', keywords: ['Other face only'], cardFaces: [
      { name: 'Badger', type_line: 'Token Creature — Badger', power: '3', toughness: '3', colors: ['G'], oracle_text: '',
        image_uris: { normal: 'https://cards.scryfall.io/front.jpg' } },
      { name: 'Treasure', type_line: 'Token Artifact — Treasure', colors: [], oracle_text: '{T}, Sacrifice this token: Add one mana.',
        image_uris: { normal: 'https://cards.scryfall.io/back.jpg', small: 'https://evil.invalid/tracker' } }
    ]
  });
  const saved = structuredClone(raw);
  const choices = tokenChoices([raw, token({ available: false }), null]);
  assert.equal(choices.length, 2);
  assert.equal(choices[0].power, '3');
  assert.equal(choices[1].power, null, 'back artifact cannot inherit creature front stats');
  assert.deepEqual(choices[1].colors, []);
  assert.deepEqual(choices[1].keywords, [], 'aggregate keywords must not leak between independent token faces');
  assert.equal(choices[1].images.normal, 'https://cards.scryfall.io/back.jpg');
  assert.equal(choices[1].images.small, 'https://cards.scryfall.io/back.jpg');
  assert.ok(choices.every((card) => card.id === undefined && card.cardFaces === undefined && card.available && card.isToken));
  assert.notEqual(choices[0].tokenChoiceId, choices[1].tokenChoiceId);
  assert.deepEqual(raw, saved);
  assert.deepEqual(tokenChoices(undefined), []);
});

test('untrusted token artwork is omitted while available token metadata remains usable', () => {
  const [choice] = tokenChoices([token({ images: {
    normal: 'http://cards.scryfall.io/a.jpg', small: 'https://user:password@cards.scryfall.io/a.jpg',
    large: 'https://cards.scryfall.io:444/a.jpg', png: 'javascript:alert(1)'
  } })]);
  assert.deepEqual(choice.images, { small: null, normal: null, large: null, png: null });
  assert.equal(choice.name, 'Badger');
});

test('token creation isolates immutable card data, counters and IDs without a five-instance limit', () => {
  const state = initial();
  const [choice] = tokenChoices([token()]);
  const original = structuredClone(choice);
  const added = addSimulatorTokens(state, choice, 12);
  assert.equal(added.length, 12);
  assert.equal(state.zones.battlefield.length, 12);
  assert.equal(new Set(added.map((entry) => entry.id)).size, 12);
  assert.ok(added.every((entry) => entry.generated && entry.generatedKind === 'token' && !entry.tapped));
  assert.notEqual(added[0].card, choice);
  assert.ok(Object.isFrozen(added[0].card) && Object.isFrozen(added[0].card.images));
  setSimulatorCounters(added[0], added[0].card, { power: 2, toughness: 1 });
  assert.deepEqual(added[1].counters, { power: 0, toughness: 0, generic: 0 });
  choice.images.normal = 'changed-after-creation';
  assert.equal(added[0].card.images.normal, original.images.normal);
  assert.equal(state.zones.library.length, 0);
  assert.equal(state.nextGeneratedId, 12);
});

test('repeated token batches have no stack limit and allocation skips occupied generated IDs', () => {
  const state = initial();
  const [choice] = tokenChoices([token()]);
  state.zones.graveyard.push({ id: 'generated:1' });
  const first = addSimulatorTokens(state, choice, 1000);
  const second = addSimulatorTokens(state, choice, 1);
  assert.equal(first[0].id, 'generated:2');
  assert.equal(second[0].id, 'generated:1002');
  assert.equal(new Set(state.zones.battlefield.map((entry) => simulatorStackKey(entry, entry.card))).size, 1);
});

test('copies preserve printing and base stats but never inherit counters, tapped state or mutable metadata', () => {
  const state = initial();
  const card = creature();
  const original = structuredClone(card);
  const byId = new Map([[3, { id: 3, card }]]);
  const source = { id: '3:1', deckCardId: 3, cardId: card.id, tapped: true, counters: { power: 4, toughness: 5, generic: 0 } };
  state.zones.battlefield.push(source);
  const copies = duplicateSimulatorCreature(state, source, 6, byId);
  assert.equal(copies.length, 6);
  assert.equal(copies[0].card.id, card.id);
  assert.equal(copies[0].card.power, '1');
  assert.equal(copies[0].card.scryfallId, card.scryfallId);
  assert.ok(copies.every((copy) => !copy.tapped && copy.generatedKind === 'copy'));
  assert.deepEqual(copies[0].counters, { power: 0, toughness: 0, generic: 0 });
  assert.equal(simulatorStackKey(copies[0], copies[0].card), simulatorStackKey({}, card));
  assert.deepEqual(card, original);
  assert.equal(source.counters.power, 4);
  const more = duplicateSimulatorCreature(state, copies[0], 1, byId);
  assert.equal(more[0].card.name, card.name);
});

test('invalid quantities, unavailable tokens, noncreatures and stale sources leave state unchanged', () => {
  const state = initial();
  const [choice] = tokenChoices([token()]);
  const byId = new Map([[3, { card: creature() }], [4, { card: { name: 'Forest', typeLine: 'Basic Land — Forest' } }]]);
  const source = { id: '3:1', deckCardId: 3 };
  const land = { id: '4:1', deckCardId: 4 };
  state.zones.battlefield.push(source, land);
  const original = structuredClone(state);
  for (const count of [0, -1, 1.5, 1001, '', null, true, '1.5', '1e2', Infinity, NaN]) {
    assert.throws(() => addSimulatorTokens(state, choice, count), /geheel getal/);
    assert.throws(() => duplicateSimulatorCreature(state, source, count, byId), /geheel getal/);
  }
  assert.throws(() => addSimulatorTokens(state, { ...choice, available: false }, 2), /beschikbaar/);
  assert.throws(() => duplicateSimulatorCreature(state, land, 2, byId), /creatures/);
  assert.throws(() => duplicateSimulatorCreature(state, { ...source }, 2, byId), /niet meer op tafel/);
  assert.deepEqual(state, original);
  state.nextGeneratedId = Number.MAX_SAFE_INTEGER;
  assert.throws(() => addSimulatorTokens(state, choice, 1), /geen nieuwe instanties/);
  assert.equal(state.zones.battlefield.length, 2);
});

test('creature counters are independent signed totals with zero reset and atomic validation', () => {
  const instance = { id: '3:1' };
  const card = creature();
  setSimulatorCounters(instance, card, { power: '2', toughness: '-3' });
  assert.equal(simulatorCounterLabel(instance, card), '+2/-3');
  const before = structuredClone(instance);
  assert.throws(() => setSimulatorCounters(instance, card, { power: 4, toughness: 'oops' }), /Toughness/);
  assert.deepEqual(instance, before);
  setSimulatorCounters(instance, card, { power: 0, toughness: 1 });
  assert.equal(simulatorCounterLabel(instance, card), '0/+1');
  setSimulatorCounters(instance, card, { power: 0, toughness: 0 });
  assert.equal(simulatorCounterLabel(instance, card), '');
  assert.equal(card.power, '1');
});

test('noncreature counters use a single nonnegative total and remain independent of other instances', () => {
  const card = { name: 'Sol Ring', typeLine: 'Artifact' };
  const first = { id: '7:1' };
  const second = { id: '7:2' };
  setSimulatorCounters(first, card, { generic: 3, power: 9, toughness: 9 });
  assert.deepEqual(first.counters, { power: 0, toughness: 0, generic: 3 });
  assert.equal(simulatorCounterLabel(first, card), '3');
  assert.equal(simulatorCounterLabel(second, card), '');
  assert.throws(() => setSimulatorCounters(first, card, { generic: -1 }), /Counters/);
  assert.throws(() => setSimulatorCounters(first, card, { generic: 10000 }), /Counters/);
  assert.equal(first.counters.generic, 3);
  setSimulatorCounters(first, card, { generic: 0 });
  assert.equal(simulatorCounterLabel(first, card), '');
});
