import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { after, test } from 'node:test';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-card-catalog-facets-'));
process.env.DATA_DIR = testDataDir;
process.env.DATABASE_FILE = 'primary.sqlite';
process.env.CARD_CATALOG_DATABASE_FILE = 'facets.sqlite';

const { buildCardCatalogDatabase } = await import('../src/card-catalog/builder.js');
const { activateCardCatalog, closeCardCatalogDatabase } = await import('../src/card-catalog/database.js');
const { cardCatalogOptions, searchCardCatalog } = await import('../src/card-catalog/repository.js');

function card(name, overrides = {}) {
  return {
    name,
    manaValue: 2,
    colors: ['G'],
    colorIdentity: ['G'],
    type: 'Instant — Arcane',
    types: ['Instant'],
    subtypes: ['Arcane'],
    supertypes: [],
    keywords: [],
    legalities: { commander: 'Legal' },
    identifiers: { scryfallOracleId: `oracle-${name.toLowerCase().replaceAll(' ', '-')}` },
    layout: 'normal',
    ...overrides
  };
}

const grove = card('Instant Grove', {
  colors: [],
  text: 'Landfall — Create a 2/2 green Beast creature token. Draw a card. Marker 100%_ready^.',
  keywords: ['Flashback', 'Landfall'],
  legalities: { commander: 'Legal', modern: 'Banned', vintage: 'Restricted' }
});
const fixture = {
  meta: { date: '2026-10-03', version: '5.3.0+20261003' },
  data: {
    'Instant Grove': [grove, { ...grove, keywords: ['flashback', 'landfall'], subtypes: ['arcane'] }],
    'Instant Tide': [card('Instant Tide', {
      manaValue: 4,
      colors: ['U'],
      colorIdentity: ['U'],
      type: 'Instant — Trap',
      subtypes: ['Trap'],
      text: 'Counter target spell. Draw a card.',
      keywords: ['Storm'],
      legalities: { commander: 'Legal', modern: 'Legal' }
    })],
    'Instant Hunt': [card('Instant Hunt', {
      manaValue: 1,
      text: 'Search your library for a creature or artifact card, reveal it, put it into your hand, then shuffle.',
      keywords: ['Flashback'],
      legalities: { commander: 'Legal', pioneer: 'Legal' }
    })],
    'Instant Unknown': [card('Instant Unknown', {
      manaValue: 0,
      colors: [],
      colorIdentity: [],
      type: 'Instant — Adventure',
      subtypes: ['Adventure'],
      text: "Create a creature token that's a copy of target creature.",
      keywords: ['Retrace'],
      legalities: { legacy: 'Legal' }
    })],
    'Forest Druid': [card('Forest Druid', {
      manaValue: 3,
      type: 'Creature — Elf Druid',
      types: ['Creature'],
      subtypes: ['Elf', 'Druid'],
      text: 'Landfall — Add {G}. Create a 3/3 green Elk creature token.',
      keywords: ['Landfall', 'Vigilance'],
      legalities: { commander: 'Legal', standard: 'Legal' }
    })],
    'Many Tokens': [card('Many Tokens', {
      manaValue: 5,
      colors: ['R'],
      colorIdentity: ['R'],
      type: 'Sorcery',
      types: ['Sorcery'],
      subtypes: [],
      text: 'Create a 1/1 white Soldier creature token. Create a 2/2 green Beast creature token. Create a 1/3 red Goblin creature token.',
      keywords: ['Cycling']
    })],
    'Land Tutor': [card('Land Tutor', {
      type: 'Sorcery',
      types: ['Sorcery'],
      subtypes: [],
      text: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
      keywords: ['Flashback']
    })],
    'Identity Artifact': [card('Identity Artifact', {
      manaValue: 6,
      colors: ['U'],
      colorIdentity: ['R'],
      type: 'Artifact',
      types: ['Artifact'],
      subtypes: [],
      text: 'Draw a card.',
      keywords: ['Flying']
    })],
    'Fractional Relic': [card('Fractional Relic', {
      manaValue: 1.5,
      colors: ['U'],
      colorIdentity: ['U', 'G'],
      type: 'Artifact',
      types: ['Artifact'],
      subtypes: [],
      text: 'A multicolored test relic.'
    })],
    'Compound Warrior': [card('Compound Warrior', {
      type: 'Sorcery',
      types: ['Sorcery'],
      subtypes: [],
      text: 'Create a 1/1 white Warrior creature token.'
    })],
    'Compound Elf': [card('Compound Elf', {
      type: 'Sorcery',
      types: ['Sorcery'],
      subtypes: [],
      text: 'Create a 2/2 green Elf Warrior creature token.'
    })],
    'Compound Both': [card('Compound Both', {
      type: 'Sorcery',
      types: ['Sorcery'],
      subtypes: [],
      text: 'Create a 1/1 white Warrior creature token. Create a 2/2 green Elf Warrior creature token. Create a 1/3 green Elf Warrior creature token.'
    })]
  }
};

const candidatePath = path.join(testDataDir, '.facet-candidate.sqlite');
await buildCardCatalogDatabase({
  source: Readable.from([JSON.stringify(fixture)]),
  databasePath: candidatePath,
  sourceUrl: 'fixture://facets.json',
  sourceSha256: 'b'.repeat(64)
});
activateCardCatalog(candidatePath);

after(() => {
  closeCardCatalogDatabase();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

const facetNames = [
  'abilities', 'keywords', 'types', 'subtypes', 'effects', 'tutorTargets',
  'colors', 'legalities', 'manaValues', 'tokenPowers', 'tokenToughnesses', 'tokenTypes'
];

function counts(options, key) {
  return Object.fromEntries(options[key].map(({ value, count }) => [String(value).toLowerCase(), count]));
}

function values(options, key) {
  return Object.keys(counts(options, key)).sort();
}

test('Instant beperkt alle andere facetten tot passende kaarten, zonder dubbele bronvarianten', () => {
  const options = cardCatalogOptions({ type: 'Instant' });
  assert.deepEqual(counts(options, 'abilities'), { flashback: 2, landfall: 1, retrace: 1, storm: 1 });
  assert.deepEqual(counts(options, 'keywords'), counts(options, 'abilities'));
  assert.deepEqual(counts(options, 'subtypes'), { adventure: 1, arcane: 2, trap: 1 });
  assert.deepEqual(counts(options, 'colors'), { c: 1, g: 2, u: 1 });
  assert.deepEqual(counts(options, 'manaValues'), { 0: 1, 1: 1, 2: 1, 4: 1 });
  assert.deepEqual(options.manaRange, { min: 0, max: 4 });
  assert.deepEqual(counts(options, 'tokenPowers'), { 2: 1 });
  assert.deepEqual(counts(options, 'tokenToughnesses'), { 2: 1 });
  assert.deepEqual(counts(options, 'tokenTypes'), { beast: 1, creature: 2 });
  assert.deepEqual(counts(options, 'tutorTargets'), { artifact: 1, creature: 1 });
  assert.equal(counts(options, 'effects').token, 2);
  assert.equal(counts(options, 'effects').draw, 2);
  assert.equal(counts(options, 'effects').tutor, 1);
  assert.deepEqual(counts(options, 'legalities'), { commander: 3, legacy: 1, modern: 1, pioneer: 1 });
  assert.deepEqual(values(options, 'types'), ['artifact', 'creature', 'instant', 'sorcery']);
  for (const key of facetNames) {
    assert.ok(Array.isArray(options[key]), key);
    assert.equal(options[key].length, new Set(options[key].map(({ value }) => String(value).toLowerCase())).size, key);
    for (const entry of options[key]) {
      assert.equal(typeof entry.label, 'string', key);
      assert.ok(entry.label.length > 0, key);
      assert.ok(Number.isInteger(entry.count) && entry.count > 0, key);
    }
  }
});

test('elk facet negeert uitsluitend zijn eigen selectie en behoudt andere filters', () => {
  const cases = [
    ['abilities', { ability: 'Landfall' }],
    ['keywords', { keyword: 'Flashback' }],
    ['subtypes', { subtype: 'Arcane' }],
    ['legalities', { legality: 'commander' }],
    ['colors', { colorIdentity: 'G', colorMode: 'exact' }],
    ['manaValues', { manaMin: 2, manaMax: 2 }]
  ];
  const instant = cardCatalogOptions({ type: 'Instant' });
  for (const [facet, selection] of cases) {
    assert.deepEqual(cardCatalogOptions({ type: 'Instant', ...selection })[facet], instant[facet], facet);
  }
  assert.deepEqual(
    cardCatalogOptions({ name: 'Instant', type: 'Sorcery' }).types,
    cardCatalogOptions({ name: 'Instant' }).types
  );
  assert.deepEqual(cardCatalogOptions({ type: 'Instant', manaMin: 2, manaMax: 2 }).manaRange, instant.manaRange);
  assert.deepEqual(values(cardCatalogOptions({ type: 'Instant', ability: 'Landfall' }), 'keywords'), ['flashback', 'landfall']);
  assert.deepEqual(values(cardCatalogOptions({ type: 'Instant', keyword: 'Storm' }), 'abilities'), ['storm']);
});

test('naam, tekst, kleur, manabereik en effect werken samen bij facetselectie', () => {
  const options = cardCatalogOptions({
    name: 'INSTANT', text: 'Draw a card', colorIdentity: 'G', colorMode: 'exact',
    manaMin: 2, manaMax: 3, effect: 'token'
  });
  assert.deepEqual(counts(options, 'types'), { instant: 1 });
  assert.deepEqual(counts(options, 'subtypes'), { arcane: 1 });
  assert.deepEqual(counts(options, 'abilities'), { flashback: 1, landfall: 1 });
  assert.deepEqual(counts(options, 'tokenTypes'), { beast: 1, creature: 1 });
  assert.equal(searchCardCatalog({ type: 'Instant', colorIdentity: 'G', colorMode: 'exact' }).total, 2);
});

test('effectfacet laat alternatieven toe wanneer effect en afhankelijke velden actief zijn', () => {
  const base = cardCatalogOptions({ type: 'Instant' }).effects;
  assert.deepEqual(cardCatalogOptions({
    type: 'Instant', effect: 'token', tokenPower: '2', tokenToughness: '2', tokenType: 'Beast'
  }).effects, base);
  assert.deepEqual(cardCatalogOptions({ type: 'Instant', effect: 'tutor', tutorTarget: 'creature' }).effects, base);
  const tutors = cardCatalogOptions({ effect: 'tutor' });
  assert.deepEqual(cardCatalogOptions({ effect: 'tutor', tutorTarget: 'creature' }).tutorTargets, tutors.tutorTargets);
  assert.deepEqual(counts(cardCatalogOptions({ type: 'Instant', effect: 'tutor', tutorTarget: 'creature' }), 'types'), { instant: 1 });
});

test('tokenfacetten combineren resterende kenmerken binnen hetzelfde tokenprofiel', () => {
  const base = { name: 'Many Tokens', effect: 'token' };
  assert.deepEqual(counts(cardCatalogOptions({ ...base, tokenPower: '2', tokenToughness: '1' }), 'tokenPowers'), { 1: 1 });
  assert.deepEqual(counts(cardCatalogOptions({ ...base, tokenPower: '1', tokenToughness: '2' }), 'tokenToughnesses'), { 1: 1, 3: 1 });
  assert.deepEqual(counts(cardCatalogOptions({ ...base, tokenPower: '1', tokenType: 'Beast' }), 'tokenTypes'), {
    creature: 1, goblin: 1, soldier: 1
  });
  assert.deepEqual(counts(cardCatalogOptions({ ...base, tokenToughness: '2', tokenType: 'Soldier' }), 'tokenPowers'), {});
  assert.deepEqual(counts(cardCatalogOptions({ ...base, tokenPower: '1', tokenToughness: '2' }), 'tokenTypes'), {});
  assert.deepEqual(counts(cardCatalogOptions({ ...base, tokenType: 'Creature' }), 'tokenPowers'), { 1: 1, 2: 1 });
  assert.deepEqual(counts(cardCatalogOptions({ name: 'Instant Unknown', tokenType: 'Creature' }), 'tokenTypes'), { creature: 1 });
  assert.deepEqual(counts(cardCatalogOptions({ name: 'Instant Unknown', tokenType: 'Creature' }), 'types'), { instant: 1 });
});

test('tokentypeaantallen volgen deelmatches op samengestelde types zonder dubbel te tellen', () => {
  const base = { name: 'Compound', effect: 'token' };
  assert.deepEqual(counts(cardCatalogOptions(base), 'tokenTypes'), { creature: 3, 'elf warrior': 2, warrior: 3 });
  assert.deepEqual(counts(cardCatalogOptions({ ...base, tokenPower: '1', tokenToughness: '1' }), 'tokenTypes'), {
    creature: 2, warrior: 2
  });
  assert.deepEqual(counts(cardCatalogOptions({ ...base, tokenPower: '1', tokenToughness: '3' }), 'tokenTypes'), {
    creature: 1, 'elf warrior': 1
  });
  for (const selection of [
    {}, { tokenPower: '1' }, { tokenPower: '2' }, { tokenToughness: '3' },
    { tokenPower: '1', tokenToughness: '1' },
    { tokenPower: '1', tokenToughness: '2' },
    { tokenPower: '2', tokenToughness: '2', tokenType: 'Warrior' }
  ]) {
    const filters = { ...base, ...selection };
    for (const entry of cardCatalogOptions(filters).tokenTypes) {
      assert.equal(entry.count, searchCardCatalog({ ...filters, tokenType: entry.value }).total,
        `Aantal voor ${entry.value} bij ${JSON.stringify(selection)}`);
    }
  }
});

test('kleuropties volgen kleuridentiteit, niet de gedrukte kleuren', () => {
  assert.deepEqual(counts(cardCatalogOptions({ name: 'Identity Artifact' }), 'colors'), { r: 1 });
  assert.deepEqual(counts(cardCatalogOptions({ name: 'Instant Grove' }), 'colors'), { g: 1 });
  assert.deepEqual(counts(cardCatalogOptions({ name: 'Instant Unknown' }), 'colors'), { c: 1 });
  assert.deepEqual(counts(cardCatalogOptions({ name: 'Fractional Relic' }), 'colors'), { g: 1, u: 1 });
});

test('manawaardes behouden fracties en worden numeriek geordend', () => {
  assert.deepEqual(cardCatalogOptions().manaValues.map(({ value }) => Number(value)), [0, 1, 1.5, 2, 3, 4, 5, 6]);
  assert.deepEqual(cardCatalogOptions({ name: 'Fractional Relic' }).manaRange, { min: 1.5, max: 1.5 });
  assert.deepEqual(counts(cardCatalogOptions({ manaMin: 1.4, manaMax: 1.6 }), 'types'), { artifact: 1 });
});

test('legaliteitsopties tellen alleen legal en negeren het eigen formaatfilter', () => {
  const options = cardCatalogOptions({ name: 'Instant Grove', legality: 'modern:banned' });
  assert.deepEqual(counts(options, 'legalities'), { commander: 1 });
  assert.deepEqual(counts(options, 'types'), { instant: 1 });
  assert.equal(cardCatalogOptions().legalities.some(({ value }) => value === 'vintage'), false);
});

test('lege resultaten en letterlijke LIKE-tekens blijven veilig en consistent', () => {
  for (const query of [{ name: 'Missing card' }, { text: "' OR 1=1 --" }, { name: '%' }]) {
    const options = cardCatalogOptions(query);
    for (const key of facetNames) assert.deepEqual(options[key], [], key);
    assert.deepEqual(options.manaRange, { min: null, max: null });
  }
  for (const text of ['100%_ready^', '%', '_', '^']) {
    assert.deepEqual(counts(cardCatalogOptions({ text }), 'types'), { instant: 1 });
  }
  assert.deepEqual(values(cardCatalogOptions({ type: 'instant', subtype: 'ARCANE' }), 'keywords'), ['flashback', 'landfall']);
});

test('facetten zijn onafhankelijk van pagina, limiet en sortering, ook bij ongeldige waarden', () => {
  const expected = cardCatalogOptions({ type: 'Instant' });
  for (const pagination of [
    { page: 2, limit: 1, sort: 'mana' },
    { page: 10000, limit: 100, sort: 'name' },
    { page: 'invalid', limit: -1, sort: 'unsupported' }
  ]) {
    assert.deepEqual(cardCatalogOptions({ type: 'Instant', ...pagination }), expected);
  }
});

test('facetendpoint valideert dezelfde inhoudelijke filters als de zoekfunctie', () => {
  const invalid = [
    { name: 'x'.repeat(201) }, { text: 'x'.repeat(501) },
    { ability: 'x'.repeat(121) }, { keyword: 'x'.repeat(121) },
    { type: 'x'.repeat(121) }, { subtype: 'x'.repeat(121) },
    { colorIdentity: 'purple' }, { colorIdentity: 'C,G' }, { colorMode: 'invalid' },
    { manaMin: -1 }, { manaMax: Infinity }, { manaMin: 3, manaMax: 2 },
    { effect: 'invalid' }, { effect: '__proto__' }, { effect: 'constructor' },
    { tutorTarget: 'invalid' }, { legality: 'commander:invalid' },
    { tokenPower: 'x'.repeat(21) }, { tokenToughness: 'x'.repeat(21) }, { tokenType: 'x'.repeat(101) }
  ];
  for (const input of invalid) {
    assert.throws(() => cardCatalogOptions(input), (error) => error.status === 400, JSON.stringify(input));
  }
});

test('HTTP-opties geven queryfilters door en rapporteren ongeldige filters als 400', async (t) => {
  let express;
  try {
    ({ default: express } = await import('express'));
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    t.skip('Installeer de Express-afhankelijkheid om de HTTP-integratietest uit te voeren.');
    return;
  }
  const { cardCatalogReadRouter } = await import('../src/routes/card-catalog.js');
  const app = express();
  app.use('/api/card-catalog', cardCatalogReadRouter);
  app.use((error, _request, response, _next) => {
    response.status(error.status || 500).json({ error: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/card-catalog/options`;
  const filtered = await fetch(`${baseUrl}?type=Instant`);
  assert.equal(filtered.status, 200);
  assert.deepEqual((await filtered.json()).data, cardCatalogOptions({ type: 'Instant' }));
  const invalid = await fetch(`${baseUrl}?colorIdentity=purple`);
  assert.equal(invalid.status, 400);
  assert.equal(typeof (await invalid.json()).error, 'string');
});
