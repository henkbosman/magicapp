import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDeckRevision, startDeckLiveRefresh } from '../public/js/deck-live-refresh.js';

const firstRevision = 'a'.repeat(64);
const nextRevision = 'b'.repeat(64);
const flush = () => new Promise((resolve) => setImmediate(resolve));

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type) { for (const listener of [...(listeners.get(type) || [])]) listener({ type }); }
  };
}

function setup(t) {
  const originals = ['document', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const stops = [];
  t.after(() => {
    stops.forEach((stop) => stop());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const window = { ...eventTarget(), location: { hash: '#/decks/7?cardGroup=tags&view=list' } };
  const document = {
    ...eventTarget(), hidden: false, activeElement: null, modalOpen: false,
    querySelector() { return this.modalOpen ? {} : null; }
  };
  globalThis.window = window;
  globalThis.document = document;
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, options) => {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    options.signal.addEventListener('abort', abort, { once: true });
    requests.push({ url, options, resolve, reject });
    return promise.finally(() => options.signal.removeEventListener('abort', abort));
  });
  const state = { refreshes: 0 };
  const start = (options = {}) => {
    const stop = startDeckLiveRefresh({ deckId: 7, initialRevision: firstRevision,
      onChange() { state.refreshes++; }, ...options });
    stops.push(stop);
    return stop;
  };
  return {
    window, document, requests, state, start,
    async tick(ms) { t.mock.timers.tick(ms); await flush(); },
    async respond(index, revision, status = 200) {
      requests[index].resolve(Response.json(status === 200 ? { data: { revision } } : { error: { message: 'Failed' } }, { status }));
      await flush();
    }
  };
}

test('revision baseline read is safe for old backends, invalid results and temporary failure', async (t) => {
  const ui = setup(t);
  const initial = readDeckRevision(7);
  assert.equal(ui.requests[0].url, '/api/read/decks/7/revision');
  assert.equal(ui.requests[0].options.method, 'GET');
  assert.equal(ui.requests[0].options.headers['Cache-Control'], 'no-cache');
  await ui.respond(0, firstRevision);
  assert.equal(await initial, firstRevision);
  const oldBackend = readDeckRevision(7);
  await ui.respond(1, null, 404);
  assert.equal(await oldBackend, null);
  const invalid = readDeckRevision(7);
  await ui.respond(2, 'unexpected');
  assert.equal(await invalid, null);
  const unavailable = readDeckRevision(7);
  ui.requests[3].reject(new Error('offline'));
  assert.equal(await unavailable, null);
  assert.equal(await readDeckRevision('invalid'), null);
  assert.equal(ui.requests.length, 4);
});

test('polling refreshes changed decks once, keeps unchanged pages and never overlaps requests', async (t) => {
  const ui = setup(t);
  ui.start();
  await ui.tick(4999);
  assert.equal(ui.requests.length, 0);
  await ui.tick(1);
  assert.equal(ui.requests.length, 1);
  ui.window.dispatch('focus');
  ui.document.dispatch('focusout');
  await ui.tick(250);
  assert.equal(ui.requests.length, 1);
  await ui.respond(0, firstRevision);
  assert.equal(ui.state.refreshes, 0);
  await ui.tick(5000);
  await ui.respond(1, nextRevision);
  assert.equal(ui.state.refreshes, 1);
  assert.equal(ui.window.location.hash, '#/decks/7?cardGroup=tags&view=list');
  await ui.tick(5000);
  await ui.respond(2, nextRevision);
  assert.equal(ui.state.refreshes, 1);
});

test('initial revision detects changes during initial page load and unknown baselines refresh conservatively', async (t) => {
  const ui = setup(t);
  let stop = ui.start();
  await ui.tick(5000);
  await ui.respond(0, nextRevision);
  assert.equal(ui.state.refreshes, 1, 'baseline from before rendering must not be overwritten by the first poll');
  stop();
  stop = ui.start({ initialRevision: null });
  await ui.tick(5000);
  await ui.respond(1, nextRevision);
  assert.equal(ui.state.refreshes, 2, 'a failed initial read cannot silently bless a possibly stale page');
  stop();
});

test('open dialogs and focused inputs defer a known change without losing it', async (t) => {
  const ui = setup(t);
  ui.start();
  await ui.tick(5000);
  ui.document.modalOpen = true;
  await ui.respond(0, nextRevision);
  assert.equal(ui.state.refreshes, 0);
  await ui.tick(5000);
  assert.equal(ui.requests.length, 1);
  ui.document.modalOpen = false;
  ui.document.activeElement = { tagName: 'SELECT' };
  ui.document.dispatch('close');
  await ui.tick(250);
  assert.equal(ui.state.refreshes, 0);
  ui.document.activeElement = { tagName: 'INPUT' };
  await ui.tick(5000);
  assert.equal(ui.state.refreshes, 0);
  ui.document.activeElement = null;
  ui.document.dispatch('focusout');
  await ui.tick(250);
  assert.equal(ui.state.refreshes, 1);
  assert.equal(ui.requests.length, 1, 'known pending change needs no second read');
});

test('hidden pages stop polling and check promptly when visible or focused again', async (t) => {
  const ui = setup(t);
  ui.document.hidden = true;
  ui.start();
  await ui.tick(20000);
  assert.equal(ui.requests.length, 0);
  ui.document.hidden = false;
  ui.document.dispatch('visibilitychange');
  await ui.tick(0);
  assert.equal(ui.requests.length, 1);
  ui.document.hidden = true;
  ui.document.dispatch('visibilitychange');
  await ui.respond(0, nextRevision);
  assert.equal(ui.state.refreshes, 0);
  await ui.tick(20000);
  assert.equal(ui.requests.length, 1);
  ui.document.hidden = false;
  ui.window.dispatch('focus');
  await ui.tick(0);
  assert.equal(ui.state.refreshes, 1);
});

test('network failures and timeouts retry quietly while unsupported endpoints stop', async (t) => {
  const ui = setup(t);
  ui.start();
  await ui.tick(5000);
  await ui.respond(0, null, 503);
  assert.equal(ui.state.refreshes, 0);
  await ui.tick(5000);
  await ui.tick(5000);
  assert.equal(ui.requests[1].options.signal.aborted, true);
  await ui.tick(5000);
  await ui.respond(2, nextRevision);
  assert.equal(ui.state.refreshes, 1);
  await ui.tick(5000);
  await ui.respond(3, null, 404);
  await ui.tick(30000);
  assert.equal(ui.requests.length, 4);
});

test('cleanup and navigation abort pending work and do not refresh a different deck', async (t) => {
  const ui = setup(t);
  const stop = ui.start();
  await ui.tick(5000);
  stop();
  stop();
  assert.equal(ui.requests[0].options.signal.aborted, true);
  await ui.tick(20000);
  assert.equal(ui.state.refreshes, 0);
  assert.equal(ui.requests.length, 1);
  assert.ok([...ui.window.listeners.values(), ...ui.document.listeners.values()].every((listeners) => !listeners.size));

  ui.start();
  await ui.tick(5000);
  ui.window.location.hash = '#/decks/8';
  await ui.respond(1, nextRevision);
  assert.equal(ui.state.refreshes, 0);
  await ui.tick(5000);
  assert.equal(ui.requests.length, 2);
});

test('explicit page refresh stops the old poller and failed refresh callbacks retain the change', async (t) => {
  const ui = setup(t);
  let attempts = 0;
  ui.start({ onChange() { attempts++; if (attempts === 1) throw new Error('temporary refresh failure'); } });
  await ui.tick(5000);
  await ui.respond(0, nextRevision);
  assert.equal(attempts, 1);
  await ui.tick(5000);
  assert.equal(attempts, 2);
  ui.window.dispatch('app:refresh');
  await ui.tick(20000);
  assert.equal(ui.requests.length, 1);
});
