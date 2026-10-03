import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { after, test } from 'node:test';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-catalog-legendary-'));
process.env.DATA_DIR = testDataDir;
process.env.DATABASE_FILE = 'primary.sqlite';
process.env.CARD_CATALOG_DATABASE_FILE = 'legendary.sqlite';

const { buildCardCatalogDatabase } = await import('../src/card-catalog/builder.js');
const { activateCardCatalog, closeCardCatalogDatabase } = await import('../src/card-catalog/database.js');
const { cardCatalogOptions, searchCardCatalog } = await import('../src/card-catalog/repository.js');

function card(name, overrides = {}) {
  return {
    name,
    manaValue: 2,
    colors: ['G'],
    colorIdentity: ['G'],
    type: 'Creature — Elf',
    types: ['Creature'],
    subtypes: ['Elf'],
    supertypes: [],
    keywords: [],
    legalities: { commander: 'Legal' },
    identifiers: { scryfallOracleId: `oracle-${name.toLowerCase().replaceAll(' ', '-')}` },
    layout: 'normal',
    ...overrides
  };
}

const elder = card('Verdant Elder', {
  type: 'Legendary Creature — Elf Druid',
  subtypes: ['Elf', 'Druid'],
  supertypes: ['Legendary'],
  keywords: ['Landfall'],
  text: 'Landfall — Whenever a land you control enters, add {G}.'
});
const fixture = {
  meta: { date: '2026-10-03', version: '5.3.0+20261003' },
  data: {
    // Two source variants share one Oracle identity and must count once.
    'Verdant Elder': [elder, { ...elder, supertypes: ['legendary'] }],
    'Azure Sage': [card('Azure Sage', {
      manaValue: 4,
      colors: ['U'],
      colorIdentity: ['U'],
      type: 'Legendary Creature — Human Wizard',
      subtypes: ['Human', 'Wizard'],
      supertypes: ['Legendary'],
      keywords: ['Flying'],
      text: 'Flying. Draw a card.'
    })],
    'Legendary Pretender': [card('Legendary Pretender', {
      text: 'Target legendary creature gets +2/+2 until end of turn.'
    })],
    'Snow Scout': [card('Snow Scout', {
      type: 'Snow Creature — Human Scout',
      subtypes: ['Human', 'Scout'],
      supertypes: ['Snow'],
      keywords: ['Vigilance'],
      text: 'Vigilance'
    })],
    'Ancient Hall': [card('Ancient Hall', {
      manaValue: 0,
      colors: [],
      colorIdentity: [],
      type: 'Legendary Land — Gate',
      types: ['Land'],
      subtypes: ['Gate'],
      supertypes: ['Legendary'],
      text: '{T}: Add {C}.'
    })],
    'Brief Insight': [card('Brief Insight', {
      type: 'Instant',
      types: ['Instant'],
      subtypes: [],
      text: 'Draw a card.'
    })]
  }
};

const candidatePath = path.join(testDataDir, '.legendary-candidate.sqlite');
await buildCardCatalogDatabase({
  source: Readable.from([JSON.stringify(fixture)]),
  databasePath: candidatePath,
  sourceUrl: 'fixture://legendary.json',
  sourceSha256: 'c'.repeat(64)
});
activateCardCatalog(candidatePath);

after(() => {
  closeCardCatalogDatabase();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function counts(options, key) {
  return Object.fromEntries(options[key].map(({ value, count }) => [value, count]));
}

function names(query, context = {}) {
  return searchCardCatalog({ ...query, sort: 'name' }, context).items.map(({ name }) => name);
}

test('Creature + Legendary gebruikt het supertype, niet de naam of kaarttekst', () => {
  assert.deepEqual(names({ type: 'Creature', subtype: 'Legendary' }), ['Azure Sage', 'Verdant Elder']);
  assert.equal(searchCardCatalog({ type: 'Creature', subtype: 'Legendary' }).total, 2);
  assert.deepEqual(names({ type: 'creature', subtype: ' lEgEnDaRy ' }), ['Azure Sage', 'Verdant Elder']);
  assert.deepEqual(names({ subtype: 'Legendary' }), ['Ancient Hall', 'Azure Sage', 'Verdant Elder']);
});

test('gewone subtypes blijven werken en andere supertypes worden niet als subtype aangeboden', () => {
  assert.deepEqual(names({ type: 'Creature', subtype: 'Elf' }), ['Legendary Pretender', 'Verdant Elder']);
  assert.deepEqual(names({ type: 'Creature', subtype: 'Wizard' }), ['Azure Sage']);
  assert.equal(cardCatalogOptions({ type: 'Creature' }).subtypes.some(({ value }) => value === 'Snow'), false);
});

test('Subtype biedt Legendary reactief, alfabetisch en zonder dubbel tellen aan', () => {
  const options = cardCatalogOptions({ type: 'Creature' });
  assert.deepEqual(counts(options, 'subtypes'), { Druid: 1, Elf: 2, Human: 2, Legendary: 2, Scout: 1, Wizard: 1 });
  assert.deepEqual(options.subtypes.find(({ value }) => value === 'Legendary'), {
    value: 'Legendary', label: 'Legendary', count: 2
  });
  assert.deepEqual(cardCatalogOptions({ type: 'Creature', subtype: 'Legendary' }).subtypes, options.subtypes);
  assert.deepEqual(cardCatalogOptions({ type: 'Creature', subtype: 'Elf' }).subtypes, options.subtypes);
  assert.equal(counts(cardCatalogOptions({ type: 'Land' }), 'subtypes').Legendary, 1);
});

test('andere facetten respecteren Legendary en de optie respecteert de overige filters', () => {
  const options = cardCatalogOptions({ type: 'Creature', subtype: 'Legendary' });
  assert.deepEqual(counts(options, 'types'), { Creature: 2, Land: 1 });
  assert.deepEqual(counts(options, 'abilities'), { Flying: 1, Landfall: 1 });
  assert.deepEqual(counts(options, 'colors'), { U: 1, G: 1 });
  assert.equal(counts(cardCatalogOptions({ type: 'Creature', colorIdentity: 'G', colorMode: 'exact' }), 'subtypes').Legendary, 1);
  assert.equal(counts(cardCatalogOptions({ type: 'Creature', manaMin: 3 }), 'subtypes').Legendary, 1);
  assert.equal(counts(cardCatalogOptions({ type: 'Creature', ability: 'Vigilance' }), 'subtypes').Legendary, undefined);
  assert.equal(counts(cardCatalogOptions({ type: 'Instant' }), 'subtypes').Legendary, undefined);
  assert.equal(counts(cardCatalogOptions({ type: 'Creature', text: 'legendary creature' }), 'subtypes').Legendary, undefined);
});

test('gemarkeerde kaarten beperken Legendary; deckselectie markeert alleen de resultaten', () => {
  const context = {
    marks: [{ name: elder.name, scryfallOracleId: elder.identifiers.scryfallOracleId }],
    selectedDeck: {
      id: 12,
      cards: [{ name: elder.name, scryfallOracleId: elder.identifiers.scryfallOracleId }]
    }
  };
  const query = { type: 'Creature', subtype: 'Legendary', deckId: 12 };
  assert.equal(counts(cardCatalogOptions({ ...query, marked: '1' }, context), 'subtypes').Legendary, 1);
  assert.deepEqual(names({ ...query, marked: '1' }, context), ['Verdant Elder']);
  assert.equal(counts(cardCatalogOptions(query, context), 'subtypes').Legendary, 2);
  const results = searchCardCatalog(query, context);
  assert.equal(results.total, 2);
  assert.equal(results.items.find(({ name }) => name === 'Verdant Elder').inDeck, true);
  assert.equal(results.items.find(({ name }) => name === 'Azure Sage').inDeck, false);
});
