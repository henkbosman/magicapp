import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { cardTextHtml } from '../public/js/components.js';
import { isCrossOriginBrowserRequest } from '../src/lib/request-security.js';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-collection-import-'));
process.env.DATA_DIR = testDataDir;
process.env.DATABASE_FILE = 'test.sqlite';

const importService = await import('../src/services/import-export-service.js');
const cardCacheService = await import('../src/services/card-cache-service.js');
const cardRepository = await import('../src/services/card-repository.js');
const database = await import('../src/db/database.js');
const { scryfallService } = await import('../src/services/scryfall-service.js');

const defaults = {
  finish: 'nonfoil',
  language: 'en',
  condition: 'near_mint',
  location: 'Testdoos',
  notes: 'Testimport',
  reconcileWanted: true
};

cardRepository.upsertScryfallCard({
  id: '00000000-0000-4000-8000-000000000001',
  oracle_id: '00000000-0000-4000-8000-000000000002',
  name: 'Test Card',
  mana_cost: '{1}{B}',
  cmc: 2,
  colors: ['B'],
  color_identity: ['B'],
  type_line: 'Creature — Test',
  oracle_text: '{T}: Add {B}.',
  keywords: [],
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '1',
  rarity: 'common',
  lang: 'en',
  layout: 'normal',
  games: ['paper'],
  legalities: {},
  finishes: ['nonfoil', 'foil'],
  prices: {}
});

after(() => {
  database.closeDatabase();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('kaarttekst rendert bekende symbolen en escaped overige HTML', () => {
  const html = cardTextHtml('Add {B}. {T}: Add {C}. <img src=x> {UNKNOWN} {W/U/P}');
  assert.match(html, /mana-bg-B/);
  assert.match(html, /mana-bg-T/);
  assert.match(html, /aria-label="Tappen"/);
  assert.match(html, /mana-bg-C/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /\{UNKNOWN\}/);
  assert.match(html, /W\/U\/P/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test('write-beveiliging blokkeert cross-origin browsers maar laat API-clients toe', () => {
  assert.equal(isCrossOriginBrowserRequest({ host: 'magic.example.nl' }), false);
  assert.equal(isCrossOriginBrowserRequest({
    origin: 'http://localhost:3000',
    host: 'localhost:3000',
    fetchSite: 'same-origin'
  }), false);
  assert.equal(isCrossOriginBrowserRequest({
    origin: 'https://aanvaller.example',
    host: 'aanvaller.example',
    fetchSite: 'same-origin'
  }), true);
  assert.equal(isCrossOriginBrowserRequest({
    origin: 'https://fc-attacker.example',
    host: 'fc-attacker.example',
    fetchSite: 'same-origin'
  }), true);
  for (const hostname of ['10.evil.example', '127.evil.example', '172.16.evil.example', '192.168.evil.example']) {
    assert.equal(isCrossOriginBrowserRequest({
      origin: `https://${hostname}`,
      host: hostname,
      fetchSite: 'same-origin'
    }), true);
  }
  assert.equal(isCrossOriginBrowserRequest({
    origin: 'https://evil.example',
    host: 'magic.example.nl',
    fetchSite: 'cross-site'
  }), true);
  assert.equal(isCrossOriginBrowserRequest({ origin: 'null', host: 'magic.example.nl' }), true);
  assert.equal(isCrossOriginBrowserRequest({
    origin: 'https://cards.example.nl',
    host: 'interne-proxy:3000',
    fetchSite: 'same-origin',
    allowedOrigin: 'https://cards.example.nl'
  }), false);
  assert.equal(isCrossOriginBrowserRequest({
    origin: 'http://cards.example.nl',
    host: 'cards.example.nl',
    fetchSite: 'same-origin',
    allowedOrigin: 'https://cards.example.nl'
  }), true);
  assert.equal(isCrossOriginBrowserRequest({ fetchSite: 'same-site' }), true);
});

test('collectielijstparser ondersteunt headings, exact printings, 1x en foil', () => {
  const parsed = importService.parseCollectionList(`Commander
1 Test Card (TST) 1

Main Deck (99)
2x Test Card
1 Test Card (TST) 1 *F*
1 Test Card (TST) 1 *E*
SB:
# opmerking`);
  assert.equal(parsed.failures.length, 0);
  assert.equal(parsed.rows.length, 4);
  assert.deepEqual(parsed.rows.map((row) => row.quantity), [1, 2, 1, 1]);
  assert.equal(parsed.rows[0].set, 'tst');
  assert.equal(parsed.rows[0].collectorNumber, '1');
  assert.equal(parsed.rows[2].foil, true);
  assert.equal(parsed.rows[3].finishOverride, 'etched');
});

test('collectielijstparser begrenst grote lijsten', () => {
  const parsed = importService.parseCollectionList(new Array(1001).fill('1 Test Card').join('\n'));
  assert.equal(parsed.rows.length, 1000);
  assert.equal(parsed.failures.length, 1);
  assert.equal(parsed.failures[0].code, 'too_many_rows');
  assert.equal(parsed.failures[0].line, 1001);
});

test('collectielijstparser wijst ongeldige aantallen met regelnummers af', () => {
  const parsed = importService.parseCollectionList('0 Test Card\n1.5 Test Card\n-2 Test Card');
  assert.equal(parsed.rows.length, 0);
  assert.deepEqual(parsed.failures.map((failure) => failure.line), [1, 2, 3]);
  assert.ok(parsed.failures.every((failure) => failure.code === 'invalid_quantity'));
});

test('collectielijstparser weigert onbekende tekst na een exact kaartnummer', () => {
  const parsed = importService.parseCollectionList('1 Test Card (TST) 1 *TYPO*\n1 Test Card (TST) 1 extra');
  assert.equal(parsed.rows.length, 0);
  assert.deepEqual(parsed.failures.map((failure) => failure.code), ['unknown_finish_marker', 'unexpected_suffix']);
});

test('preview toont exacte en automatisch gekozen printings zonder te schrijven', async () => {
  const preview = await importService.previewCollectionImport(
    '1 Test Card (TST) 1\n2 Test Card',
    defaults
  );
  assert.equal(preview.canImport, true);
  assert.equal(preview.summary.quantity, 3);
  assert.equal(preview.summary.inferredPrintings, 1);
  assert.match(preview.previewToken, /^[a-f0-9]{64}$/u);
  assert.equal(preview.items[0].setCode, 'tst');
  assert.equal(preview.items[0].inferredPrinting, false);
  assert.equal(preview.items[1].inferredPrinting, true);
  assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM collection_items').get().count, 0);
});

test('import aggregeert dubbelen en schrijft de lijst atomair', async () => {
  const result = await importService.importCollectionList(
    '1 Test Card (TST) 1\n2 Test Card',
    defaults
  );
  assert.equal(result.importedCount, 2);
  assert.equal(result.importedQuantity, 3);
  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0].quantity, 3);

  const beforeFailure = database.db.prepare('SELECT SUM(quantity) AS quantity FROM collection_items').get().quantity;
  await assert.rejects(
    () => importService.importCollectionList('1 Test Card (TST) 1\n0 Test Card', defaults),
    (error) => error?.status === 422 && error?.details?.canImport === false
  );
  const afterFailure = database.db.prepare('SELECT SUM(quantity) AS quantity FROM collection_items').get().quantity;
  assert.equal(afterFailure, beforeFailure);

  await assert.rejects(
    () => importService.importCollectionList('1 Test Card (TST) 1', defaults, 'verouderde-preview'),
    (error) => error?.status === 409 && Boolean(error?.details?.previewToken)
  );
  assert.equal(database.db.prepare('SELECT SUM(quantity) AS quantity FROM collection_items').get().quantity, beforeFailure);
});

test('preview controleert taal, kaartnaam en paper-beschikbaarheid', async () => {
  cardRepository.upsertScryfallCard({
    id: '00000000-0000-4000-8000-000000000003',
    oracle_id: '00000000-0000-4000-8000-000000000002',
    name: 'Test Card',
    printed_name: 'Testkaart',
    mana_cost: '{1}{B}',
    cmc: 2,
    colors: ['B'],
    color_identity: ['B'],
    type_line: 'Creature — Test',
    oracle_text: '{T}: Add {B}.',
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    rarity: 'common',
    lang: 'nl',
    layout: 'normal',
    games: ['paper'],
    legalities: {},
    finishes: ['nonfoil'],
    prices: {}
  });
  cardRepository.upsertScryfallCard({
    id: '00000000-0000-4000-8000-000000000013', oracle_id: '00000000-0000-4000-8000-000000000013',
    name: 'Mixed Card', mana_cost: '', cmc: 0, colors: [], color_identity: [], type_line: 'Artifact',
    oracle_text: '', set: 'pap', set_name: 'Paper Set', collector_number: '1', rarity: 'common', lang: 'en',
    layout: 'normal', released_at: '2020-01-01', games: ['paper'], legalities: {}, finishes: ['nonfoil'], prices: {}
  });
  cardRepository.upsertScryfallCard({
    id: '00000000-0000-4000-8000-000000000014', oracle_id: '00000000-0000-4000-8000-000000000013',
    name: 'Mixed Card', mana_cost: '', cmc: 0, colors: [], color_identity: [], type_line: 'Artifact',
    oracle_text: '', set: 'dig', set_name: 'Digital Set', collector_number: '2', rarity: 'common', lang: 'en',
    layout: 'normal', released_at: '2026-01-01', games: ['arena'], legalities: {}, finishes: ['nonfoil'], prices: {}
  });
  cardRepository.upsertScryfallCard({
    id: '00000000-0000-4000-8000-000000000004',
    oracle_id: '00000000-0000-4000-8000-000000000004',
    name: 'Digital Test Card',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    type_line: 'Artifact',
    oracle_text: '',
    set: 'dar',
    set_name: 'Digital Arena',
    collector_number: '1',
    rarity: 'common',
    lang: 'en',
    layout: 'normal',
    games: ['arena'],
    legalities: {},
    finishes: ['nonfoil'],
    prices: {}
  });

  const dutch = await importService.previewCollectionImport('1 Testkaart (TST) 1', { ...defaults, language: 'nl' });
  assert.equal(dutch.canImport, true);
  assert.equal(dutch.items[0].printingLanguage, 'nl');

  const dutchWithoutPrinting = await importService.previewCollectionImport('1 Testkaart', { ...defaults, language: 'nl' });
  assert.equal(dutchWithoutPrinting.canImport, false);
  assert.equal(dutchWithoutPrinting.failures[0].code, 'language_requires_exact_printing');

  const wrongName = await importService.previewCollectionImport('1 Andere kaart (TST) 1', defaults);
  assert.equal(wrongName.canImport, false);
  assert.equal(wrongName.failures[0].code, 'name_mismatch');

  const missingExactLanguage = await importService.previewCollectionImport('1 Test Card', { ...defaults, language: 'de' });
  assert.equal(missingExactLanguage.canImport, false);
  assert.equal(missingExactLanguage.failures[0].code, 'language_requires_exact_printing');

  const digital = await importService.previewCollectionImport('1 Digital Test Card (DAR) 1', defaults);
  assert.equal(digital.canImport, false);
  assert.equal(digital.failures[0].code, 'not_available_on_paper');

  const unsupportedFinish = await importService.previewCollectionImport('1 Test Card (TST) 1 *E*', defaults);
  assert.equal(unsupportedFinish.canImport, false);
  assert.equal(unsupportedFinish.failures[0].code, 'unsupported_finish');

  const inferredPaper = await importService.previewCollectionImport('1 Mixed Card', defaults);
  assert.equal(inferredPaper.canImport, true);
  assert.equal(inferredPaper.items[0].setCode, 'pap');
});

test('niet-Engelse exacte printings worden per set gebundeld opgehaald', async () => {
  const originalLoader = scryfallService.cardsBySetAndLanguage;
  let calls = 0;
  scryfallService.cardsBySetAndLanguage = async (setCode, language) => {
    calls += 1;
    assert.equal(setCode, 'grp');
    assert.equal(language, 'nl');
    return [
      {
        id: '00000000-0000-4000-8000-000000000011', oracle_id: '00000000-0000-4000-8000-000000000011',
        name: 'Grouped One', printed_name: 'Gegroepeerd Een', mana_cost: '', cmc: 0, colors: [], color_identity: [],
        type_line: 'Artifact', oracle_text: '', set: 'grp', set_name: 'Grouped Set', collector_number: '1',
        rarity: 'common', lang: 'nl', layout: 'normal', games: ['paper'], legalities: {}, finishes: ['nonfoil'], prices: {}
      },
      {
        id: '00000000-0000-4000-8000-000000000012', oracle_id: '00000000-0000-4000-8000-000000000012',
        name: 'Grouped Two', printed_name: 'Gegroepeerd Twee', mana_cost: '', cmc: 0, colors: [], color_identity: [],
        type_line: 'Artifact', oracle_text: '', set: 'grp', set_name: 'Grouped Set', collector_number: '2a',
        rarity: 'common', lang: 'nl', layout: 'normal', games: ['paper'], legalities: {}, finishes: ['nonfoil'], prices: {}
      }
    ];
  };
  let result;
  try {
    result = await cardCacheService.ensureCardsByCollectorLanguage([
      { set: 'grp', collector_number: '1' },
      { set: 'grp', collector_number: '2A' }
    ], 'nl');
  } finally {
    scryfallService.cardsBySetAndLanguage = originalLoader;
  }
  assert.equal(calls, 1);
  assert.equal(result.resolved.length, 2);
  assert.ok(result.resolved.every(({ card }) => card.language === 'nl'));
});

test('exacte naamcontrole ondersteunt Unicode en gedrukte alternatieve namen', async () => {
  cardRepository.upsertScryfallCard({
    id: '00000000-0000-4000-8000-000000000007', oracle_id: '00000000-0000-4000-8000-000000000007',
    name: 'Cache Card', printed_name: 'カード', mana_cost: '', cmc: 0, colors: [], color_identity: [],
    type_line: 'Artifact', oracle_text: '', set: 'jpn', set_name: 'Japanese Test', collector_number: '1',
    rarity: 'common', lang: 'ja', layout: 'normal', games: ['paper'], legalities: {}, finishes: ['nonfoil'], prices: {}
  });
  cardRepository.upsertScryfallCard({
    id: '00000000-0000-4000-8000-000000000008', oracle_id: '00000000-0000-4000-8000-000000000008',
    name: 'Zilortha, Strength Incarnate', flavor_name: 'Godzilla, King of the Monsters', mana_cost: '', cmc: 0,
    colors: [], color_identity: [], type_line: 'Legendary Creature', oracle_text: '', set: 'iko', set_name: 'Ikoria',
    collector_number: '275', rarity: 'mythic', lang: 'en', layout: 'normal', games: ['paper'], legalities: {},
    finishes: ['nonfoil'], prices: {}
  });

  const correctJapanese = await importService.previewCollectionImport('1 カード (JPN) 1', { ...defaults, language: 'ja' });
  assert.equal(correctJapanese.canImport, true);

  const wrongJapanese = await importService.previewCollectionImport('1 カート (JPN) 1', { ...defaults, language: 'ja' });
  assert.equal(wrongJapanese.canImport, false);
  assert.equal(wrongJapanese.failures[0].code, 'name_mismatch');

  const alternateName = await importService.previewCollectionImport('1 Godzilla, King of the Monsters (IKO) 275', defaults);
  assert.equal(alternateName.canImport, true);
  assert.equal(alternateName.items[0].name, 'Zilortha, Strength Incarnate');
});

test('numeriek beginnende kaartnamen blijven volledige namen', async () => {
  cardRepository.upsertScryfallCard({
    id: '00000000-0000-4000-8000-000000000009', oracle_id: '00000000-0000-4000-8000-000000000009',
    name: '1996 World Champion', mana_cost: '', cmc: 0, colors: [], color_identity: [], type_line: 'Summon — Legend',
    oracle_text: '', set: 'pcel', set_name: 'Celebration', collector_number: '1', rarity: 'rare', lang: 'en',
    layout: 'normal', games: ['paper'], legalities: {}, finishes: ['nonfoil'], prices: {}
  });
  cardRepository.upsertScryfallCard({
    id: '00000000-0000-4000-8000-000000000015', oracle_id: '00000000-0000-4000-8000-000000000015',
    name: '+2 Mace', mana_cost: '', cmc: 0, colors: [], color_identity: [], type_line: 'Artifact — Equipment',
    oracle_text: '', set: 'afr', set_name: 'Forgotten Realms', collector_number: '1', rarity: 'common', lang: 'en',
    layout: 'normal', games: ['paper'], legalities: {}, finishes: ['nonfoil'], prices: {}
  });
  cardRepository.upsertScryfallCard({
    id: '00000000-0000-4000-8000-000000000010', oracle_id: '00000000-0000-4000-8000-000000000010',
    name: '10,000 Year Storm', mana_cost: '', cmc: 0, colors: [], color_identity: [], type_line: 'Enchantment',
    oracle_text: '', set: 'unf', set_name: 'Unfinity', collector_number: '1', rarity: 'rare', lang: 'en',
    layout: 'normal', games: ['paper'], legalities: {}, finishes: ['nonfoil'], prices: {}
  });

  const originalGetCollection = scryfallService.getCollection;
  scryfallService.getCollection = async (identifiers) => ({ cards: [], notFound: identifiers });
  let champion;
  try {
    champion = await importService.previewCollectionImport('1996 World Champion', defaults);
  } finally {
    scryfallService.getCollection = originalGetCollection;
  }
  assert.equal(champion.canImport, true);
  assert.equal(champion.items[0].name, '1996 World Champion');
  assert.equal(champion.items[0].quantity, 1);

  const exactChampion = await importService.previewCollectionImport('1996 World Champion (PCEL) 1', defaults);
  assert.equal(exactChampion.canImport, true);
  assert.equal(exactChampion.items[0].quantity, 1);

  const storm = await importService.previewCollectionImport('10,000 Year Storm', defaults);
  assert.equal(storm.canImport, true);
  assert.equal(storm.items[0].name, '10,000 Year Storm');
  assert.equal(storm.items[0].quantity, 1);

  const mace = await importService.previewCollectionImport('+2 Mace (AFR) 1', defaults);
  assert.equal(mace.canImport, true);
  assert.equal(mace.items[0].name, '+2 Mace');
});

test('buitenste transactie rolt een eerdere groepswrite terug bij een latere databasefout', async () => {
  const first = cardRepository.upsertScryfallCard({
    id: '00000000-0000-4000-8000-000000000005', oracle_id: '00000000-0000-4000-8000-000000000005',
    name: 'Rollback One', mana_cost: '', cmc: 0, colors: [], color_identity: [], type_line: 'Artifact',
    oracle_text: '', set: 'rbk', set_name: 'Rollback Set', collector_number: '1', rarity: 'common',
    lang: 'en', layout: 'normal', games: ['paper'], legalities: {}, finishes: ['nonfoil'], prices: {}
  });
  const second = cardRepository.upsertScryfallCard({
    id: '00000000-0000-4000-8000-000000000006', oracle_id: '00000000-0000-4000-8000-000000000006',
    name: 'Rollback Two', mana_cost: '', cmc: 0, colors: [], color_identity: [], type_line: 'Artifact',
    oracle_text: '', set: 'rbk', set_name: 'Rollback Set', collector_number: '2', rarity: 'common',
    lang: 'en', layout: 'normal', games: ['paper'], legalities: {}, finishes: ['nonfoil'], prices: {}
  });
  database.db.exec(`
    CREATE TRIGGER force_collection_import_failure
    BEFORE INSERT ON collection_items
    WHEN NEW.card_id = ${Number(second.id)}
    BEGIN
      SELECT RAISE(ABORT, 'geforceerde importfout');
    END;
  `);
  try {
    await assert.rejects(() => importService.importCollectionList(
      '1 Rollback One (RBK) 1\n1 Rollback Two (RBK) 2',
      defaults
    ));
  } finally {
    database.db.exec('DROP TRIGGER force_collection_import_failure');
  }
  const written = database.db.prepare(`
    SELECT COUNT(*) AS count FROM collection_items WHERE card_id IN (?, ?)
  `).get(first.id, second.id).count;
  assert.equal(written, 0);
});
