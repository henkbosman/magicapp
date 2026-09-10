import { api, queryString } from './api.js';
import { cardSearchResult } from './components.js';
import { debounce, escapeHtml, loadingBlock } from './utils.js';
import { consumePendingScroll, prepareCardDetailNavigation } from './navigation-state.js';
import { applyWriteAvailability, initializeWriteAccess } from './write-access.js';
import { renderAddCard } from './views/add-card.js';
import { renderCardDetail } from './views/card-detail.js';
import { renderCollection } from './views/collection.js';
import { renderDashboard } from './views/dashboard.js';
import { renderDeckDetail } from './views/deck-detail.js';
import { renderDeckStatistics } from './views/deck-statistics.js';
import { renderDeckSimulator } from './views/deck-simulator.js';
import { renderDecks } from './views/decks.js';
import { renderSettings } from './views/settings.js';
import { renderWanted } from './views/wanted.js';

const root = document.getElementById('app');
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
let renderSequence = 0;

const routes = [
  { pattern: /^\/dashboard$/, name: 'dashboard', render: renderDashboard },
  { pattern: /^\/collection$/, name: 'collection', render: renderCollection },
  { pattern: /^\/add$/, name: 'add', render: renderAddCard },
  { pattern: /^\/decks$/, name: 'decks', render: renderDecks },
  { pattern: /^\/decks\/(?<id>\d+)$/, name: 'decks', render: renderDeckDetail },
  { pattern: /^\/decks\/(?<id>\d+)\/stats$/, name: 'decks', render: renderDeckStatistics },
  { pattern: /^\/decks\/(?<id>\d+)\/simulate$/, name: 'decks', render: renderDeckSimulator },
  { pattern: /^\/wanted$/, name: 'wanted', render: renderWanted },
  { pattern: /^\/cards\/(?<id>\d+)$/, name: '', render: renderCardDetail },
  { pattern: /^\/settings$/, name: 'settings', render: renderSettings }
];

function currentLocation() {
  const raw = (window.location.hash || '#/dashboard').slice(1);
  const [pathPart, queryPart = ''] = raw.split('?', 2);
  return { path: pathPart.startsWith('/') ? pathPart : `/${pathPart}`, query: new URLSearchParams(queryPart) };
}

function markActive(name) {
  document.querySelectorAll('[data-nav]').forEach((link) => link.classList.toggle('active', Boolean(name) && link.dataset.nav === name));
}

async function renderRoute() {
  const sequence = ++renderSequence;
  const location = currentLocation();
  const match = routes.map((route) => ({ route, result: location.path.match(route.pattern) })).find((entry) => entry.result);
  if (!match) {
    root.innerHTML = `<div class="empty-state"><div class="empty-icon">?</div><h1>Pagina niet gevonden</h1><p>Deze route bestaat niet.</p><a class="button primary" href="#/dashboard">Naar dashboard</a></div>`;
    markActive('');
    return;
  }

  markActive(match.route.name);
  root.innerHTML = loadingBlock('Gegevens laden…');
  hideGlobalResults();
  try {
    const view = await match.route.render({
      params: match.result.groups || {},
      query: location.query,
      path: location.path,
      refresh: renderRoute
    });
    if (sequence !== renderSequence) return;
    root.innerHTML = view.html;
    view.mount?.();
    applyWriteAvailability(root);
    root.focus({ preventScroll: true });
    const restoredScroll = consumePendingScroll(window.location.hash);
    if (restoredScroll === null) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.scrollTo({ top: restoredScroll, behavior: 'auto' });
      }));
    }
  } catch (error) {
    if (sequence !== renderSequence) return;
    root.innerHTML = `<div class="error-state"><div class="empty-icon">!</div><h1>Deze pagina kon niet worden geladen</h1><p>${escapeHtml(error.message || 'Onbekende fout')}</p><div class="page-actions"><button id="retry-view" class="button primary">Opnieuw proberen</button><a href="#/dashboard" class="button secondary">Dashboard</a></div></div>`;
    document.getElementById('retry-view')?.addEventListener('click', renderRoute);
  }
}

const globalSearch = document.getElementById('global-search');
const globalResults = document.getElementById('global-search-results');

function hideGlobalResults() {
  globalResults.hidden = true;
  globalResults.innerHTML = '';
}

const performGlobalSearch = debounce(async () => {
  const query = globalSearch.value.trim();
  if (query.length < 2) return hideGlobalResults();
  globalResults.hidden = false;
  globalResults.innerHTML = '<div class="picker-status"><span class="spinner"></span> Lokaal zoeken…</div>';
  try {
    const cards = await api(`/cards/search${queryString({ q: query, limit: 12 })}`);
    if (!cards.length) {
      globalResults.innerHTML = `<div class="picker-status"><strong>Nog niet lokaal bekend</strong><p>Zoek deze kaart via Scryfall en kies een printing.</p><a class="button primary compact" data-write-action href="#/add?q=${encodeURIComponent(query)}">Kaart opzoeken</a></div>`;
      return;
    }
    globalResults.innerHTML = `${cards.map(cardSearchResult).join('')}<div class="search-popover-footer"><a class="button ghost compact" data-write-action href="#/add?q=${encodeURIComponent(query)}">Andere printing of nieuwe kaart zoeken →</a></div>`;
    globalResults.querySelectorAll('[data-card-id]').forEach((button) => button.addEventListener('click', () => {
      window.location.hash = prepareCardDetailNavigation(`#/cards/${button.dataset.cardId}`);
      globalSearch.value = '';
      hideGlobalResults();
    }));
  } catch (error) {
    globalResults.innerHTML = `<div class="picker-status text-danger">${escapeHtml(error.message)}</div>`;
  }
}, 160);

globalSearch.addEventListener('input', performGlobalSearch);
globalSearch.addEventListener('focus', () => {
  if (globalSearch.value.trim().length >= 2) performGlobalSearch();
});
globalSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    globalSearch.value = '';
    hideGlobalResults();
    globalSearch.blur();
  }
  if (event.key === 'Enter') {
    const first = globalResults.querySelector('[data-card-id]');
    if (first) {
      event.preventDefault();
      first.click();
    }
  }
});
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-card-detail-link]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const href = link.getAttribute('href');
  if (!href?.startsWith('#/cards/')) return;
  event.preventDefault();
  window.location.hash = prepareCardDetailNavigation(href);
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.global-search-wrap')) hideGlobalResults();
});
document.addEventListener('keydown', (event) => {
  const tag = document.activeElement?.tagName;
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
    event.preventDefault();
    globalSearch.focus();
  }
});


initializeWriteAccess();

window.addEventListener('hashchange', renderRoute);
window.addEventListener('app:refresh', renderRoute);
if (!window.location.hash) window.location.hash = '#/dashboard';
else renderRoute();
