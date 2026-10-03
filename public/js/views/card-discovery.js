import { api } from '../api.js';
import { cardTextHtml, colorIdentity, manaCost, manaSymbol, pageHeader } from '../components.js';
import { bindFilterToggle, filterToggleHtml, filtersExpanded } from '../collapsible-filters.js';
import { bindLiveFilters, replaceRouteQuery, resetFilterForm } from '../live-filters.js';
import { emptyState, escapeHtml, toast } from '../utils.js';

const COLOR_OPTIONS = [
  ['W', 'Wit'],
  ['U', 'Blauw'],
  ['B', 'Zwart'],
  ['R', 'Rood'],
  ['G', 'Groen'],
  ['C', 'Kleurloos']
];

const TYPE_OPTIONS = ['Creature', 'Land', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Battle'];
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

export function discoveryFiltersFromQuery(query = new URLSearchParams()) {
  const colors = query.getAll('colorIdentity')
    .flatMap((value) => String(value).split(','));
  return {
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

export function discoverySearchParams(values = {}) {
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

function option(value, label, selected = '') {
  return `<option value="${escapeHtml(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function optionEntries(values = []) {
  return (Array.isArray(values) ? values : []).map((entry) => {
    if (typeof entry === 'string') return { value: entry, label: entry, count: null };
    const value = String(firstDefined(entry.value, entry.name, entry.key, '') || '');
    return {
      value,
      label: String(firstDefined(entry.label, entry.name, value) || value),
      count: Number.isFinite(Number(entry.count ?? entry.cardCount)) ? Number(entry.count ?? entry.cardCount) : null
    };
  }).filter((entry) => entry.value);
}

function optionsHtml(values, selected) {
  return optionEntries(values).map((entry) => option(
    entry.value,
    entry.count === null ? entry.label : `${entry.label} (${entry.count})`,
    selected
  )).join('');
}

function colorIdentityFilterHtml(selectedColors = [], mode = 'subset') {
  const selected = new Set(uniqueColors(selectedColors));
  return `<fieldset class="field discovery-color-filter">
    <legend>Commander-kleuridentiteit</legend>
    <div class="discovery-color-options">${COLOR_OPTIONS.map(([value, label]) => `<label class="discovery-color-option" title="${escapeHtml(label)}">
      <input class="sr-only" type="checkbox" name="colorIdentity" value="${value}" ${selected.has(value) ? 'checked' : ''}>
      <span aria-hidden="true">${manaSymbol(value, { label })}</span><span class="sr-only">${escapeHtml(label)}</span>
    </label>`).join('')}</div>
    <select name="colorMode" aria-label="Modus voor kleuridentiteit">
      ${option('subset', 'Past binnen deze kleuren', mode)}
      ${option('contains', 'Bevat alle gekozen kleuren', mode)}
      ${option('exact', 'Precies deze kleuren', mode)}
    </select>
  </fieldset>`;
}

function activeFilterCount(filters) {
  return ['name', 'text', 'ability', 'keyword', 'type', 'subtype', 'manaMin', 'manaMax', 'legality', 'effect', 'tokenPower', 'tokenToughness', 'tokenType', 'tutorTarget']
    .filter((key) => String(filters[key] || '').length > 0).length
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

function cardMatchReasons(card) {
  const raw = Array.isArray(card.matchReasons) ? card.matchReasons : [];
  return raw.map((reason) => typeof reason === 'string'
    ? reason
    : firstDefined(reason.label, reason.description, reason.value, reason.kind, ''))
    .map((reason) => String(reason || '').trim())
    .filter(Boolean);
}

function catalogCardId(card) {
  return firstDefined(card.catalogId, card.id, card.catalogKey, '');
}

export function renderDiscoveryResults(result) {
  const normalized = normalizedResult(result);
  if (!normalized.items.length) {
    return emptyState('Geen kaarten gevonden', 'Maak de zoekopdracht iets ruimer of verwijder één of meer filters.');
  }

  return `<div class="discovery-card-list">${normalized.items.map((card) => {
    const text = firstDefined(card.oracleText, card.text, '') || '';
    const typeLine = firstDefined(card.typeLine, card.type, '') || '';
    const colors = uniqueColors(firstDefined(card.colorIdentity, card.colors, []));
    const reasons = cardMatchReasons(card);
    const catalogId = catalogCardId(card);
    return `<article class="discovery-card" ${catalogId !== '' ? `data-catalog-id="${escapeHtml(String(catalogId))}"` : ''}>
      <div class="discovery-card-heading">
        <div class="discovery-card-title">
          <h2>${escapeHtml(card.name || 'Naamloze kaart')}</h2>
          ${manaCost(card.manaCost)}
        </div>
        <p class="card-meta">${escapeHtml(typeLine || 'Kaarttype onbekend')}</p>
      </div>
      <div class="discovery-card-rules oracle-text">${text ? cardTextHtml(text, cardKeywords(card)) : '<span class="muted">Geen kaarttekst beschikbaar.</span>'}</div>
      ${reasons.length ? `<div class="discovery-match-reasons" aria-label="Waarom deze kaart overeenkomt">${reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join('')}</div>` : ''}
      <footer class="discovery-card-footer">
        <div class="discovery-card-facts">
          <span>${colorIdentity(colors)}</span>
          <span>Mana value <strong>${Number(card.manaValue || 0)}</strong></span>
          ${card.power !== undefined && card.power !== null && card.power !== '' ? `<span><strong>${escapeHtml(String(card.power))}/${escapeHtml(String(card.toughness ?? ''))}</strong></span>` : ''}
        </div>
        <a class="button primary small" href="#/add?q=${encodeURIComponent(card.name || '')}">Kaart opzoeken</a>
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
  const [options, rawResult] = await Promise.all([
    api('/card-catalog/options'),
    api(`/card-catalog/search?${initialParams}`)
  ]);
  let result = normalizedResult(rawResult, filters.page);
  const filterCount = activeFilterCount(filters);
  const isCompactViewport = globalThis.window?.matchMedia?.('(max-width: 900px)')?.matches === true;
  const filtersOpen = !isCompactViewport || filterCount > 0 || filtersExpanded('discover');
  const abilities = options.abilities || options.triggers || [];
  const keywords = options.keywords || [];
  const types = options.types?.length ? options.types : TYPE_OPTIONS;
  const effects = options.effects?.length ? options.effects : EFFECT_OPTIONS.map(([value, label]) => ({ value, label }));
  const tutorTargets = options.tutorTargets?.length ? options.tutorTargets : TUTOR_TARGET_OPTIONS.map(([value, label]) => ({ value, label }));

  return {
    html: `
      ${pageHeader({
        eyebrow: 'Deckbouw',
        title: 'Kaarten ontdekken',
        description: 'Combineer meerdere kenmerken om precies de kaarten te vinden die bij je deckplan passen.'
      })}
      <p class="discovery-filter-note">Alle actieve filters worden gecombineerd. Effectfilters zijn afgeleid van de Engelse kaarttekst; controleer voor gebruik altijd de kaartdetails.</p>
      ${filterToggleHtml({ id: 'discovery-filter-toggle', panelId: 'discovery-filter-panel', expanded: filtersOpen, activeCount: filterCount, resetId: 'discovery-filter-reset' })}
      <section class="discovery-layout">
        <aside id="discovery-filter-panel" class="panel discovery-filter-panel" ${filtersOpen ? '' : 'hidden'}>
          <header class="panel-header"><h2>Zoekfilters</h2></header>
          <form id="discovery-filters" class="discovery-filter-form panel-body" autocomplete="off">
            <section class="discovery-filter-section">
              <h3>Tekst en kaartsoort</h3>
              <div class="field"><label for="discovery-name">Naam</label><input id="discovery-name" name="name" type="search" value="${escapeHtml(filters.name)}" placeholder="Bijv. Zendikar"></div>
              <div class="field"><label for="discovery-text">Kaarttekst bevat</label><input id="discovery-text" name="text" type="text" value="${escapeHtml(filters.text)}" placeholder="Bijv. create a 2/2"></div>
              <div class="field"><label for="discovery-ability">Ability of trigger</label><select id="discovery-ability" name="ability"><option value="">Alle abilities</option>${optionsHtml(abilities, filters.ability)}</select></div>
              <div class="field"><label for="discovery-keyword">Keyword</label><select id="discovery-keyword" name="keyword"><option value="">Alle keywords</option>${optionsHtml(keywords, filters.keyword)}</select></div>
              <div class="field"><label for="discovery-type">Kaarttype</label><select id="discovery-type" name="type"><option value="">Alle types</option>${optionsHtml(types, filters.type)}</select></div>
              <div class="field"><label for="discovery-subtype">Subtype</label><input id="discovery-subtype" name="subtype" type="text" value="${escapeHtml(filters.subtype)}" placeholder="Bijv. Elf of Elemental"></div>
            </section>

            <section class="discovery-filter-section">
              <h3>Kleur, mana en legaliteit</h3>
              ${colorIdentityFilterHtml(filters.colorIdentity, filters.colorMode)}
              <div class="discovery-mana-range">
                <div class="field"><label for="discovery-mana-min">Mana value vanaf</label><input id="discovery-mana-min" name="manaMin" type="number" min="0" step="1" value="${escapeHtml(filters.manaMin)}"></div>
                <div class="field"><label for="discovery-mana-max">Tot en met</label><input id="discovery-mana-max" name="manaMax" type="number" min="0" step="1" value="${escapeHtml(filters.manaMax)}"></div>
              </div>
              <div class="field"><label for="discovery-legality">Legaliteit</label><select id="discovery-legality" name="legality"><option value="">Alle formaten</option>${LEGALITY_OPTIONS.map(([value, label]) => option(value, label, filters.legality)).join('')}</select></div>
            </section>

            <section class="discovery-filter-section">
              <h3>Effect</h3>
              <div class="field"><label for="discovery-effect">Gewenst effect</label><select id="discovery-effect" name="effect"><option value="">Alle effecten</option>${optionsHtml(effects, filters.effect)}</select></div>
              <div id="discovery-token-fields" class="discovery-effect-fields" ${filters.effect === 'token' ? '' : 'hidden'}>
                <div class="discovery-token-stats">
                  <div class="field"><label for="discovery-token-power">Tokensterkte</label><input id="discovery-token-power" name="tokenPower" value="${escapeHtml(filters.tokenPower)}" placeholder="2"></div>
                  <div class="field"><label for="discovery-token-toughness">Tokendefense</label><input id="discovery-token-toughness" name="tokenToughness" value="${escapeHtml(filters.tokenToughness)}" placeholder="2"></div>
                </div>
                <div class="field"><label for="discovery-token-type">Tokentype</label><input id="discovery-token-type" name="tokenType" value="${escapeHtml(filters.tokenType)}" placeholder="Creature of Elemental"></div>
              </div>
              <div id="discovery-tutor-fields" class="discovery-effect-fields" ${filters.effect === 'tutor' ? '' : 'hidden'}>
                <div class="field"><label for="discovery-tutor-target">Zoekt naar</label><select id="discovery-tutor-target" name="tutorTarget"><option value="">Elk doel</option>${optionsHtml(tutorTargets, filters.tutorTarget)}</select></div>
              </div>
            </section>
          </form>
        </aside>

        <div class="discovery-results-column">
          <div class="discovery-results-toolbar">
            <p id="discovery-result-count" class="result-count" aria-live="polite">${resultCountHtml(result)}</p>
            <label class="discovery-sort-control" for="discovery-sort">Sorteren
              <select id="discovery-sort">
                ${option('relevance', 'Relevantie', filters.sort)}
                ${option('name', 'Naam', filters.sort)}
                ${option('mana', 'Mana value', filters.sort)}
              </select>
            </label>
          </div>
          <div id="discovery-results">${renderDiscoveryResults(result)}</div>
          <div id="discovery-pagination-wrap">${paginationHtml(result)}</div>
        </div>
      </section>`,
    mount() {
      const form = document.getElementById('discovery-filters');
      const filterPanel = document.getElementById('discovery-filter-panel');
      const results = document.getElementById('discovery-results');
      const count = document.getElementById('discovery-result-count');
      const pagination = document.getElementById('discovery-pagination-wrap');
      const sort = document.getElementById('discovery-sort');
      const effect = document.getElementById('discovery-effect');
      const tokenFields = document.getElementById('discovery-token-fields');
      const tutorFields = document.getElementById('discovery-tutor-fields');
      const colorControls = [...form.querySelectorAll('input[name="colorIdentity"]')];
      let currentPage = result.page;
      let resultRequestSequence = 0;
      let liveFilters;

      for (const control of colorControls) {
        control.addEventListener('change', () => {
          if (!control.checked) return;
          for (const other of colorControls) {
            if (other !== control && (control.value === 'C' || other.value === 'C')) other.checked = false;
          }
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
          const data = new FormData(form);
          const active = new Set([...data.entries()]
            .filter(([key, value]) => key !== 'colorMode' && String(value || '').length > 0)
            .map(([key]) => key));
          return active.size;
        }
      });

      const routeParams = (page = currentPage) => {
        const params = liveFilters?.getParams() || new URLSearchParams(new FormData(form));
        if (sort.value !== 'relevance') params.set('sort', sort.value);
        else params.delete('sort');
        if (page > 1) params.set('page', String(page));
        else params.delete('page');
        return params;
      };

      const loadResults = async (routeValues, signal) => {
        const requestSequence = ++resultRequestSequence;
        const apiParams = discoverySearchParams(routeValues);
        const next = normalizedResult(await api(`/card-catalog/search?${apiParams}`, { signal }), Number(apiParams.get('page')));
        if (requestSequence !== resultRequestSequence) return false;
        result = next;
        currentPage = next.page;
        results.innerHTML = renderDiscoveryResults(next);
        count.textContent = resultCountHtml(next);
        pagination.innerHTML = paginationHtml(next);
        filterToggle.updateActiveCount();
        return true;
      };

      liveFilters = bindLiveFilters({
        form,
        routePath: '/discover',
        defaults: { colorMode: 'subset' },
        onApply: async (params, signal) => {
          currentPage = 1;
          if (sort.value !== 'relevance') params.set('sort', sort.value);
          replaceRouteQuery('/discover', params);
          await loadResults(params, signal);
        },
        onError: (error) => toast(error.message || 'Zoeken is mislukt.', 'error')
      });

      sort.addEventListener('change', async () => {
        currentPage = 1;
        const params = routeParams(1);
        replaceRouteQuery('/discover', params);
        try {
          await loadResults(params);
        } catch (error) {
          toast(error.message || 'Sorteren is mislukt.', 'error');
        }
      });

      pagination.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-discovery-page]');
        if (!button || button.disabled) return;
        const nextPage = Math.max(Number(button.dataset.discoveryPage || 1), 1);
        const params = routeParams(nextPage);
        replaceRouteQuery('/discover', params);
        try {
          if (await loadResults(params)) {
            document.querySelector('.discovery-results-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } catch (error) {
          toast(error.message || 'Resultaten laden is mislukt.', 'error');
        }
      });

      document.getElementById('discovery-filter-reset')?.addEventListener('click', () => {
        resetFilterForm(form, { colorMode: 'subset' });
        sort.value = 'relevance';
        updateEffectFields();
        liveFilters.apply();
      });
    }
  };
}
