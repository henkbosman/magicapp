const CARD_RETURN_PREFIX = 'magic-collection:card-return:';
const DECK_STATS_RETURN_PREFIX = 'magic-collection:deck-stats-return:';
const DISCOVERY_RETURN_PREFIX = 'magic-collection:discovery-return:';
const PENDING_SCROLL_KEY = 'magic-collection:pending-scroll';
const MAX_STATE_AGE_MS = 12 * 60 * 60 * 1000;
const discoveryReturnStates = new Map();
let pendingDiscoveryScroll = null;

function safeSessionGet(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key, value) {
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeSessionRemove(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Session storage is optional; navigation still works without it.
  }
}

function parseState(value) {
  if (!value) return null;
  try {
    const state = JSON.parse(value);
    if (!state || typeof state !== 'object') return null;
    if (state.createdAt && Date.now() - Number(state.createdAt) > MAX_STATE_AGE_MS) return null;
    return state;
  } catch {
    return null;
  }
}

function token() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sourceLabel(hash = '') {
  if (hash.startsWith('#/collection')) return 'Terug naar collectie';
  if (hash.startsWith('#/add')) return 'Terug naar kaart opzoeken';
  if (hash.startsWith('#/wanted')) return 'Terug naar Wanted';
  if (/^#\/decks\/\d+\/stats/.test(hash)) return 'Terug naar deckstatistieken';
  if (/^#\/decks\/\d+\/simulate/.test(hash)) return 'Terug naar simulator';
  if (/^#\/decks\/\d+/.test(hash)) return 'Terug naar deck';
  if (hash.startsWith('#/decks')) return 'Terug naar decks';
  if (hash.startsWith('#/dashboard')) return 'Terug naar dashboard';
  return 'Terug';
}

function saveReturnState(prefix, href) {
  const returnToken = token();
  const state = {
    hash: window.location.hash || '#/dashboard',
    scrollY: Math.max(0, Math.round(window.scrollY || 0)),
    createdAt: Date.now()
  };
  safeSessionSet(`${prefix}${returnToken}`, JSON.stringify(state));
  const separator = String(href).includes('?') ? '&' : '?';
  return `${href}${separator}return=${encodeURIComponent(returnToken)}`;
}

function getReturnState(prefix, returnToken) {
  if (!returnToken) return null;
  return parseState(safeSessionGet(`${prefix}${returnToken}`));
}

function queueScrollRestore(destination, scrollY) {
  safeSessionSet(PENDING_SCROLL_KEY, JSON.stringify({
    hash: destination,
    scrollY: Math.max(0, Number(scrollY) || 0),
    createdAt: Date.now()
  }));
}

function returnToSource(prefix, returnToken, fallbackHash) {
  const state = getReturnState(prefix, returnToken);
  const destination = state?.hash || fallbackHash;
  const scrollY = Number.isFinite(Number(state?.scrollY)) ? Math.max(0, Number(state.scrollY)) : 0;
  queueScrollRestore(destination, scrollY);

  if (returnToken) safeSessionRemove(`${prefix}${returnToken}`);

  if (state && window.history.length > 1) {
    window.history.back();
    window.setTimeout(() => {
      const stillOnDetail = /^#\/cards\/\d+/.test(window.location.hash)
        || /^#\/decks\/\d+\/(?:stats|simulate)/.test(window.location.hash);
      if (stillOnDetail) window.location.hash = destination;
    }, 250);
    return;
  }
  window.location.hash = destination;
}

export function prepareCardDetailNavigation(href) {
  return saveReturnState(CARD_RETURN_PREFIX, href);
}

export function getCardReturnState(returnToken) {
  return getReturnState(CARD_RETURN_PREFIX, returnToken);
}

export function getCardReturnLabel(returnToken) {
  return sourceLabel(getCardReturnState(returnToken)?.hash || '#/collection');
}

export function returnToCardSource(returnToken) {
  returnToSource(CARD_RETURN_PREFIX, returnToken, '#/collection');
}

export function prepareDeckStatsNavigation(href) {
  return saveReturnState(DECK_STATS_RETURN_PREFIX, href);
}

export function getDeckStatsReturnLabel(returnToken) {
  const state = getReturnState(DECK_STATS_RETURN_PREFIX, returnToken);
  return state?.hash ? sourceLabel(state.hash) : 'Terug naar deck';
}

export function returnToDeckSource(returnToken, deckId) {
  returnToSource(DECK_STATS_RETURN_PREFIX, returnToken, `#/decks/${Number(deckId)}`);
}

export function preserveCurrentScrollForNextRender() {
  queueScrollRestore(
    window.location.hash || '#/dashboard',
    Math.max(0, Math.round(window.scrollY || 0))
  );
}

export function consumePendingScroll(hash) {
  const storedState = parseState(safeSessionGet(PENDING_SCROLL_KEY));
  const memoryState = parseState(pendingDiscoveryScroll);
  const state = storedState?.hash === hash ? storedState : memoryState?.hash === hash ? memoryState : null;
  if (!state) return null;
  if (storedState?.hash === hash) safeSessionRemove(PENDING_SCROLL_KEY);
  if (memoryState?.hash === hash) pendingDiscoveryScroll = null;
  const scrollY = Number(state.scrollY);
  return Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0;
}

export function prepareDiscoveryLookupNavigation(href) {
  const returnToken = token();
  const state = JSON.stringify({
    hash: /^#\/discover(?:\?|$)/.test(window.location.hash) ? window.location.hash : '#/discover',
    scrollY: Math.max(0, Math.round(window.scrollY || 0)),
    createdAt: Date.now()
  });
  discoveryReturnStates.set(returnToken, state);
  safeSessionSet(`${DISCOVERY_RETURN_PREFIX}${returnToken}`, state);
  const [path, query = ''] = String(href).split('?', 2);
  const params = new URLSearchParams(query);
  params.set('discoveryReturn', returnToken);
  return `${path}?${params.toString()}`;
}

export function getDiscoveryReturnState(returnToken) {
  if (!returnToken) return null;
  const state = parseState(safeSessionGet(`${DISCOVERY_RETURN_PREFIX}${returnToken}`))
    || parseState(discoveryReturnStates.get(returnToken));
  return state && /^#\/discover(?:\?|$)/.test(state.hash) ? state : null;
}

export function returnToDiscoverySource(returnToken) {
  const state = getDiscoveryReturnState(returnToken);
  const destination = state?.hash || '#/discover';
  const scrollY = Number.isFinite(Number(state?.scrollY)) ? Math.max(0, Number(state.scrollY)) : 0;
  pendingDiscoveryScroll = JSON.stringify({ hash: destination, scrollY, createdAt: Date.now() });
  queueScrollRestore(destination, scrollY);
  if (returnToken) {
    safeSessionRemove(`${DISCOVERY_RETURN_PREFIX}${returnToken}`);
    discoveryReturnStates.delete(returnToken);
  }
  // The lookup route can change printing/name several times. Returning directly
  // avoids relying on which intermediate route happens to be in browser history.
  window.location.hash = destination;
}


export function prepareDeckSimulatorNavigation(href) {
  return saveReturnState(DECK_STATS_RETURN_PREFIX, href);
}

export function getDeckSimulatorReturnLabel(returnToken) {
  const state = getReturnState(DECK_STATS_RETURN_PREFIX, returnToken);
  return state?.hash ? sourceLabel(state.hash) : 'Terug naar deck';
}

export function returnFromDeckSimulator(returnToken, deckId) {
  returnToSource(DECK_STATS_RETURN_PREFIX, returnToken, `#/decks/${Number(deckId)}`);
}
