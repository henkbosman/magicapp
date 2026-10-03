import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  catalogImportActive,
  discoveryFiltersFromQuery,
  discoverySearchParams,
  discoveryTypeLineHtml,
  hasDiscoveryFilters,
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

test('alleen inhoudelijke filters starten een zoekopdracht', () => {
  for (const query of ['', 'sort=mana&page=2', 'colorMode=exact', 'text=%20%20', 'tokenPower=2&tutorTarget=land', 'marked=0', 'marked=false']) {
    assert.equal(hasDiscoveryFilters(new URLSearchParams(query)), false, query);
  }
  for (const query of ['text=draw', 'type=Instant', 'manaMin=0', 'colorIdentity=C', 'effect=token&tokenPower=2', 'marked=1', 'marked=true']) {
    assert.equal(hasDiscoveryFilters(new URLSearchParams(query)), true, query);
  }
});

test('Gemarkeerd normaliseert echte selecties en laat uitgeschakelde waarden weg', () => {
  for (const value of ['1', 'true']) {
    const filters = discoveryFiltersFromQuery(new URLSearchParams({ marked: value }));
    assert.equal(Boolean(filters.marked), true);
    assert.equal(discoverySearchParams(filters).get('marked'), '1');
  }
  for (const value of ['', '0', 'false']) {
    assert.equal(Boolean(discoveryFiltersFromQuery(new URLSearchParams({ marked: value })).marked), false);
    assert.equal(discoverySearchParams({ marked: value }).has('marked'), false);
  }
  assert.equal(discoverySearchParams({ marked: true }).get('marked'), '1');
  assert.equal(discoverySearchParams({ marked: false }).has('marked'), false);
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

test('ontdekresultaten tonen mana, kaarttekst en een veilige opzoeklink zonder matchredenen', () => {
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
      matchReasons: ['Kaarttekst bevat “create”', 'Kleuridentiteit: G', { label: 'Maakt een 2/2 creature token' }]
    }],
    total: 1,
    page: 1,
    limit: 24,
    totalPages: 1
  });

  assert.match(html, /data-catalog-id="catalog-901"/);
  assert.match(html, /aria-label="Manakosten \{3\}\{G\}\{G\}"/);
  assert.match(html, /<mark class="oracle-keyword">Landfall<\/mark>/);
  assert.doesNotMatch(html, /discovery-match-reasons|Kaarttekst bevat|Kleuridentiteit: G|Maakt een 2\/2 creature token/);
  assert.match(html, /class="discovery-card-type discovery-card-type-enchantment">Enchantment<\/span>/);
  assert.match(html, /href="#\/add\?name=Zendikar's%20Roil"[^>]*>Kaart opzoeken<\/a>/);
  assert.match(html, /data-discovery-preview="0" aria-label="Afbeelding van Zendikar&#039;s Roil bekijken"/);
  assert.match(html, /data-discovery-lookup/);
  assert.match(html, /data-write-action[^>]*data-discovery-mark="0"/);
  assert.match(html, /aria-pressed="false"[^>]*>[^<]*Markeren<\/button>/);
  assert.ok(html.indexOf('data-discovery-preview') < html.indexOf("Zendikar&#039;s Roil</h2>"), 'preview icon precedes the title text');
  assert.doesNotMatch(html, /#\/cards\/catalog-901|\/cards\/catalog-901\/image/);
});

test('een opgeslagen markering is zichtbaar als bevestigde schakelknop', () => {
  const html = renderDiscoveryResults({ items: [{ name: 'Gemarkeerde kaart', marked: true, markKey: 'oracle:card-1' }] });
  assert.match(html, /data-write-action[^>]*data-discovery-mark="0"/);
  assert.match(html, /aria-pressed="true"[^>]*>[^<]*Gemarkeerd<\/button>/);
});

test('ontdekkaarttypes krijgen afzonderlijke kleuren met behoud van super- en subtypes', () => {
  assert.equal(discoveryTypeLineHtml('Legendary Artifact Creature — Golem'),
    'Legendary <span class="discovery-card-type discovery-card-type-artifact">Artifact</span> <span class="discovery-card-type discovery-card-type-creature">Creature</span> — Golem');
  assert.equal(discoveryTypeLineHtml('Basic Snow Land — Forest'),
    'Basic Snow <span class="discovery-card-type discovery-card-type-land">Land</span> — Forest');
  const uncommon = discoveryTypeLineHtml('Kindred Instant — Arcane');
  assert.match(uncommon, /discovery-card-type-kindred">Kindred<\/span>/);
  assert.match(uncommon, /discovery-card-type-instant">Instant<\/span> — Arcane$/);
});

test('elke kaartzijde kleurt alleen types vóór de scheidingsstreep', () => {
  const html = discoveryTypeLineHtml('Creature — Land // Sorcery — Instant');
  assert.equal(html,
    '<span class="discovery-card-type discovery-card-type-creature">Creature</span> — Land // <span class="discovery-card-type discovery-card-type-sorcery">Sorcery</span> — Instant');
  assert.equal(discoveryTypeLineHtml('Artifact — Powerstone // Land'),
    '<span class="discovery-card-type discovery-card-type-artifact">Artifact</span> — Powerstone // <span class="discovery-card-type discovery-card-type-land">Land</span>');
});

test('onbekende types en onveilige type-inhoud blijven gewone ontsnapte tekst', () => {
  assert.equal(discoveryTypeLineHtml('Futuretype'), 'Futuretype');
  assert.equal(discoveryTypeLineHtml(''), 'Kaarttype onbekend');
  assert.equal(discoveryTypeLineHtml('  '), 'Kaarttype onbekend');
  const html = discoveryTypeLineHtml('<img src=x onerror="alert(1)"> Creature — <script>Land</script>');
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /discovery-card-type-creature">Creature<\/span>/);
  assert.match(html, /&lt;script&gt;Land&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img|<script|discovery-card-type-land/);
});

test('alle kaarttypekleuren zijn verschillend en leesbaar', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const types = ['Artifact', 'Battle', 'Conspiracy', 'Creature', 'Dungeon', 'Enchantment', 'Instant', 'Kindred', 'Land', 'Phenomenon', 'Plane', 'Planeswalker', 'Scheme', 'Sorcery', 'Tribal', 'Vanguard'];
  const backgrounds = new Set();
  const luminance = (hex) => hex.match(/../g).map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
  for (const type of types) {
    const html = discoveryTypeLineHtml(type);
    const className = `discovery-card-type-${type.toLowerCase()}`;
    assert.ok(html.includes(className), type);
    const style = styles.match(new RegExp(`\\.${className} \\{ background: #([a-f0-9]{6}); color: #([a-f0-9]{6}); \\}`));
    assert.ok(style, `Kleuren ontbreken voor ${type}`);
    backgrounds.add(style[1]);
    const contrast = (luminance(style[1]) + .05) / (luminance(style[2]) + .05);
    assert.ok(contrast >= 4.5, `${type} heeft onvoldoende tekstcontrast (${contrast})`);
  }
  assert.equal(backgrounds.size, types.length);
});

test('ontdekresultaten arceren de letterlijke kaarttekstzoekopdracht en behouden keyword- en manamarkup', () => {
  const html = renderDiscoveryResults({ items: [{ name: 'Landfall card', oracleText: 'Landfall — Add {G}. Landfall triggers.', keywords: ['Landfall'] }] }, { text: 'landfall' });
  assert.equal((html.match(/class="oracle-search-match"/g) || []).length, 2);
  assert.match(html, /oracle-keyword/);
  assert.match(html, /mana-symbol/);
  assert.doesNotMatch(renderDiscoveryResults({ items: [{ name: 'Test', oracleText: 'No query.' }] }), /oracle-search-match/);
});

test('een nieuwe ontdekpagina toont nog geen kaarten en vraagt alleen filteropties op', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return jsonResponse(String(url).includes('/status') ? { available: true, cardCount: 1200 } : {});
  };
  try {
    const view = await renderCardDiscovery({ query: new URLSearchParams('sort=mana') });
    assert.match(view.html, /Zoek kaarten voor je deck/);
    assert.match(view.html, /Nog geen zoekopdracht/);
    assert.doesNotMatch(view.html, /class="discovery-card"|Geen kaarten gevonden/);
    assert.equal(requested.filter((url) => url.includes('/search')).length, 0);
    assert.equal(requested.filter((url) => url.includes('/options')).length, 1);
    assert.match(view.html, /<details[^>]*class="panel discovery-secondary-filters"[^>]*>/);
    assert.doesNotMatch(view.html, /<details[^>]*class="panel discovery-secondary-filters"[^>]*\bopen\b|discovery-filter-note|Effectfilters zijn afgeleid/);
    assert.match(view.html, /<details[^>]*id="discovery-text-filters"[^>]*\bopen\b[^>]*>[\s\S]*?<summary>Tekst en kaartsoort<\/summary>/);
    assert.match(view.html, /<details[^>]*id="discovery-effect-filters"[^>]*\bopen\b[^>]*>[\s\S]*?<summary>Effect<\/summary>/);
    const sidebar = view.html.slice(view.html.indexOf('<aside'), view.html.indexOf('</aside>'));
    assert.doesNotMatch(sidebar, /name="colorIdentity"|name="manaMin"|name="legality"/);
    assert.match(view.html, /<form id="discovery-filters"[\s\S]*<aside[\s\S]*<details[\s\S]*name="colorIdentity"[\s\S]*<\/form>/);
  } finally { globalThis.fetch = originalFetch; }
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
    assert.match(view.html, /id="discovery-filter-toggle"[\s\S]*?aria-controls="discovery-filter-panel discovery-secondary-filters"/);
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
    assert.doesNotMatch(view.html, /discovery-filter-note/);
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
