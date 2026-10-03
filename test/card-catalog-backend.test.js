import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-card-catalog-'));
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DATA_DIR = testDataDir;
process.env.DATABASE_FILE = 'primary.sqlite';
process.env.CARD_CATALOG_DATABASE_FILE = 'atomic-catalog.sqlite';

const primaryDatabase = await import('../src/db/database.js');
const { buildCardCatalogDatabase } = await import('../src/card-catalog/builder.js');
const catalogDatabase = await import('../src/card-catalog/database.js');
const {
  cardCatalogOptions,
  cardCatalogTotalPages,
  searchCardCatalog
} = await import('../src/card-catalog/repository.js');
const {
  cardCatalogImportStatus,
  startCardCatalogImport,
  stopCardCatalogImport
} = await import('../src/card-catalog/import-service.js');

const catalogCandidate = path.join(testDataDir, '.card-catalog-import-test.sqlite');
const fixture = {
  meta: { date: '2026-10-03', version: '5.3.0+20261003' },
  data: {
    'Verdant Spawn': [{
      name: 'Verdant Spawn',
      manaCost: '{2}{G}',
      manaValue: 3,
      colors: ['G'],
      colorIdentity: ['G'],
      type: 'Creature — Elf Druid',
      types: ['Creature'],
      subtypes: ['Elf', 'Druid'],
      supertypes: [],
      text: 'Landfall — Whenever a land enters, create a 2/2 green Beast creature token.',
      keywords: ['Landfall'],
      legalities: { commander: 'Legal' },
      identifiers: { scryfallOracleId: 'oracle-verdant' },
      layout: 'normal'
    }],
    'Green Tutor': [{
      name: 'Green Tutor',
      manaCost: '{G}',
      manaValue: 1,
      colors: ['G'],
      colorIdentity: ['G'],
      type: 'Sorcery',
      types: ['Sorcery'],
      subtypes: [],
      supertypes: [],
      text: 'Search your library for a creature card, reveal it, put it into your hand, then shuffle.',
      keywords: [],
      legalities: { commander: 'Legal' },
      identifiers: { scryfallOracleId: 'oracle-tutor' },
      layout: 'normal'
    }],
    'Green Blue Test': [{
      name: 'Green Blue Test',
      manaValue: 2,
      colors: ['G', 'U'],
      colorIdentity: ['G', 'U'],
      type: 'Creature — Test',
      types: ['Creature'],
      subtypes: ['Test'],
      supertypes: [],
      text: 'A multicolored test card.',
      keywords: [],
      legalities: { commander: 'Legal' },
      identifiers: { scryfallOracleId: 'oracle-green-blue' },
      layout: 'normal'
    }],
    'Many Tokens': [{
      name: 'Many Tokens',
      manaCost: '{2}{R}',
      manaValue: 3,
      colors: ['R'],
      colorIdentity: ['R'],
      type: 'Sorcery',
      types: ['Sorcery'],
      subtypes: [],
      supertypes: [],
      text: 'Create a 1/1 white Soldier creature token. Create a 2/2 green Beast creature token.',
      keywords: [],
      legalities: { commander: 'Legal' },
      identifiers: { scryfallOracleId: 'oracle-many-tokens' },
      layout: 'normal'
    }],
    'Shared Name': [{
      name: 'Shared Name',
      manaValue: 0,
      colors: [],
      colorIdentity: [],
      type: 'Artifact',
      types: ['Artifact'],
      subtypes: [],
      supertypes: [],
      text: 'First Oracle card.',
      keywords: [],
      legalities: { commander: 'Legal' },
      identifiers: { scryfallOracleId: 'oracle-shared-one' },
      layout: 'normal'
    }, {
      name: 'Shared Name',
      manaValue: 2,
      colors: ['U'],
      colorIdentity: ['U'],
      type: 'Creature — Shapeshifter',
      types: ['Creature'],
      subtypes: ['Shapeshifter'],
      supertypes: [],
      text: 'Second, distinct Oracle card.',
      keywords: [],
      legalities: { commander: 'Legal' },
      identifiers: { scryfallOracleId: 'oracle-shared-two' },
      layout: 'normal'
    }]
  }
};

function primarySchema() {
  return primaryDatabase.db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
}

const schemaBefore = primarySchema();
const primaryVersionBefore = primaryDatabase.db.prepare('PRAGMA user_version').get().user_version;

await buildCardCatalogDatabase({
  source: Readable.from([JSON.stringify(fixture)]),
  databasePath: catalogCandidate,
  sourceUrl: 'fixture://AtomicCards.json',
  sourceSha256: 'a'.repeat(64)
});
catalogDatabase.activateCardCatalog(catalogCandidate);

after(() => {
  catalogDatabase.closeCardCatalogDatabase();
  primaryDatabase.closeDatabase();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('catalogusimport gebruikt een fysiek losse database en wijzigt het hoofdschema niet', () => {
  assert.equal(catalogDatabase.cardCatalogStatus().available, true);
  assert.equal(catalogDatabase.cardCatalogStatus().cardCount, 6);
  assert.deepEqual(primarySchema(), schemaBefore);
  assert.equal(primaryDatabase.db.prepare('PRAGMA user_version').get().user_version, primaryVersionBefore);
  assert.deepEqual(
    primaryDatabase.db.prepare('PRAGMA database_list').all().map((row) => row.name),
    ['main']
  );
});

test('catalogusconfig weigert paden buiten DATA_DIR en botsingen met alle SQLite-bestanden', () => {
  const collisions = [
    { catalog: '../outside.sqlite', main: 'primary.sqlite' },
    { catalog: 'nested/catalog.sqlite', main: 'primary.sqlite' },
    { catalog: 'nested\\catalog.sqlite', main: 'primary.sqlite' },
    { catalog: 'primary.sqlite', main: 'primary.sqlite' },
    { catalog: 'primary.sqlite-wal', main: 'primary.sqlite' },
    { catalog: 'primary.sqlite-journal', main: 'primary.sqlite' },
    { catalog: 'mtgjson-atomic.sqlite', main: 'mtgjson-atomic.sqlite-journal' },
    { catalog: 'mtgjson-atomic.sqlite', main: 'mtgjson-atomic.sqlite.previous' }
  ];
  for (const { catalog, main } of collisions) {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', "await import('./src/config.js')"],
      {
        cwd: projectDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATA_DIR: testDataDir,
          DATABASE_FILE: main,
          CARD_CATALOG_DATABASE_FILE: catalog
        }
      }
    );
    assert.notEqual(result.status, 0, `${catalog} en ${main} hadden geweigerd moeten worden`);
  }
});

test('paginering toont uitsluitend pagina\'s binnen de maximale zoekoffset', () => {
  assert.equal(cardCatalogTotalPages(0, 50), 0);
  assert.equal(cardCatalogTotalPages(100, 50), 2);
  assert.equal(cardCatalogTotalPages(100_000, 100), 51);
  assert.equal(cardCatalogTotalPages(100_000, 30), 167);
});

test('catalogusopties bevatten abilities, effecten en tutordoelen met aantallen', () => {
  const options = cardCatalogOptions();
  assert.deepEqual(options.abilities.find((entry) => entry.value === 'Landfall'), {
    value: 'Landfall',
    label: 'Landfall',
    count: 1
  });
  assert.equal(options.effects.find((entry) => entry.value === 'token').count, 2);
  assert.equal(options.effects.find((entry) => entry.value === 'tutor').count, 1);
  assert.equal(options.tutorTargets.find((entry) => entry.value === 'creature').count, 1);
});

test('catalogus zoekt gecombineerd op Landfall, groen en 2/2 creature tokens', () => {
  const result = searchCardCatalog({
    ability: 'Landfall',
    colorIdentity: 'G',
    colorMode: 'subset',
    effect: 'token',
    tokenPower: '2',
    tokenToughness: '2',
    tokenType: 'Creature',
    legality: 'commander'
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].name, 'Verdant Spawn');
  assert.equal(result.items[0].catalogId, 'oracle-verdant');
  assert.ok(result.items[0].effects.includes('creature_token'));
});

test('catalogus vindt groene creaturetutors via afgeleide eigenschappen', () => {
  const result = searchCardCatalog({
    colorIdentity: 'G',
    colorMode: 'exact',
    effect: 'tutor',
    tutorTarget: 'creature'
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].name, 'Green Tutor');
  assert.deepEqual(result.items[0].tutorTargets, ['creature']);
});

test('tokenfilters doorzoeken alle tokenprofielen van dezelfde kaart', () => {
  const soldier = searchCardCatalog({ name: 'Many Tokens', tokenPower: '1', tokenToughness: '1', tokenType: 'Soldier' });
  const beast = searchCardCatalog({ name: 'Many Tokens', tokenPower: '2', tokenToughness: '2', tokenType: 'Beast' });
  assert.equal(soldier.total, 1);
  assert.equal(soldier.items[0].catalogId, 'oracle-many-tokens');
  assert.equal(soldier.items[0].tokenType, 'Soldier');
  assert.equal(beast.total, 1);
  assert.equal(beast.items[0].catalogId, 'oracle-many-tokens');
  assert.equal(beast.items[0].tokenPower, '2');
  assert.equal(beast.items[0].tokenToughness, '2');
  assert.equal(beast.items[0].tokenType, 'Beast');
  assert.deepEqual(beast.items[0].tokens, [
    { power: '1', toughness: '1', type: 'Soldier' },
    { power: '2', toughness: '2', type: 'Beast' }
  ]);
});

test('landfall is ook als zelfstandig effect doorzoekbaar en wordt als optie aangeboden', () => {
  assert.equal(searchCardCatalog({ effect: 'landfall' }).items[0].name, 'Verdant Spawn');
  assert.deepEqual(cardCatalogOptions().effects.find((entry) => entry.value === 'landfall'), {
    value: 'landfall',
    label: 'Landfall',
    count: 1
  });
});

test('gelijknamige kaarten met verschillende Oracle-identiteiten blijven afzonderlijk', () => {
  const result = searchCardCatalog({ name: 'Shared Name', sort: 'mana' });
  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map((item) => item.catalogId), [
    'oracle-shared-one',
    'oracle-shared-two'
  ]);
});

test('kleurmodi onderscheiden subset, bevat, exact en kleurloos', () => {
  assert.equal(searchCardCatalog({ colorIdentity: 'G', colorMode: 'subset' }).total, 3);
  assert.equal(searchCardCatalog({ colorIdentity: 'G', colorMode: 'contains' }).total, 3);
  assert.equal(searchCardCatalog({ colorIdentity: 'G', colorMode: 'exact' }).total, 2);
  const colorless = searchCardCatalog({ colorIdentity: 'C', colorMode: 'exact' });
  assert.equal(colorless.total, 1);
  assert.equal(colorless.items[0].catalogId, 'oracle-shared-one');
});

test('kleuridentiteit weigert onbekende codes en kleurloos-kleurcombinaties', () => {
  for (const colorIdentity of ['X', 'G,X', 'C,G']) {
    assert.throws(
      () => searchCardCatalog({ colorIdentity }),
      (error) => error?.status === 400
    );
  }
});

test('ongeldige vervangende database laat de actieve catalogus beschikbaar', () => {
  const invalidCandidate = path.join(testDataDir, '.card-catalog-import-invalid.sqlite');
  fs.writeFileSync(invalidCandidate, 'geen sqlite-database');
  assert.throws(() => catalogDatabase.activateCardCatalog(invalidCandidate));
  assert.equal(catalogDatabase.cardCatalogStatus().available, true);
  assert.equal(searchCardCatalog({ ability: 'Landfall' }).items[0].name, 'Verdant Spawn');
  fs.rmSync(invalidCandidate, { force: true });
});

test('fout vóór de catalogusswap laat de actieve catalogus geopend en ongewijzigd', async () => {
  const replacement = path.join(testDataDir, '.card-catalog-import-pre-swap.sqlite');
  const blockingPrevious = path.join(testDataDir, 'atomic-catalog.sqlite.previous');
  await buildCardCatalogDatabase({
    source: Readable.from([JSON.stringify(fixture)]),
    databasePath: replacement,
    sourceUrl: 'fixture://AtomicCards-replacement.json',
    sourceSha256: 'b'.repeat(64)
  });
  fs.mkdirSync(blockingPrevious);
  fs.writeFileSync(path.join(blockingPrevious, 'keep'), 'blokkeer verwijderen zonder recursive');

  assert.throws(() => catalogDatabase.activateCardCatalog(replacement));
  assert.equal(catalogDatabase.cardCatalogStatus().available, true);
  assert.equal(catalogDatabase.cardCatalogStatus().cardCount, 6);
  assert.equal(searchCardCatalog({ ability: 'Landfall' }).items[0].name, 'Verdant Spawn');

  fs.rmSync(blockingPrevious, { recursive: true, force: true });
  fs.rmSync(replacement, { force: true });
});

test('zoekwaarden worden begrensd en nooit als SQL-fragment geïnterpreteerd', () => {
  assert.equal(searchCardCatalog({ name: "%' OR 1=1 --" }).total, 0);
  assert.equal(searchCardCatalog({ name: '%_^' }).total, 0);
  assert.throws(
    () => searchCardCatalog({ effect: 'onbekend' }),
    /Onbekend kaarteffect/
  );
  assert.throws(
    () => searchCardCatalog({ page: 1000, limit: 100 }),
    /buiten het toegestane bereik/
  );
});

test('stop houdt de importlock vast tot de worker echt is beëindigd', async () => {
  const first = startCardCatalogImport();
  const stoppingFirst = stopCardCatalogImport();
  assert.throws(
    () => startCardCatalogImport(),
    (error) => error?.status === 409
  );
  await stoppingFirst;
  assert.equal(cardCatalogImportStatus().id, first.id);
  assert.equal(cardCatalogImportStatus().status, 'failed');

  const second = startCardCatalogImport();
  assert.notEqual(second.id, first.id);
  await stopCardCatalogImport();
  assert.equal(cardCatalogImportStatus().id, second.id);
  assert.equal(cardCatalogImportStatus().status, 'failed');
  assert.equal(fs.existsSync(path.join(testDataDir, '.card-catalog-import.lock')), false);
});

test('een importlock van een levend ander proces wordt niet opgeruimd', () => {
  const lockPath = path.join(testDataDir, '.card-catalog-import.lock');
  fs.writeFileSync(lockPath, JSON.stringify({ id: 'other-process', pid: process.ppid }));
  try {
    assert.throws(
      () => startCardCatalogImport(),
      (error) => error?.status === 409
    );
    assert.equal(fs.existsSync(lockPath), true);
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
});
