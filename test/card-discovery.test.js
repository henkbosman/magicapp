import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  catalogImportActive,
  discoveryFiltersFromQuery,
  discoverySearchParams,
  normalizeCatalogStatus,
  paginationHtml,
  renderCardDiscovery,
  renderDiscoveryResults
} from '../public/js/views/card-discovery.js';
import { renderSettings } from '../public/js/views/settings.js';

function jsonResponse(data) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

test('ontdekquery normaliseert kleuridentiteit, pagina en effectafhankelijke filters', () => {
  const filters = discoveryFiltersFromQuery(new URLSearchParams([
    ['name', 'Zendikar'],
    ['ability', 'Landfall'],
    ['colorIdentity', 'G'],
    ['colorIdentity', 'R,G'],
    ['colorMode', 'subset'],
    ['effect', 'token'],
    ['tokenPower', '2'],
    ['tokenToughness', '2'],
    ['tokenType', 'Creature'],
    ['sort', 'mana'],
    ['page', '3']
  ]));

  assert.deepEqual(filters.colorIdentity, ['G', 'R']);
  assert.equal(filters.page, 3);
  assert.equal(filters.sort, 'mana');

  const params = discoverySearchParams(filters);
  assert.equal(params.get('colorIdentity'), 'G,R');
  assert.equal(params.get('colorMode'), 'subset');
  assert.equal(params.get('effect'), 'token');
  assert.equal(params.get('tokenPower'), '2');
  assert.equal(params.get('tokenToughness'), '2');
  assert.equal(params.get('tokenType'), 'Creature');
  assert.equal(params.get('page'), '3');
  assert.equal(params.get('limit'), '24');

  const tutorParams = discoverySearchParams({
    effect: 'tutor', tutorTarget: 'land', tokenPower: '2', tokenToughness: '2'
  });
  assert.equal(tutorParams.get('tutorTarget'), 'land');
  assert.equal(tutorParams.has('tokenPower'), false);
  assert.equal(tutorParams.has('tokenToughness'), false);

  const colorsWithColorless = discoverySearchParams({ colorIdentity: ['G', 'C'], colorMode: 'exact' });
  assert.equal(colorsWithColorless.get('colorIdentity'), 'G');
});

test('catalogusstatus ondersteunt importvoortgang zonder hoofd-databasekaart-id', () => {
  const status = normalizeCatalogStatus({
    available: false,
    cardCount: 0,
    job: {
      jobId: 'import-1',
      status: 'downloading',
      bytesDownloaded: 1024,
      bytesTotal: 4096,
      message: 'AtomicCards downloaden…'
    }
  });

  assert.equal(status.available, false);
  assert.equal(status.job.id, 'import-1');
  assert.equal(status.job.downloadedBytes, 1024);
  assert.equal(catalogImportActive(status), true);
});

test('een verouderde paginalink biedt een terugweg naar de laatste geldige pagina', () => {
  const html = paginationHtml({ items: [], total: 4, page: 100, limit: 24, totalPages: 1 });
  assert.match(html, /data-discovery-page="1"/);
  assert.match(html, /Pagina 100 bestaat niet meer/);
});

test('ontdekresultaten tonen mana, kaarttekst, matchredenen en alleen een veilige opzoeklink', () => {
  const html = renderDiscoveryResults({
    items: [{
      catalogId: 'catalog-901',
      name: "Zendikar's Roil",
      manaCost: '{3}{G}{G}',
      manaValue: 5,
      colorIdentity: ['G'],
      typeLine: 'Enchantment',
      oracleText: 'Landfall — Whenever a land enters the battlefield under your control, create a 2/2 green Elemental creature token.',
      keywords: ['Landfall'],
      matchReasons: ['Landfall', 'Maakt een 2/2 creature token']
    }],
    total: 1,
    page: 1,
    limit: 24,
    totalPages: 1
  });

  assert.match(html, /data-catalog-id="catalog-901"/);
  assert.match(html, /aria-label="Manakosten \{3\}\{G\}\{G\}"/);
  assert.match(html, /<mark class="oracle-keyword">Landfall<\/mark>/);
  assert.match(html, /Maakt een 2\/2 creature token/);
  assert.match(html, /href="#\/add\?q=Zendikar's%20Roil"[^>]*>Kaart opzoeken<\/a>/);
  assert.doesNotMatch(html, /#\/cards\/catalog-901|\/cards\/catalog-901\/image/);
});

test('ontdekpagina toont bij ontbrekende catalogus een duidelijke onderhouds-CTA', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ available: false, cardCount: 0 });
  try {
    const view = await renderCardDiscovery({ query: new URLSearchParams() });
    assert.match(view.html, /Kaartcatalogus nog niet geïmporteerd/);
    assert.match(view.html, /href="#\/settings">Naar Onderhoud<\/a>/);
    assert.doesNotMatch(view.html, /id="discovery-filters"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ontdekpagina vraagt opties en zoekresultaten op en bouwt alle kernfilters', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes('/card-catalog/status')) {
      return jsonResponse({ available: true, cardCount: 1200 });
    }
    if (String(url).includes('/card-catalog/options')) {
      return jsonResponse({
        abilities: [{ value: 'Landfall', count: 12 }],
        keywords: ['Trample'],
        types: ['Creature', 'Enchantment'],
        effects: [{ value: 'token', label: 'Token maken', count: 8 }],
        tokenPowers: [{ value: '2', count: 8 }],
        tokenToughnesses: [{ value: '2', count: 8 }],
        colors: [{ value: 'G', label: 'Groen', count: 8 }]
      });
    }
    return jsonResponse({ items: [], total: 0, page: 1, limit: 24, totalPages: 1 });
  };

  try {
    const view = await renderCardDiscovery({
      query: new URLSearchParams('ability=Landfall&effect=token&tokenPower=2&tokenToughness=2&colorIdentity=G')
    });
    assert.match(view.html, /<h1>Kaarten ontdekken<\/h1>/);
    assert.match(view.html, /id="discovery-filter-toggle"[\s\S]*?aria-controls="discovery-filter-panel"/);
    assert.match(view.html, /id="discovery-filter-panel" class="panel discovery-filter-panel"/);
    assert.match(view.html, /name="name"/);
    assert.match(view.html, /name="text"/);
    assert.match(view.html, /name="ability"[\s\S]*?<option value="Landfall" selected>Landfall \(12\)<\/option>/);
    assert.match(view.html, /name="keyword"/);
    assert.match(view.html, /name="type"/);
    assert.match(view.html, /name="subtype"/);
    assert.match(view.html, /name="colorIdentity" value="G" checked/);
    assert.match(view.html, /name="manaMin"/);
    assert.match(view.html, /name="manaMax"/);
    assert.match(view.html, /name="legality"/);
    assert.match(view.html, /name="effect"[\s\S]*?<option value="token" selected>Token maken \(8\)<\/option>/);
    assert.match(view.html, /name="tokenPower"[\s\S]*?<option value="2" selected>2 \(8\)<\/option>/);
    assert.match(view.html, /name="tokenToughness"[\s\S]*?<option value="2" selected>2 \(8\)<\/option>/);
    assert.match(view.html, /name="tutorTarget"/);
    assert.match(view.html, /id="discovery-sort"/);
    assert.ok(requested.some((url) => url.includes('/card-catalog/options')));
    assert.ok(requested.some((url) => url.includes('/card-catalog/search?') && url.includes('ability=Landfall') && url.includes('effect=token')));
    const optionQuery = requested.find((url) => url.includes('/card-catalog/options?')).split('?')[1];
    const resultQuery = requested.find((url) => url.includes('/card-catalog/search?')).split('?')[1];
    assert.equal(optionQuery, resultQuery, 'Opties gebruiken ook bij directe URL-navigatie alle actieve filters');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lege facets blijven leeg en behouden veilige nulselecties uit een gedeelde URL', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/status')) return jsonResponse({ available: true, cardCount: 1200 });
    if (String(url).includes('/options')) {
      return jsonResponse({
        abilities: [], keywords: [], types: [], subtypes: [], colors: [], effects: [],
        legalities: [], tutorTargets: [], tokenPowers: [], tokenToughnesses: [], tokenTypes: [],
        manaValues: [], manaRange: { min: null, max: null }
      });
    }
    return jsonResponse({ items: [], total: 0, page: 1 });
  };
  try {
    const view = await renderCardDiscovery({ query: new URLSearchParams({
      type: 'Instant', subtype: '\"><img src=x onerror=alert(1)>', legality: 'modern',
      effect: 'tutor', tutorTarget: 'land', colorIdentity: 'G', manaMin: '1.5', manaMax: '99'
    }) });
    assert.match(view.html, /<option value="Instant" selected>Instant \(0 matches\)<\/option>/);
    assert.match(view.html, /<option value="modern" selected>Modern \(0 matches\)<\/option>/);
    assert.match(view.html, /<option value="tutor" selected>Library doorzoeken \(0 matches\)<\/option>/);
    assert.match(view.html, /<option value="land" selected>Land \(0 matches\)<\/option>/);
    assert.doesNotMatch(view.html, /<option value="(?:Creature|token|commander|artifact)"/);
    assert.match(view.html, /name="subtype"><option value=""[^>]*>Alle subtypes<\/option><option value="&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;" selected/);
    assert.doesNotMatch(view.html, /<img src=x/);
    assert.match(view.html, /name="colorIdentity" value="G" checked\s+aria-label="Groen \(0 matches\)"/);
    assert.match(view.html, /name="colorIdentity" value="W"\s+disabled/);
    assert.match(view.html, /name="manaMin"[^>]*step="any"[^>]*value="1\.5"/);
    assert.match(view.html, /name="manaMax"[^>]*value="99"/);
    assert.match(view.html, /<datalist id="discovery-mana-values"><\/datalist>/);
    assert.match(view.html, /Geen mana values binnen de overige filters/);
    assert.match(view.html, /Geselecteerde opties met 0 matches blijven staan/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('alle begrensde filters gebruiken facets en mana-suggesties zonder handmatige grenzen te overschrijven', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/status')) return jsonResponse({ available: true, cardCount: 1200 });
    if (String(url).includes('/options')) {
      return jsonResponse({
        types: [{ value: 'Instant', count: 4 }],
        subtypes: [{ value: 'Arcane', count: 3 }],
        effects: [{ value: 'token', label: 'Token maken', count: 2 }],
        tokenPowers: [{ value: '2', count: 2 }],
        tokenToughnesses: [{ value: '2', count: 2 }],
        tokenTypes: [{ value: 'Spirit', count: 2 }],
        legalities: [{ value: 'modern', label: 'Modern', count: 4 }],
        manaValues: [{ value: '2', count: 3 }, { value: '4', count: 1 }],
        manaRange: { min: 2, max: 4 }
      });
    }
    return jsonResponse({ items: [], total: 0, page: 1 });
  };
  try {
    const view = await renderCardDiscovery({ query: new URLSearchParams('type=instant&effect=token&manaMin=1&manaMax=100') });
    assert.match(view.html, /<option value="instant" selected>Instant \(4\)<\/option>/);
    assert.doesNotMatch(view.html, /Instant \(0 matches\)/);
    for (const name of ['subtype', 'legality', 'tokenPower', 'tokenToughness', 'tokenType']) {
      assert.match(view.html, new RegExp(`<select[^>]+name="${name}"`));
    }
    assert.match(view.html, /<option value="Arcane"[^>]*>Arcane \(3\)<\/option>/);
    assert.match(view.html, /<option value="Spirit"[^>]*>Spirit \(2\)<\/option>/);
    assert.match(view.html, /Beschikbare mana values: 2–4/);
    assert.match(view.html, /name="manaMin"[^>]*value="1"/);
    assert.match(view.html, /name="manaMax"[^>]*value="100"/);
    assert.match(view.html, /<datalist id="discovery-mana-values"><option value="2"[^>]*>2 \(3\)<\/option><option value="4"[^>]*>4 \(1\)<\/option><\/datalist>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('onderhoud toont de losse MTGJSON-catalogus en importactie', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/card-catalog/status')) {
      return jsonResponse({
        available: true,
        databaseFile: 'mtgjson-atomic.sqlite',
        databaseSizeBytes: 1048576,
        cardCount: 32100,
        sourceVersion: '5.3.0',
        sourceDate: '2026-10-02',
        importedAt: '2026-10-03T06:30:00.000Z'
      });
    }
    return jsonResponse({
      applicationVersion: 'test',
      nodeVersion: 'v24',
      databaseFile: 'magic-collection.sqlite',
      databaseSizeBytes: 1,
      imageCacheEnabled: true,
      cachedImages: 0,
      externalApiCache: {},
      printingCatalog: {},
      databaseIntegrity: 'ok',
      foreignKeyIssues: 0,
      schemaVersion: 20000,
      counts: { cards: 1, collectionItems: 1, decks: 1, wantedItems: 1 }
    });
  };

  try {
    const view = await renderSettings();
    assert.match(view.html, /<h2>MTGJSON-kaartcatalogus<\/h2>/);
    assert.match(view.html, /volledig afzonderlijke SQLite-database/);
    assert.match(view.html, /mtgjson-atomic\.sqlite/);
    assert.match(view.html, /32\.100/);
    assert.match(view.html, /id="import-card-catalog"[^>]*data-write-action[^>]*>Kaartcatalogus bijwerken<\/button>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('navigatie en CSS maken de ontdekpagina ook mobiel bereikbaar', () => {
  const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.equal((index.match(/href="#\/discover" data-nav="discover"/g) || []).length, 2);
  assert.match(index, /Kaarten ontdekken/);
  assert.match(index, /<small>Ontdekken<\/small>/);
  assert.match(app, /pattern:\s*\/\^\\\/discover\$\//);
  assert.match(styles, /\.discovery-layout\s*\{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.discovery-layout:has\(> \.discovery-filter-panel\[hidden\]\)\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width:\s*900px\)[\s\S]*?\.discovery-layout\s*\{[^}]*grid-template-columns:\s*1fr;/);
  assert.match(styles, /\.mobile-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,/);
});
