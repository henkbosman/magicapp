import { api } from '../api.js';
import { addCardToDeck } from '../card-actions.js';
import { cardTextHtml, colorIdentity, manaCost, manaSymbol, pageHeader } from '../components.js';
import { bindFilterToggle, filterToggleHtml, filtersExpanded } from '../collapsible-filters.js';
import { formFilters, replaceRouteQuery, resetFilterForm } from '../live-filters.js';
import { openDiscoveryCardPreview } from '../discovery-preview.js';
import { prepareDiscoveryLookupNavigation } from '../navigation-state.js';
import { emptyState, escapeHtml, toast } from '../utils.js';
import { applyWriteAvailability } from '../write-access.js';

const COLOR_OPTIONS = [
  ['W', 'Wit'],
  ['U', 'Blauw'],
  ['B', 'Zwart'],
  ['R', 'Rood'],
  ['G', 'Groen'],
  ['C', 'Kleurloos']
];
// Only these fixed class names may enter the markup; super- and subtypes stay plain text.
const CARD_TYPE_CLASSES = new Map([
  ['artifact', 'artifact'], ['battle', 'battle'], ['conspiracy', 'conspiracy'],
  ['creature', 'creature'], ['dungeon', 'dungeon'], ['enchantment', 'enchantment'],
  ['instant', 'instant'], ['kindred', 'kindred'], ['land', 'land'],
  ['phenomenon', 'phenomenon'], ['plane', 'plane'], ['planeswalker', 'planeswalker'],
  ['scheme', 'scheme'], ['sorcery', 'sorcery'], ['tribal', 'tribal'], ['vanguard', 'vanguard']
]);

const LEGALITY_OPTIONS = [
  ['commander', 'Commander'],
  ['standard', 'Standard'],
  ['pioneer', 'Pioneer'],
  ['modern', 'Modern'],
  ['legacy', 'Legacy'],
  ['vintage', 'Vintage'],
  ['pauper', 'Pauper']
];
const EFFECT_OPTIONS = [
  ['landfall', 'Landfall'],
  ['token', 'Token maken'],
  ['tutor', 'Library doorzoeken'],
  ['mana', 'Mana produceren'],
  ['draw', 'Kaarten trekken'],
  ['counter', 'Counters plaatsen'],
  ['pump', 'Power/toughness verhogen'],
  ['removal', 'Permanent verwijderen'],
  ['sacrifice', 'Sacrifice-effect'],
  ['graveyard', 'Werkt met de graveyard']
];
const TUTOR_TARGET_OPTIONS = [
  ['any', 'Elke kaart'],
  ['land', 'Land'],
  ['basic_land', 'Basic land'],
  ['creature', 'Creature'],
  ['artifact', 'Artifact'],
  ['enchantment', 'Enchantment'],
  ['instant', 'Instant'],
  ['sorcery', 'Sorcery'],
  ['planeswalker', 'Planeswalker']
];
const ACTIVE_IMPORT_STATES = new Set(['queued', 'starting', 'downloading', 'download', 'parsing', 'importing', 'indexing', 'validating', 'running']);
const PRIMARY_FILTER_FIELDS = ['name', 'text', 'ability', 'keyword', 'type', 'subtype'];
const SECONDARY_FILTER_FIELDS = ['deckId', 'excludeDeckId', 'colorIdentity', 'colorMode', 'manaMin', 'manaMax', 'legality'];
const FACET_FIELDS = [
  ['ability', 'abilities', 'Alle abilities'],
  ['keyword', 'keywords', 'Alle keywords'],
  ['type', 'types', 'Alle types'],
  ['subtype', 'subtypes', 'Alle subtypes'],
  ['legality', 'legalities', 'Alle formaten'],
  ['effect', 'effects', 'Alle effecten'],
  ['tokenPower', 'tokenPowers', 'Elke sterkte'],
  ['tokenToughness', 'tokenToughnesses', 'Elke defense'],
  ['tokenType', 'tokenTypes', 'Elk tokentype'],
  ['tutorTarget', 'tutorTargets', 'Elk doel']
];

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

export function normalizeCatalogStatus(value = {}) {
  const source = value.cardCatalog || value.catalog || value;
  const job = source.importJob || source.job || value.importJob || null;
  const cardCount = Number(firstDefined(source.cardCount, source.cards, source.count, 0) || 0);
  const normalizedJob = job ? {
    id: String(firstDefined(job.id, job.jobId, '') || ''),
    status: String(firstDefined(job.status, job.state, '') || '').toLowerCase(),
    phase: String(firstDefined(job.phase, job.step, '') || ''),
    processed: Number(firstDefined(job.processed, job.current, 0) || 0),
    total: Number(firstDefined(job.total, job.cardTotal, 0) || 0),
    downloadedBytes: Number(firstDefined(job.downloadedBytes, job.bytesDownloaded, 0) || 0),
    totalBytes: Number(firstDefined(job.totalBytes, job.bytesTotal, 0) || 0),
    message: String(firstDefined(job.message, job.label, '') || ''),
    error: String(firstDefined(job.error?.message, job.error, '') || '')
  } : null;

  return {
    available: Boolean(firstDefined(source.available, source.exists, cardCount > 0)),
    databaseFile: String(firstDefined(source.databaseFile, source.file, '') || ''),
    databaseSizeBytes: Number(firstDefined(source.databaseSizeBytes, source.sizeBytes, 0) || 0),
    cardCount,
    sourceVersion: String(firstDefined(source.sourceVersion, source.version, source.source?.version, '') || ''),
    sourceDate: String(firstDefined(source.sourceDate, source.date, source.source?.date, '') || ''),
    importedAt: String(firstDefined(source.importedAt, source.lastImportedAt, '') || ''),
    error: String(firstDefined(source.error?.message, source.error, '') || ''),
    job: normalizedJob
  };
}

export function catalogImportActive(status) {
  return Boolean(status?.job && ACTIVE_IMPORT_STATES.has(String(status.job.status || '').toLowerCase()));
}

function uniqueColors(values) {
  const entries = Array.isArray(values) ? values : String(values || '').split(',');
  const colors = entries
    .map((value) => String(value).trim().toUpperCase())
    .filter((value, index, all) => COLOR_OPTIONS.some(([color]) => color === value) && all.indexOf(value) === index);
  return colors.length > 1 ? colors.filter((color) => color !== 'C') : colors;
}

function normalizedChoice(value, valid, fallback = '') {
  return valid.includes(String(value || '')) ? String(value) : fallback;
}

function normalizedDeckId(value) {
  const id = String(value || '').trim();
  return /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? String(Number(id)) : id;
}

export function discoveryFiltersFromQuery(query = new URLSearchParams()) {
  const colors = query.getAll('colorIdentity')
    .flatMap((value) => String(value).split(','));
  return {
    marked: ['1', 'true'].includes(query.get('marked')) ? '1' : '',
    deckId: normalizedDeckId(query.has('deckId') ? query.get('deckId') : query.get('excludeDeckId')),
    name: query.get('name') || '',
    text: query.get('text') || '',
    ability: query.get('ability') || '',
    keyword: query.get('keyword') || '',
    type: query.get('type') || '',
    subtype: query.get('subtype') || '',
    colorIdentity: uniqueColors(colors),
    colorMode: normalizedChoice(query.get('colorMode'), ['contains', 'exact', 'subset'], 'subset'),
    manaMin: query.get('manaMin') || '',
    manaMax: query.get('manaMax') || '',
    legality: query.get('legality') || '',
    effect: normalizedChoice(query.get('effect'), EFFECT_OPTIONS.map(([value]) => value)),
    tokenPower: query.get('tokenPower') || '',
    tokenToughness: query.get('tokenToughness') || '',
    tokenType: query.get('tokenType') || '',
    tutorTarget: normalizedChoice(query.get('tutorTarget'), TUTOR_TARGET_OPTIONS.map(([value]) => value)),
    sort: normalizedChoice(query.get('sort'), ['relevance', 'name', 'mana'], 'relevance'),
    page: Math.max(Number.parseInt(query.get('page') || '1', 10) || 1, 1),
    limit: 24
  };
}

export function discoveryRouteParams(values = {}) {
  // Saved 2.13.0 routes may still use excludeDeckId; send only the current name.
  // An explicitly empty deckId clears a legacy selection as well.
  const deckValue = values instanceof URLSearchParams
    ? values.get(values.has('deckId') ? 'deckId' : 'excludeDeckId')
    : values[Object.hasOwn(values, 'deckId') ? 'deckId' : 'excludeDeckId'];
  const params = values instanceof URLSearchParams
    ? new URLSearchParams(values)
    : new URLSearchParams();

  if (!(values instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(values)) {
      const entries = Array.isArray(value) ? value : [value];
      for (const entry of entries) {
        if (entry !== undefined && entry !== null && String(entry) !== '') params.append(key, String(entry));
      }
    }
  }

  const marked = ['1', 'true'].includes(params.get('marked'));
  params.delete('marked');
  if (marked) params.set('marked', '1');

  const deckId = normalizedDeckId(deckValue);
  params.delete('excludeDeckId');
  params.delete('deckId');
  if (deckId) params.set('deckId', deckId);

  const colors = uniqueColors(params.getAll('colorIdentity').flatMap((value) => String(value).split(',')));
  params.delete('colorIdentity');
  if (colors.length) params.set('colorIdentity', colors.join(','));

  const colorMode = normalizedChoice(params.get('colorMode'), ['contains', 'exact', 'subset'], 'subset');
  params.delete('colorMode');
  if (colors.length) params.set('colorMode', colorMode);

  const effect = normalizedChoice(params.get('effect'), EFFECT_OPTIONS.map(([value]) => value));
  params.delete('effect');
  if (effect) params.set('effect', effect);
  if (effect !== 'token') {
    params.delete('tokenPower');
    params.delete('tokenToughness');
    params.delete('tokenType');
  }
  if (effect !== 'tutor') params.delete('tutorTarget');

  const sort = normalizedChoice(params.get('sort'), ['relevance', 'name', 'mana'], 'relevance');
  params.set('sort', sort);
  params.set('page', String(Math.max(Number.parseInt(params.get('page') || '1', 10) || 1, 1)));
  params.set('limit', String(Math.min(Math.max(Number.parseInt(params.get('limit') || '24', 10) || 24, 1), 100)));
  return params;
}

export function hasPrimaryDiscoveryFilters(values = {}) {
  return PRIMARY_FILTER_FIELDS.some((key) => String(values instanceof URLSearchParams
    ? values.get(key) || '' : values[key] || '').trim().length > 0);
}

export function discoverySearchParams(values = {}) {
  const params = discoveryRouteParams(values);
  // Preserve pending choices in the form and route, but apply them only once
  // the user has selected a filter under “Tekst en kaartsoort”.
  if (!hasPrimaryDiscoveryFilters(params)) {
    for (const key of SECONDARY_FILTER_FIELDS) params.delete(key);
  }
  return params;
}

export function hasDiscoveryFilters(values = {}) {
  const params = discoverySearchParams(values);
  return [...PRIMARY_FILTER_FIELDS, 'marked', 'effect', 'tokenPower', 'tokenToughness', 'tokenType', 'tutorTarget']
    .some((key) => String(params.get(key) || '').trim().length > 0);
}

function option(value, label, selected = '') {
  return `<option value="${escapeHtml(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function optionEntries(values = []) {
  return (Array.isArray(values) ? values : []).map((entry) => {
    if (typeof entry === 'string') return { value: entry, label: entry, count: null };
    const value = String(firstDefined(entry.value, entry.name, entry.key, ''));
    return {
      value,
      label: String(firstDefined(entry.label, entry.name, value) || value),
      count: Number.isFinite(Number(entry.count ?? entry.cardCount)) ? Number(entry.count ?? entry.cardCount) : null
    };
  }).filter((entry) => entry.value);
}

function optionsHtml(values, selected) {
  const entries = optionEntries(values);
  const active = String(selected || '');
  const matching = entries.find((entry) => entry.value.toLowerCase() === active.toLowerCase());
  if (matching) matching.value = active;
  else if (active) {
    const label = [...EFFECT_OPTIONS, ...TUTOR_TARGET_OPTIONS, ...LEGALITY_OPTIONS].find(([value]) => value === active)?.[1] || active;
    entries.push({ value: active, label, count: 0 });
  }
  return entries.filter((entry) => entry.count !== 0 || entry.value === active).map((entry) => option(
    entry.value,
    entry.count === null ? entry.label : `${entry.label} (${entry.count === 0 ? '0 matches' : entry.count})`,
    selected
  )).join('');
}

function facetOptionsHtml(name, options, selected = '') {
  const [, key, placeholder] = FACET_FIELDS.find(([field]) => field === name);
  return option('', placeholder, selected) + optionsHtml(options[key] || [], selected);
}

function manaValuesHtml(options) {
  return optionsHtml(options.manaValues || [], '');
}

function deckOptionsHtml(decks, selected) {
  return option('', 'Geen deck geselecteerd', selected)
    + decks.map((deck) => option(deck.id, deck.name, selected)).join('')
    + (selected && !decks.some((deck) => String(deck.id) === selected)
      ? option(selected, `Deck #${selected} (niet beschikbaar)`, selected) : '')
    + (!decks.length && !selected ? '<option value="" disabled>Geen decks beschikbaar</option>' : '');
}

function deckSelectionErrorHtml(message = 'Het gekozen deck is niet beschikbaar.') {
  return emptyState('Deckvergelijking niet beschikbaar', `${message} Kies een ander deck of selecteer “Geen deck geselecteerd”.`);
}

function colorIdentityFilterHtml(selectedColors = [], options = {}, active = true) {
  const selected = new Set(uniqueColors(selectedColors));
  const colors = new Map(optionEntries(options.colors).map((entry) => [entry.value, entry]));
  return `<fieldset class="field discovery-color-filter">
    <legend>Commander-kleuridentiteit</legend>
    <div class="discovery-color-options">${COLOR_OPTIONS.map(([value, label]) => {
      const count = colors.get(value)?.count || 0;
      const description = `${label} (${count || '0 matches'})`;
      return `<label class="discovery-color-option${!count && selected.has(value) ? ' discovery-color-unavailable' : ''}" title="${escapeHtml(description)}">
        <input class="sr-only" type="checkbox" name="colorIdentity" value="${value}" ${selected.has(value) ? 'checked' : ''} ${active && !count && !selected.has(value) ? 'disabled' : ''} aria-label="${escapeHtml(description)}">
        <span aria-hidden="true">${manaSymbol(value, { label })}</span><span class="discovery-color-count" data-color-count aria-hidden="true">${count}</span>
      </label>`;
    }).join('')}</div>
  </fieldset>`;
}

function activeFilterCount(filters) {
  return ['marked', 'deckId', 'name', 'text', 'ability', 'keyword', 'type', 'subtype', 'manaMin', 'manaMax', 'legality', 'effect', 'tokenPower', 'tokenToughness', 'tokenType', 'tutorTarget']
    .filter((key) => String(filters[key] || '').trim().length > 0).length
    + (filters.colorIdentity.length ? 1 : 0);
}

function resultItems(result = {}) {
  return Array.isArray(result) ? result : (result.items || result.results || []);
}

function normalizedResult(result = {}, requestedPage = 1) {
  const items = resultItems(result);
  const total = Number(firstDefined(result.total, result.pagination?.total, items.length) || 0);
  const page = Math.max(Number(firstDefined(result.page, result.pagination?.page, requestedPage) || requestedPage), 1);
  const limit = Math.max(Number(firstDefined(result.limit, result.pageSize, result.pagination?.limit, 24) || 24), 1);
  const totalPages = Math.max(Number(firstDefined(result.totalPages, result.pagination?.totalPages, Math.ceil(total / limit)) || 1), 1);
  return { items, total, page, limit, totalPages };
}

function cardKeywords(card) {
  return Array.isArray(card.keywords) ? card.keywords : [];
}

export function discoveryTypeLineHtml(typeLine) {
  if (!String(typeLine || '').trim()) return 'Kaarttype onbekend';
  return String(typeLine).split(/(\/\/)/).map((face) => {
    if (face === '//') return face;
    const divider = face.search(/[—–]|\s-\s/);
    const types = divider < 0 ? face : face.slice(0, divider);
    const subtypes = divider < 0 ? '' : face.slice(divider);
    return types.split(/(\s+)/).map((word) => {
      const className = CARD_TYPE_CLASSES.get(word.toLowerCase());
      const label = escapeHtml(word);
      return className ? `<span class="discovery-card-type discovery-card-type-${className}">${label}</span>` : label;
    }).join('') + escapeHtml(subtypes);
  }).join('');
}

function catalogCardId(card) {
  return firstDefined(card.catalogId, card.id, card.catalogKey, '');
}

function discoveryMarkKey(card) {
  return String(card.markKey || card.scryfallOracleId || card.name || '');
}

export function renderDiscoveryResults(result, filters = {}) {
  const normalized = normalizedResult(result);
  if (!normalized.items.length) {
    return emptyState('Geen kaarten gevonden', 'Maak de zoekopdracht iets ruimer of verwijder één of meer filters.');
  }

  return `<div class="discovery-card-list">${normalized.items.map((card, index) => {
    const text = firstDefined(card.oracleText, card.text, '') || '';
    const typeLine = firstDefined(card.typeLine, card.type, '') || '';
    const colors = uniqueColors(firstDefined(card.colorIdentity, card.colors, []));
    const catalogId = catalogCardId(card);
    return `<article class="discovery-card${card.inDeck ? ' discovery-card-in-deck' : ''}" ${catalogId !== '' ? `data-catalog-id="${escapeHtml(String(catalogId))}"` : ''}>
      <div class="discovery-card-heading">
        <div class="discovery-card-title">
          <div class="discovery-card-name"><button type="button" class="discovery-preview-button" data-discovery-preview="${index}" aria-label="Afbeelding van ${escapeHtml(card.name || 'de kaart')} bekijken" title="Kaartafbeelding bekijken"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="5" y="2.5" width="14" height="19" rx="2"></rect><path d="M8 6h8v7H8zM8 16h8M8 18.5h5"></path></svg></button><h2>${escapeHtml(card.name || 'Naamloze kaart')}</h2></div>
          ${manaCost(card.manaCost)}
        </div>
        <p class="card-meta">${discoveryTypeLineHtml(typeLine)}</p>
        ${card.inDeck ? '<span class="discovery-deck-badge">Al in deck</span>' : ''}
      </div>
      <div class="discovery-card-rules oracle-text">${text ? cardTextHtml(text, cardKeywords(card), { highlight: filters.text || '' }) : '<span class="muted">Geen kaarttekst beschikbaar.</span>'}</div>
      <footer class="discovery-card-footer">
        <div class="discovery-card-facts">
          <span>${colorIdentity(colors)}</span>
          <span>Mana value <strong>${Number(card.manaValue || 0)}</strong></span>
          ${card.power !== undefined && card.power !== null && card.power !== '' ? `<span><strong>${escapeHtml(String(card.power))}/${escapeHtml(String(card.toughness ?? ''))}</strong></span>` : ''}
        </div>
        <div class="discovery-card-actions">
          <a class="button primary small" data-discovery-lookup href="#/add?name=${encodeURIComponent(card.name || '')}">Kaart opzoeken</a>
          <button type="button" class="button secondary small discovery-mark-button${card.marked ? ' discovery-marked' : ''}" data-write-action data-discovery-mark="${index}" aria-pressed="${card.marked ? 'true' : 'false'}" title="${card.marked ? 'Markering verwijderen' : 'Kaart markeren'}">${card.marked ? 'Gemarkeerd' : 'Markeren'}</button>
          <button type="button" class="button secondary small" data-write-action data-discovery-deck="${index}">Naar deck</button>
        </div>
      </footer>
    </article>`;
  }).join('')}</div>`;
}

export function paginationHtml(result) {
  const normalized = normalizedResult(result);
  if (normalized.total > 0 && normalized.page > normalized.totalPages) {
    return `<nav class="discovery-pagination" aria-label="Zoekresultaten doorbladeren">
      <button type="button" class="button secondary" data-discovery-page="${normalized.totalPages}">← Naar laatste pagina</button>
      <span>Pagina ${normalized.page} bestaat niet meer.</span>
    </nav>`;
  }
  if (normalized.totalPages <= 1) return '';
  return `<nav class="discovery-pagination" aria-label="Zoekresultaten doorbladeren">
    <button type="button" class="button secondary" data-discovery-page="${normalized.page - 1}" ${normalized.page <= 1 ? 'disabled' : ''}>← Vorige</button>
    <span>Pagina <strong>${normalized.page}</strong> van <strong>${normalized.totalPages}</strong></span>
    <button type="button" class="button secondary" data-discovery-page="${normalized.page + 1}" ${normalized.page >= normalized.totalPages ? 'disabled' : ''}>Volgende →</button>
  </nav>`;
}

function resultCountHtml(result) {
  const normalized = normalizedResult(result);
  return `${normalized.total} kaart${normalized.total === 1 ? '' : 'en'} gevonden`;
}

function discoveryStartHtml() {
  return emptyState('Zoek kaarten voor je deck', 'Kies een filter of vul een zoekterm in om kaarten te ontdekken.');
}

function catalogUnavailableHtml(status) {
  const active = catalogImportActive(status);
  const description = active
    ? 'De MTGJSON-kaartcatalogus wordt momenteel geïmporteerd. Zodra dit klaar is, kun je hier uitgebreid zoeken.'
    : status.error
      ? `De kaartcatalogus is niet beschikbaar: ${status.error}`
    : 'Importeer eerst AtomicCards via Onderhoud om kaarten op abilities, kaarttekst en effecten te kunnen vinden.';
  return emptyState(
    active ? 'Kaartcatalogus wordt opgebouwd' : 'Kaartcatalogus nog niet geïmporteerd',
    description,
    '<a class="button primary" href="#/settings">Naar Onderhoud</a>'
  );
}

export async function renderCardDiscovery(context) {
  const status = normalizeCatalogStatus(await api('/card-catalog/status'));
  if (!status.available) {
    return {
      html: `${pageHeader({
        eyebrow: 'Deckbouw',
        title: 'Kaarten ontdekken',
        description: 'Vind kaarten op basis van kleuridentiteit, abilities, kaarttekst en het effect dat je zoekt.'
      })}${catalogUnavailableHtml(status)}`
    };
  }

  const filters = discoveryFiltersFromQuery(context.query);
  const initialParams = discoverySearchParams(filters);
  const initialSearch = hasDiscoveryFilters(initialParams);
  const deckResponse = await api('/decks');
  const decks = Array.isArray(deckResponse) ? deckResponse : [];
  const activeDeckId = initialParams.get('deckId') || '';
  const unavailableDeck = Boolean(activeDeckId && !decks.some((deck) => String(deck.id) === activeDeckId));
  let initialDeckError = unavailableDeck ? 'Het gekozen deck is niet beschikbaar.' : '';
  const [options, rawResult] = await Promise.all([
    unavailableDeck ? Promise.resolve({}) : api(`/card-catalog/options?${initialParams}`),
    initialSearch && !unavailableDeck ? api(`/card-catalog/search?${initialParams}`) : Promise.resolve({ items: [], total: 0, page: 1 })
  ]).catch((error) => {
    // A deck can disappear between loading the dropdown and querying the catalog.
    if (!activeDeckId || ![400, 404].includes(error.status)) throw error;
    initialDeckError = error.message;
    return [{}, { items: [], total: 0, page: 1 }];
  });
  let result = normalizedResult(rawResult, filters.page);
  const filterCount = activeFilterCount(discoveryFiltersFromQuery(initialParams));
  const secondaryFiltersActive = hasPrimaryDiscoveryFilters(filters);
  const isCompactViewport = globalThis.window?.matchMedia?.('(max-width: 900px)')?.matches === true;
  const filtersOpen = context.query.has('filterPanelOpen')
    ? context.query.get('filterPanelOpen') === '1'
    : !isCompactViewport || filterCount > 0 || filtersExpanded('discover');
  const secondaryFiltersOpen = context.query.get('colorsOpen') === '1';
  const textFiltersOpen = context.query.get('textOpen') !== '0';
  const effectFiltersOpen = context.query.get('effectOpen') !== '0';

  return {
    html: `
      ${pageHeader({
        eyebrow: 'Deckbouw',
        title: 'Kaarten ontdekken',
        description: 'Combineer meerdere kenmerken om precies de kaarten te vinden die bij je deckplan passen.'
      })}
      ${filterToggleHtml({ id: 'discovery-filter-toggle', panelId: 'discovery-filter-panel discovery-secondary-filters', expanded: filtersOpen, activeCount: filterCount, resetId: 'discovery-filter-reset' })}
      <form id="discovery-filters" class="discovery-layout" autocomplete="off">
        <aside id="discovery-filter-panel" class="panel discovery-filter-panel" ${filtersOpen ? '' : 'hidden'}>
          <header class="panel-header"><h2>Zoekfilters</h2></header>
          <div class="discovery-filter-form panel-body">
            <label class="discovery-marked-filter"><input type="checkbox" name="marked" value="1" ${filters.marked ? 'checked' : ''}> Gemarkeerd</label>
            <details id="discovery-text-filters" class="discovery-filter-section"${textFiltersOpen ? ' open' : ''}>
              <summary>Tekst en kaartsoort</summary>
              <div class="discovery-filter-section-body">
              <div class="field"><label for="discovery-name">Naam</label><input id="discovery-name" name="name" type="search" value="${escapeHtml(filters.name)}" placeholder="Bijv. Zendikar"></div>
              <div class="field"><label for="discovery-text">Kaarttekst bevat</label><input id="discovery-text" name="text" type="text" value="${escapeHtml(filters.text)}" placeholder="Bijv. create a 2/2"></div>
              <div class="field"><label for="discovery-ability">Ability of trigger</label><select id="discovery-ability" name="ability">${facetOptionsHtml('ability', options, filters.ability)}</select></div>
              <div class="field"><label for="discovery-keyword">Keyword</label><select id="discovery-keyword" name="keyword">${facetOptionsHtml('keyword', options, filters.keyword)}</select></div>
              <div class="field"><label for="discovery-type">Kaarttype</label><select id="discovery-type" name="type">${facetOptionsHtml('type', options, filters.type)}</select></div>
              <div class="field"><label for="discovery-subtype">Subtype</label><select id="discovery-subtype" name="subtype">${facetOptionsHtml('subtype', options, filters.subtype)}</select></div>
              </div>
            </details>

            <details id="discovery-effect-filters" class="discovery-filter-section"${effectFiltersOpen ? ' open' : ''}>
              <summary>Effect</summary>
              <div class="discovery-filter-section-body">
              <div class="field"><label for="discovery-effect">Gewenst effect</label><select id="discovery-effect" name="effect">${facetOptionsHtml('effect', options, filters.effect)}</select></div>
              <div id="discovery-token-fields" class="discovery-effect-fields" ${filters.effect === 'token' ? '' : 'hidden'}>
                <div class="discovery-token-stats">
                  <div class="field"><label for="discovery-token-power">Tokensterkte</label><select id="discovery-token-power" name="tokenPower">${facetOptionsHtml('tokenPower', options, filters.tokenPower)}</select></div>
                  <div class="field"><label for="discovery-token-toughness">Tokendefense</label><select id="discovery-token-toughness" name="tokenToughness">${facetOptionsHtml('tokenToughness', options, filters.tokenToughness)}</select></div>
                </div>
                <div class="field"><label for="discovery-token-type">Tokentype</label><select id="discovery-token-type" name="tokenType">${facetOptionsHtml('tokenType', options, filters.tokenType)}</select></div>
              </div>
              <div id="discovery-tutor-fields" class="discovery-effect-fields" ${filters.effect === 'tutor' ? '' : 'hidden'}>
                <div class="field"><label for="discovery-tutor-target">Zoekt naar</label><select id="discovery-tutor-target" name="tutorTarget">${facetOptionsHtml('tutorTarget', options, filters.tutorTarget)}</select></div>
              </div>
              </div>
            </details>
          </div>
        </aside>

        <div class="discovery-results-column">
          <details id="discovery-secondary-filters" class="panel discovery-secondary-filters"${secondaryFiltersOpen ? ' open' : ''}${filtersOpen ? '' : ' hidden'}>
            <summary>Kleur, mana en legaliteit</summary>
            <p id="discovery-secondary-hint" class="discovery-secondary-hint muted"${secondaryFiltersActive ? ' hidden' : ''}>Deze instellingen worden toegepast zodra je een filter bij “Tekst en kaartsoort” kiest.</p>
            <div class="discovery-secondary-filter-grid">
              ${colorIdentityFilterHtml(filters.colorIdentity, options, secondaryFiltersActive)}
              <select class="discovery-color-mode" name="colorMode" aria-label="Modus voor kleuridentiteit">
                ${option('subset', 'Past binnen deze kleuren', filters.colorMode)}
                ${option('contains', 'Bevat alle gekozen kleuren', filters.colorMode)}
                ${option('exact', 'Precies deze kleuren', filters.colorMode)}
              </select>
              <div class="discovery-mana-filter">
                <div class="discovery-mana-range">
                  <div class="field"><label for="discovery-mana-min">Mana value vanaf</label><input id="discovery-mana-min" name="manaMin" type="number" min="0" step="any" list="discovery-mana-values" value="${escapeHtml(filters.manaMin)}"></div>
                  <div class="field"><label for="discovery-mana-max">Tot en met</label><input id="discovery-mana-max" name="manaMax" type="number" min="0" step="any" list="discovery-mana-values" value="${escapeHtml(filters.manaMax)}"></div>
                </div>
                <datalist id="discovery-mana-values">${manaValuesHtml(options)}</datalist>
              </div>
              <select id="discovery-deck" class="discovery-deck-select" name="deckId" aria-label="Vergelijken met deck">${deckOptionsHtml(decks, filters.deckId)}</select>
              <div class="field discovery-legality-filter"><label for="discovery-legality">Legaliteit</label><select id="discovery-legality" name="legality">${facetOptionsHtml('legality', options, filters.legality)}</select></div>
            </div>
          </details>
          <div class="discovery-results-toolbar">
            <p id="discovery-result-count" class="result-count" aria-live="polite">${initialDeckError ? 'Deckvergelijking niet beschikbaar' : initialSearch ? resultCountHtml(result) : 'Nog geen zoekopdracht'}</p>
            <label class="discovery-sort-control" for="discovery-sort">Sorteren
              <select id="discovery-sort">
                ${option('relevance', 'Relevantie', filters.sort)}
                ${option('name', 'Naam', filters.sort)}
                ${option('mana', 'Mana value', filters.sort)}
              </select>
            </label>
          </div>
          <div id="discovery-results">${initialDeckError ? deckSelectionErrorHtml(initialDeckError) : initialSearch ? renderDiscoveryResults(result, filters) : discoveryStartHtml()}</div>
          <div id="discovery-pagination-wrap">${initialSearch ? paginationHtml(result) : ''}</div>
        </div>
      </form>`,
    mount() {
      const form = document.getElementById('discovery-filters');
      const filterPanel = document.getElementById('discovery-filter-panel');
      const secondaryFilters = document.getElementById('discovery-secondary-filters');
      const textFilters = document.getElementById('discovery-text-filters');
      const effectFilters = document.getElementById('discovery-effect-filters');
      const results = document.getElementById('discovery-results');
      const count = document.getElementById('discovery-result-count');
      const pagination = document.getElementById('discovery-pagination-wrap');
      const sort = document.getElementById('discovery-sort');
      const effect = document.getElementById('discovery-effect');
      const tokenFields = document.getElementById('discovery-token-fields');
      const tutorFields = document.getElementById('discovery-tutor-fields');
      const manaValues = document.getElementById('discovery-mana-values');
      const selectedDeck = document.getElementById('discovery-deck');
      const secondaryHint = document.getElementById('discovery-secondary-hint');
      const colorControls = [...form.querySelectorAll('input[name="colorIdentity"]')];
      let currentPage = result.page;
      let displayedDeckId = activeDeckId;
      let resultRequestSequence = 0;
      let requestController = null;
      let debounceTimer = null;
      let currentOptions = options;
      const pendingMarks = new Map();
      let deckActionPending = false;

      filterPanel.scrollTop = Math.max(Number(context.query.get('filterScroll')) || 0, 0);

      const refreshMarkButtons = () => {
        if (form.isConnected === false) return;
        for (const button of results.querySelectorAll('[data-discovery-mark]')) {
          const card = result.items[Number(button.dataset.discoveryMark)];
          if (!card) continue;
          const pending = pendingMarks.has(discoveryMarkKey(card));
          button.textContent = pending ? 'Opslaan…' : card.marked ? 'Gemarkeerd' : 'Markeren';
          button.setAttribute('aria-pressed', card.marked ? 'true' : 'false');
          button.title = card.marked ? 'Markering verwijderen' : 'Kaart markeren';
          button.classList.toggle('discovery-marked', Boolean(card.marked));
          // The shared write-access observer must not re-enable an in-flight save.
          button.dataset.writeInitiallyDisabled = pending ? 'true' : 'false';
          applyWriteAvailability(button);
        }
      };
      refreshMarkButtons();

      const refreshDeckButtons = () => {
        if (form.isConnected === false) return;
        for (const button of results.querySelectorAll('[data-discovery-deck]')) {
          button.dataset.writeInitiallyDisabled = deckActionPending ? 'true' : 'false';
          applyWriteAvailability(button);
        }
      };
      refreshDeckButtons();

      const updateColors = () => {
        const colors = new Map(optionEntries(currentOptions.colors).map((entry) => [entry.value, entry]));
        const active = hasPrimaryDiscoveryFilters(new URLSearchParams(new FormData(form)));
        for (const control of colorControls) {
          const label = COLOR_OPTIONS.find(([value]) => value === control.value)?.[1] || control.value;
          const count = colors.get(control.value)?.count || 0;
          const description = `${label} (${count || '0 matches'})`;
          control.disabled = active && !control.checked && !count;
          control.setAttribute('aria-label', description);
          const labelElement = control.closest('label');
          labelElement.title = description;
          labelElement.classList.toggle('discovery-color-unavailable', !count && control.checked);
          labelElement.querySelector('[data-color-count]').textContent = String(count);
        }
      };

      for (const control of colorControls) {
        control.addEventListener('change', () => {
          if (control.checked) {
            for (const other of colorControls) {
              if (other !== control && (control.value === 'C' || other.value === 'C')) other.checked = false;
            }
          }
          updateColors();
        });
      }

      const updateEffectFields = () => {
        tokenFields.hidden = effect.value !== 'token';
        tutorFields.hidden = effect.value !== 'tutor';
        tokenFields.querySelectorAll('input, select').forEach((control) => { control.disabled = tokenFields.hidden; });
        tutorFields.querySelectorAll('input, select').forEach((control) => { control.disabled = tutorFields.hidden; });
      };
      updateEffectFields();
      effect.addEventListener('change', updateEffectFields);

      const filterToggle = bindFilterToggle({
        button: document.getElementById('discovery-filter-toggle'),
        panel: filterPanel,
        key: 'discover',
        getActiveCount: () => {
          const params = discoverySearchParams(new URLSearchParams(new FormData(form)));
          return activeFilterCount(discoveryFiltersFromQuery(params));
        }
      });
      document.getElementById('discovery-filter-toggle').addEventListener('click', () => {
        secondaryFilters.hidden = filterPanel.hidden;
      });

      const routeParams = (page = currentPage) => {
        const params = formFilters(form, { colorMode: 'subset' });
        if (sort.value !== 'relevance') params.set('sort', sort.value);
        else params.delete('sort');
        if (page > 1) params.set('page', String(page));
        else params.delete('page');
        return params;
      };

      const updateSecondaryState = () => {
        secondaryHint.hidden = hasPrimaryDiscoveryFilters(routeParams());
        updateColors();
      };

      const savePendingSecondaryChoice = (control) => {
        if (!SECONDARY_FILTER_FIELDS.includes(control.name) || hasPrimaryDiscoveryFilters(routeParams())) return false;
        replaceRouteQuery('/discover', routeParams());
        updateSecondaryState();
        filterToggle.updateActiveCount();
        return true;
      };

      const setLoading = (loading) => {
        form.classList.toggle('filters-loading', loading);
        if (loading) {
          form.setAttribute('aria-busy', 'true');
          results.setAttribute('aria-busy', 'true');
        } else {
          form.removeAttribute('aria-busy');
          results.removeAttribute('aria-busy');
        }
      };

      const invalidateRequest = () => {
        clearTimeout(debounceTimer);
        requestController?.abort();
        resultRequestSequence += 1;
      };

      const updateOptions = (nextOptions) => {
        currentOptions = nextOptions;
        for (const [name] of FACET_FIELDS) {
          const control = form.querySelector(`[name="${name}"]`);
          // Keep the control itself mounted and preserve a selected zero-match value.
          control.innerHTML = facetOptionsHtml(name, nextOptions, control.value);
        }
        updateColors();
        manaValues.innerHTML = manaValuesHtml(nextOptions);
        updateEffectFields();
      };

      const loadResults = async (routeValues) => {
        invalidateRequest();
        if (form.isConnected === false) return false;
        requestController = new AbortController();
        const { signal } = requestController;
        const requestSequence = resultRequestSequence;
        const apiParams = discoverySearchParams(routeValues);
        const shouldSearch = hasDiscoveryFilters(apiParams);
        const requestedPage = Number(apiParams.get('page'));
        replaceRouteQuery('/discover', routeValues);
        updateSecondaryState();
        if (!shouldSearch) {
          result = normalizedResult({ items: [], total: 0, page: 1 });
          currentPage = 1;
          displayedDeckId = '';
          results.innerHTML = discoveryStartHtml();
          count.textContent = 'Nog geen zoekopdracht';
          pagination.innerHTML = '';
          filterToggle.updateActiveCount();
        }
        setLoading(true);
        try {
          const [nextOptions, nextResult] = await Promise.all([
            api(`/card-catalog/options?${apiParams}`, { signal }),
            shouldSearch ? api(`/card-catalog/search?${apiParams}`, { signal }) : Promise.resolve({ items: [], total: 0, page: 1 })
          ]);
          // A keystroke invalidates immediately, including while its debounce is pending.
          if (signal.aborted || requestSequence !== resultRequestSequence || form.isConnected === false
            || discoverySearchParams(routeParams(requestedPage)).toString() !== apiParams.toString()) return false;
          const next = normalizedResult(nextResult, requestedPage);
          if (shouldSearch && requestedPage > next.totalPages) {
            currentPage = next.totalPages;
            return loadResults(routeParams(currentPage));
          }
          result = next;
          currentPage = next.page;
          displayedDeckId = apiParams.get('deckId') || '';
          updateOptions(nextOptions);
          results.innerHTML = shouldSearch ? renderDiscoveryResults(next, { text: apiParams.get('text') }) : discoveryStartHtml();
          refreshMarkButtons();
          refreshDeckButtons();
          count.textContent = shouldSearch ? resultCountHtml(next) : 'Nog geen zoekopdracht';
          pagination.innerHTML = shouldSearch ? paginationHtml(next) : '';
          filterToggle.updateActiveCount();
          return true;
        } catch (error) {
          if (requestSequence === resultRequestSequence && error?.name !== 'AbortError') {
            requestController.abort();
            // Old badges are not authoritative for another selection or after
            // a confirmed deck mutation whose refresh failed.
            if (apiParams.get('deckId') || displayedDeckId) {
              result = normalizedResult({ items: [], total: 0, page: 1 });
              currentPage = 1;
              displayedDeckId = '';
              results.innerHTML = deckSelectionErrorHtml(error.message);
              count.textContent = 'Deckvergelijking niet beschikbaar';
              pagination.innerHTML = '';
              filterToggle.updateActiveCount();
            }
            toast(error.message || 'Zoeken is mislukt.', 'error');
          }
          return false;
        } finally {
          if (requestSequence === resultRequestSequence) setLoading(false);
        }
      };

      const applyFilters = () => {
        currentPage = 1;
        return loadResults(routeParams(1));
      };

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        applyFilters();
      });
      form.addEventListener('input', (event) => {
        if (!event.target.matches('input[type="search"], input[type="text"], input[type="number"]')) return;
        if (savePendingSecondaryChoice(event.target)) return;
        invalidateRequest();
        currentPage = 1;
        updateSecondaryState();
        if (!hasDiscoveryFilters(routeParams(1))) {
          applyFilters();
          return;
        }
        setLoading(true);
        filterToggle.updateActiveCount();
        debounceTimer = setTimeout(applyFilters, 220);
      });
      form.addEventListener('change', (event) => {
        if (event.target !== sort && !savePendingSecondaryChoice(event.target)) applyFilters();
      });

      results.addEventListener('click', async (event) => {
        const deckButton = event.target.closest('[data-discovery-deck]');
        if (deckButton) {
          const card = result.items[Number(deckButton.dataset.discoveryDeck)];
          if (!card || deckActionPending || deckButton.disabled || deckButton.getAttribute('aria-disabled') === 'true') return;
          deckActionPending = true;
          refreshDeckButtons();
          const release = () => {
            deckActionPending = false;
            refreshDeckButtons();
          };
          try {
            const dialog = await addCardToDeck(card, {
              deckId: selectedDeck.value || null,
              onDone: async () => {
                if (form.isConnected !== false) await loadResults(routeParams());
              }
            });
            if (dialog && form.isConnected === false) {
              dialog.close();
              release();
            } else if (dialog) dialog.addEventListener('close', release, { once: true });
            else release();
          } catch (error) {
            release();
            if (form.isConnected !== false) toast(error.message || 'De kaart kon niet aan een deck worden toegevoegd.', 'error');
          }
          return;
        }
        const markButton = event.target.closest('[data-discovery-mark]');
        if (markButton) {
          const card = result.items[Number(markButton.dataset.discoveryMark)];
          if (!card || markButton.disabled || markButton.getAttribute('aria-disabled') === 'true') return;
          const key = discoveryMarkKey(card);
          if (pendingMarks.has(key)) return;
          const operation = Symbol(key);
          pendingMarks.set(key, operation);
          refreshMarkButtons();
          try {
            const saved = await api('/discovery-marks', {
              method: 'POST',
              body: { name: card.name, scryfallOracleId: card.scryfallOracleId || null, marked: !card.marked }
            });
            if (typeof saved?.marked !== 'boolean') throw new Error('De server heeft de markering niet bevestigd.');
            if (form.isConnected === false) return;
            // A response may arrive after another filter has replaced the list.
            for (const item of result.items) {
              if (discoveryMarkKey(item) === key) item.marked = saved.marked;
            }
            pendingMarks.delete(key);
            refreshMarkButtons();
            // Refresh the latest controls, including text still awaiting its debounce.
            // This also invalidates reads started before the saved mark was confirmed.
            loadResults(routeParams());
          } catch (error) {
            if (form.isConnected !== false) toast(error.message || 'Markeren is mislukt.', 'error');
          } finally {
            if (pendingMarks.get(key) === operation) pendingMarks.delete(key);
            refreshMarkButtons();
          }
          return;
        }
        const preview = event.target.closest('[data-discovery-preview]');
        if (preview) {
          const card = result.items[Number(preview.dataset.discoveryPreview)];
          if (card) openDiscoveryCardPreview(card);
          return;
        }
        const link = event.target.closest('[data-discovery-lookup]');
        if (!link || event.defaultPrevented || (event.button !== undefined && event.button !== 0)
          || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        // Capture edits that are still waiting for their debounce before leaving.
        invalidateRequest();
        const returnParams = routeParams();
        if (secondaryFilters.open) returnParams.set('colorsOpen', '1');
        returnParams.set('filterPanelOpen', filterPanel.hidden ? '0' : '1');
        returnParams.set('textOpen', textFilters.open ? '1' : '0');
        returnParams.set('effectOpen', effectFilters.open ? '1' : '0');
        if (filterPanel.scrollTop > 0) returnParams.set('filterScroll', String(Math.round(filterPanel.scrollTop)));
        replaceRouteQuery('/discover', returnParams);
        window.location.hash = prepareDiscoveryLookupNavigation(link.getAttribute('href'));
      });

      sort.addEventListener('change', async () => {
        currentPage = 1;
        const params = routeParams(1);
        await loadResults(params);
      });

      pagination.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-discovery-page]');
        if (!button || button.disabled) return;
        const nextPage = Math.max(Number(button.dataset.discoveryPage || 1), 1);
        const params = routeParams(nextPage);
        if (await loadResults(params)) {
          document.querySelector('.discovery-results-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });

      document.getElementById('discovery-filter-reset')?.addEventListener('click', () => {
        resetFilterForm(form, { colorMode: 'subset' });
        sort.value = 'relevance';
        updateEffectFields();
        updateColors();
        applyFilters();
      });
    }
  };
}
