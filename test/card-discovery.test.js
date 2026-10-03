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
        types: ['Creature', 'Enchantment']
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
    assert.match(view.html, /name="effect"[\s\S]*?<option value="token" selected>Token maken<\/option>/);
    assert.match(view.html, /name="tokenPower" value="2"/);
    assert.match(view.html, /name="tokenToughness" value="2"/);
    assert.match(view.html, /name="tutorTarget"/);
    assert.match(view.html, /id="discovery-sort"/);
    assert.ok(requested.some((url) => url.includes('/card-catalog/options')));
    assert.ok(requested.some((url) => url.includes('/card-catalog/search?') && url.includes('ability=Landfall') && url.includes('effect=token')));
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
