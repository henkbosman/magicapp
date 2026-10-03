import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumePendingScroll, getDiscoveryReturnState, prepareDiscoveryLookupNavigation,
  returnToDiscoverySource } from '../public/js/navigation-state.js';

test('ontdekkingsretour bewaart exacte filters, paginering en scroll zonder history.back', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => original ? Object.defineProperty(globalThis, 'window', original) : delete globalThis.window);
  const source = '#/discover?ability=Landfall&text=2%2F2&colorIdentity=G&page=3';
  const storage = new Map();
  globalThis.window = {
    location: { hash: source }, scrollY: 1437,
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key) },
    history: { back() { assert.fail('Terug moet rechtstreeks naar de opgeslagen hash gaan'); } }
  };
  const href = prepareDiscoveryLookupNavigation('#/add?name=Path+to+the+World+Tree');
  const params = new URLSearchParams(href.split('?')[1]);
  assert.equal(params.get('name'), 'Path to the World Tree');
  const token = params.get('discoveryReturn');
  assert.equal(getDiscoveryReturnState(token).hash, source);
  window.location.hash = `${href}&printing=another`;
  returnToDiscoverySource(token);
  assert.equal(window.location.hash, source);
  assert.equal(consumePendingScroll('#/other'), null);
  assert.equal(consumePendingScroll(source), 1437);
  assert.equal(consumePendingScroll(source), null);
  assert.equal(getDiscoveryReturnState(token), null);
});

test('ontdekkingsretour werkt ook wanneer sessionStorage niet beschikbaar is', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => original ? Object.defineProperty(globalThis, 'window', original) : delete globalThis.window);
  const source = '#/discover?type=Creature&keyword=Trample';
  globalThis.window = { location: { hash: source }, scrollY: 764,
    get sessionStorage() { throw new Error('Storage disabled'); } };
  const href = prepareDiscoveryLookupNavigation('#/add?name=Test');
  const token = new URLSearchParams(href.split('?')[1]).get('discoveryReturn');
  window.location.hash = href;
  returnToDiscoverySource(token);
  assert.equal(window.location.hash, source);
  assert.equal(consumePendingScroll(source), 764);
});

test('oude scrollopslag blokkeert de geheugenfallback niet als nieuwe opslag door quota mislukt', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => original ? Object.defineProperty(globalThis, 'window', original) : delete globalThis.window);
  const source = '#/discover?type=Instant';
  globalThis.window = { location: { hash: source }, scrollY: 512,
    sessionStorage: {
      getItem: (key) => key.endsWith('pending-scroll')
        ? JSON.stringify({ hash: '#/collection', scrollY: 99, createdAt: Date.now() }) : null,
      setItem() { throw new Error('Quota exceeded'); },
      removeItem() {}
    } };
  const href = prepareDiscoveryLookupNavigation('#/add?name=Test');
  const token = new URLSearchParams(href.split('?')[1]).get('discoveryReturn');
  window.location.hash = href;
  returnToDiscoverySource(token);
  assert.equal(window.location.hash, source);
  assert.equal(consumePendingScroll(source), 512);
});
