import { api } from './api.js';

const POLL_INTERVAL = 5000;
const REQUEST_TIMEOUT = 5000;

function validRevision(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value : null;
}

async function fetchDeckRevision(deckId, { signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, REQUEST_TIMEOUT);
  try {
    const result = await api(`/decks/${deckId}/revision`, {
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' }
    });
    return validRevision(result?.revision);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

// Sample before fetching the page content. Failure must not prevent opening a
// deck on an older backend or during a temporary connection problem.
export async function readDeckRevision(deckId) {
  const id = Number(deckId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  try {
    return await fetchDeckRevision(id);
  } catch {
    return null;
  }
}

export function startDeckLiveRefresh({ deckId, initialRevision, onChange } = {}) {
  const id = Number(deckId);
  if (!Number.isSafeInteger(id) || id < 1 || typeof onChange !== 'function') return () => {};
  let revision = validRevision(initialRevision);
  let pendingRevision = null;
  let timer = null;
  let request = null;
  let refreshing = false;
  let stopped = false;

  const isCurrentDeck = () => window.location.hash.split('?')[0] === `#/decks/${id}`;
  const isBusy = () => Boolean(document.querySelector('dialog[open], .deck-card-context-menu'))
    || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)
    || Boolean(document.activeElement?.isContentEditable);

  function schedule(delay = POLL_INTERVAL) {
    clearTimeout(timer);
    timer = null;
    if (!stopped && !document.hidden) timer = setTimeout(check, delay);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    timer = null;
    request?.abort();
    window.removeEventListener('hashchange', stop);
    window.removeEventListener('app:refresh', stop);
    window.removeEventListener('focus', wake);
    document.removeEventListener('visibilitychange', visibilityChanged);
    document.removeEventListener('focusout', afterInteraction);
    document.removeEventListener('close', afterInteraction, true);
  }

  async function refreshIfReady() {
    if (!pendingRevision || stopped || !isCurrentDeck() || document.hidden || isBusy()) return;
    const nextRevision = pendingRevision;
    refreshing = true;
    try {
      await onChange();
      revision = nextRevision;
      pendingRevision = null;
    } catch {
      // Keep the change pending. A temporary refresh failure should neither
      // interrupt editing nor forget that the displayed deck is out of date.
    } finally {
      refreshing = false;
    }
  }

  async function check() {
    timer = null;
    if (stopped) return;
    if (!isCurrentDeck()) { stop(); return; }
    if (document.hidden) return;
    if (request || refreshing) return;
    if (isBusy()) { schedule(); return; }
    if (pendingRevision) {
      await refreshIfReady();
      schedule();
      return;
    }
    const controller = new AbortController();
    request = controller;
    try {
      const nextRevision = await fetchDeckRevision(id, { signal: controller.signal });
      if (stopped || !isCurrentDeck()) return;
      if (!nextRevision) { stop(); return; }
      if (nextRevision !== revision) {
        pendingRevision = nextRevision;
        await refreshIfReady();
      }
    } catch (error) {
      // An unavailable endpoint cannot support live updates until a reload.
      // Other failures, including network interruptions, are retried quietly.
      if ([401, 403, 404, 405, 501].includes(error?.status)) stop();
    } finally {
      if (request === controller) request = null;
      schedule();
    }
  }

  function wake() {
    if (!isCurrentDeck()) { stop(); return; }
    if (!request && !refreshing) schedule(0);
  }

  function afterInteraction() {
    // Let the click following focusout finish first: it may open a dialog.
    if (!request && !refreshing) schedule(250);
  }

  function visibilityChanged() {
    if (document.hidden) {
      clearTimeout(timer);
      timer = null;
    } else wake();
  }

  window.addEventListener('hashchange', stop);
  window.addEventListener('app:refresh', stop);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', visibilityChanged);
  document.addEventListener('focusout', afterInteraction);
  document.addEventListener('close', afterInteraction, true);
  schedule();
  return stop;
}
