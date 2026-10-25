import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindCardTokens } from '../public/js/card-tokens.js';
import { renderCardDetail } from '../public/js/views/card-detail.js';
import { setWriteAvailability } from '../public/js/write-access.js';
import { Element, parseHtml } from './support/dom.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const ids = ['40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002'];
const imageUrl = (name) => `https://cards.scryfall.io/normal/front/a/b/${name}.jpg`;
const badger = () => ({
  scryfallId: ids[0], available: true, name: 'Badger', typeLine: 'Token Creature — Badger',
  manaCost: '', oracleText: '', colors: ['G'], keywords: [], power: '3', toughness: '3',
  images: { normal: imageUrl('badger') }, cardFaces: []
});
const treasure = () => ({
  scryfallId: ids[1], available: true, name: 'Treasure', typeLine: 'Token Artifact — Treasure',
  manaCost: '', oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
  colors: [], keywords: [], power: null, toughness: null,
  images: { normal: imageUrl('treasure') }, cardFaces: []
});
const parentCard = (id = 42) => ({
  id, scryfallId: `parent-${id}`, cardKey: 'oracle-parent', name: 'Greensleeves, Maro-Sorcerer',
  setName: 'Dominaria United Commander', setCode: 'dmc', collectorNumber: String(id),
  typeLine: 'Legendary Creature — Elemental Sorcerer', manaCost: '{3}{G}{G}', manaValue: 5,
  colors: ['G'], colorIdentity: ['G'], oracleText: 'Create a 3/3 green Badger creature token.',
  power: '*', toughness: '*', cardFaces: [], images: { normal: imageUrl(`parent-${id}`) },
  prices: {}, keywords: ['Landfall'], legalities: {}, language: 'en', rarity: 'mythic',
  usage: { owned: 1, needed: 1, free: 0, shortage: 0, wanted: 0, decks: [] }
});

function setup(t) {
  const keys = ['document', 'window', 'Element', 'HTMLButtonElement', 'HTMLInputElement',
    'HTMLSelectElement', 'HTMLTextAreaElement'];
  const originals = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const cleanups = [];
  t.after(() => {
    for (const cleanup of cleanups) cleanup();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const document = parseHtml('<main id="app"></main>');
  document.documentElement = document;
  document.body = document;
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.contains = (child) => {
    for (let node = child; node; node = node.parentElement) if (node === document) return true;
    return false;
  };
  globalThis.document = document;
  globalThis.window = Object.assign(new EventTarget(), { location: { hash: '#/cards/42' } });
  for (const key of keys.filter((key) => key.includes('Element'))) globalThis[key] = Element;
  const requests = [];
  let initialData;
  t.mock.method(globalThis, 'fetch', (url, options = {}) => {
    const request = { url: String(url), method: options.method || 'GET', options };
    requests.push(request);
    if (initialData && request.url === '/api/read/cards/42') return Promise.resolve(Response.json({ data: initialData.card }));
    if (initialData && request.url === '/api/read/collection/card/42') return Promise.resolve(Response.json({ data: { items: initialData.items } }));
    if (initialData && request.url.startsWith('/api/read/wanted?')) return Promise.resolve(Response.json({ data: [] }));
    return new Promise((resolve) => {
      request.respond = (data, status = 200) => resolve(Response.json(status < 400 ? { data } : { error: { message: data } }, { status }));
    });
  });
  const app = document.getElementById('app');
  function bind() {
    app.innerHTML = '<section class="card-detail-grid"><div class="card-detail-image-stack"><div class="owned-image-viewer">Parent image</div><section id="card-token-images" hidden></section></div><div><section id="card-token-info" hidden></section><section class="card-availability-panel">Beschikbaarheid</section></div></section>';
    const imageContainer = document.getElementById('card-token-images');
    const infoPanel = document.getElementById('card-token-info');
    const imageStack = document.querySelector('.card-detail-image-stack');
    const cleanup = bindCardTokens({ cardId: 42, imageContainer, infoPanel, imageStack });
    cleanups.push(cleanup);
    return { imageContainer, infoPanel, imageStack, cleanup };
  }
  return {
    document, app, requests, bind, trackCleanup: (cleanup) => cleanups.push(cleanup),
    async respond(index, data, status = 200) {
      assert.ok(requests[index]?.respond, `request ${index} must be waiting`);
      requests[index].respond(data, status);
      await flush();
    },
    navigate(hash) { window.location.hash = hash; window.dispatchEvent(new Event('hashchange')); },
    async cardView(items = []) {
      initialData = { card: parentCard(), items };
      const view = await renderCardDetail({ params: { id: '42' }, query: new URLSearchParams() });
      app.innerHTML = view.html;
      return view;
    }
  };
}

test('cards without token references hide both token sections and only issue a read request', async (t) => {
  const ui = setup(t);
  const { imageContainer, infoPanel, imageStack } = ui.bind();
  assert.equal(ui.requests[0].url, '/api/read/cards/42/tokens');
  await ui.respond(0, []);
  assert.equal(imageContainer.hidden, true);
  assert.equal(infoPanel.hidden, true);
  assert.equal(imageStack.classList.contains('card-detail-has-tokens'), false);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
});

test('multiple tokens show their own colors, creature stats, readable rules and cached images in read-only mode', async (t) => {
  const ui = setup(t);
  setWriteAvailability(false);
  const { imageContainer, infoPanel, imageStack } = ui.bind();
  await ui.respond(0, [badger(), treasure()]);
  assert.equal(imageContainer.hidden, false);
  assert.equal(infoPanel.hidden, false);
  assert.equal(imageStack.classList.contains('card-detail-has-tokens'), true);
  const articles = infoPanel.querySelectorAll('[data-token-id]');
  assert.equal(articles.length, 2);
  assert.match(articles[0].textContent, /Badger/);
  assert.match(articles[0].textContent, /Groen/);
  assert.match(articles[0].textContent, /3\s*\/\s*3/);
  assert.match(articles[1].textContent, /Kleurloos/);
  assert.doesNotMatch(articles[1].textContent, /null|undefined|0\s*\/\s*0/);
  assert.ok(articles[1].querySelector('.mana-symbol'), 'token rules render the tap symbol');
  const images = imageContainer.querySelectorAll('[data-token-image]');
  assert.equal(images.length, 2);
  assert.deepEqual(images.map((image) => new URL(image.getAttribute('src'), 'http://local').searchParams.get('url')), [imageUrl('badger'), imageUrl('treasure')]);
  assert.ok(images.every((image) => image.getAttribute('src').startsWith('/api/read/cards/image-cache?')));
  assert.equal(infoPanel.querySelector('[data-write-action]'), null);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
});

test('double-faced token details and images keep each face’s own characteristics', async (t) => {
  const ui = setup(t);
  const { imageContainer, infoPanel } = ui.bind();
  const double = {
    ...badger(), name: 'Badger // Spirit', images: { normal: imageUrl('badger'), backNormal: imageUrl('spirit') },
    cardFaces: [
      { name: 'Badger', type_line: 'Token Creature — Badger', oracle_text: '', colors: ['G'], power: '3', toughness: '3', image_uris: { normal: imageUrl('badger') } },
      { name: 'Spirit', type_line: 'Token Creature — Spirit', oracle_text: 'Flying', colors: ['W'], keywords: ['Flying'], power: '1', toughness: '1', image_uris: { normal: imageUrl('spirit') } }
    ]
  };
  await ui.respond(0, [double]);
  assert.equal(imageContainer.querySelectorAll('[data-token-image]').length, 2);
  assert.match(infoPanel.textContent, /Badger/);
  assert.match(infoPanel.textContent, /Spirit/);
  assert.match(infoPanel.textContent, /Groen/);
  assert.match(infoPanel.textContent, /Wit/);
  assert.match(infoPanel.textContent, /3\s*\/\s*3/);
  assert.match(infoPanel.textContent, /1\s*\/\s*1/);
  assert.ok(infoPanel.querySelector('.oracle-keyword'));
});

test('one unavailable token leaves other tokens visible and can be retried without writes', async (t) => {
  const ui = setup(t);
  const { imageContainer, infoPanel } = ui.bind();
  await ui.respond(0, [badger(), { scryfallId: ids[1], available: false, name: 'Treasure', typeLine: 'Token Artifact — Treasure', error: 'Token tijdelijk niet beschikbaar.' }]);
  assert.match(infoPanel.textContent, /Token tijdelijk niet beschikbaar/);
  assert.equal(imageContainer.querySelectorAll('[data-token-image]').length, 1);
  const retry = infoPanel.querySelector('[data-token-retry]');
  assert.equal(retry.hidden, false);
  retry.click();
  await ui.respond(1, [badger(), treasure()]);
  assert.equal(imageContainer.querySelectorAll('[data-token-image]').length, 2);
  assert.equal(infoPanel.querySelector('[data-token-retry]').hidden, true);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
});

test('a failed token request leaves the card content intact and retry may resolve to no tokens', async (t) => {
  const ui = setup(t);
  const { imageContainer, infoPanel } = ui.bind();
  await ui.respond(0, 'Scryfall tijdelijk niet bereikbaar.', 503);
  assert.match(infoPanel.textContent, /Scryfall tijdelijk niet bereikbaar/);
  assert.match(ui.document.querySelector('.owned-image-viewer').textContent, /Parent image/);
  assert.match(ui.document.querySelector('.card-availability-panel').textContent, /Beschikbaarheid/);
  infoPanel.querySelector('[data-token-retry]').click();
  await ui.respond(1, []);
  assert.equal(imageContainer.hidden, true);
  assert.equal(infoPanel.hidden, true);
});

test('token names and text cannot inject markup and missing images show a readable fallback', async (t) => {
  const ui = setup(t);
  const { imageContainer, infoPanel } = ui.bind();
  await ui.respond(0, [{ ...badger(), name: '<img src=x onerror=alert(1)>', oracleText: '<script>bad()</script>', images: {} }]);
  assert.equal(infoPanel.querySelector('img'), null);
  assert.equal(infoPanel.querySelector('script'), null);
  assert.match(infoPanel.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(infoPanel.textContent, /<script>bad\(\)<\/script>/);
  assert.equal(imageContainer.querySelector('[data-token-image]'), null);
  assert.match(imageContainer.textContent, /afbeelding/i);
});

test('navigation aborts token loading and an answer arriving afterwards cannot replace another page', async (t) => {
  const ui = setup(t);
  ui.bind();
  ui.navigate('#/cards/99');
  assert.equal(ui.requests[0].options.signal.aborted, true);
  ui.app.innerHTML = '<section id="card-token-images">New card images</section><section id="card-token-info">New card information</section>';
  await ui.respond(0, [badger()]);
  assert.equal(ui.document.getElementById('card-token-images').textContent, 'New card images');
  assert.equal(ui.document.getElementById('card-token-info').textContent, 'New card information');
});

test('an image download failure keeps token information visible and retry replaces the failed image', async (t) => {
  const ui = setup(t);
  const { imageContainer, infoPanel } = ui.bind();
  await ui.respond(0, [badger()]);
  const failedImage = imageContainer.querySelector('[data-token-image]');
  failedImage.dispatch('error');
  assert.equal(failedImage.hidden, true);
  assert.equal(imageContainer.querySelector('[data-token-image-error]').hidden, false);
  assert.match(infoPanel.textContent, /Groen/);
  const retry = infoPanel.querySelector('[data-token-retry]');
  assert.equal(retry.hidden, false);
  retry.click();
  await ui.respond(1, [badger()]);
  const replacement = imageContainer.querySelector('[data-token-image]');
  assert.notEqual(replacement, failedImage);
  assert.equal(replacement.hidden, false);
  assert.equal(retry.hidden, true);
  failedImage.dispatch('error');
  assert.equal(replacement.hidden, false);
  assert.equal(retry.hidden, true, 'a late event from the replaced image must be ignored');
});

test('explicit cleanup rejects late responses even when the hash stays unchanged', async (t) => {
  const ui = setup(t);
  const { cleanup, imageContainer, infoPanel } = ui.bind();
  cleanup();
  assert.equal(ui.requests[0].options.signal.aborted, true);
  const originalImageHtml = imageContainer.innerHTML;
  const originalInfoHtml = infoPanel.innerHTML;
  await ui.respond(0, [badger()]);
  assert.equal(imageContainer.innerHTML, originalImageHtml);
  assert.equal(infoPanel.innerHTML, originalInfoHtml);
});

test('card detail places token images below the main viewer and token information before availability without delaying the base view', async (t) => {
  const ui = setup(t);
  const other = parentCard(43);
  const view = await ui.cardView([{ card: other, quantity: 1, finish: 'foil', language: 'en', condition: 'near_mint' }]);
  assert.equal(ui.requests.some((request) => request.url.endsWith('/tokens')), false);
  const mainViewer = ui.document.querySelector('.owned-image-viewer');
  const imageContainer = ui.document.getElementById('card-token-images');
  const infoPanel = ui.document.getElementById('card-token-info');
  const availability = ui.document.querySelector('.card-availability-panel');
  assert.ok(mainViewer.parentElement.children.indexOf(mainViewer) < mainViewer.parentElement.children.indexOf(imageContainer));
  assert.equal(infoPanel.parentElement, availability.parentElement);
  assert.ok(infoPanel.parentElement.children.indexOf(infoPanel) < infoPanel.parentElement.children.indexOf(availability));
  const cleanup = view.mount();
  ui.trackCleanup(cleanup);
  const tokenIndex = ui.requests.findIndex((request) => request.url.endsWith('/tokens'));
  assert.ok(tokenIndex >= 0);
  assert.match(availability.textContent, /Beschikbaarheid/);
  const choices = ui.document.querySelectorAll('[data-owned-image-index]');
  assert.equal(choices.length, 2);
  choices[1].click();
  const slides = ui.document.querySelectorAll('[data-owned-image-slide]');
  assert.equal(slides[0].hidden, true);
  assert.equal(slides[1].hidden, false);
  await ui.respond(tokenIndex, [badger()]);
  assert.equal(slides[1].hidden, false, 'token loading cannot change the selected parent printing');
  assert.match(infoPanel.textContent, /Badger/);
});
