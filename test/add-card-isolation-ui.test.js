import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addCardToCollection, addCardToDeck, addCardToWanted } from '../public/js/card-actions.js';
import { renderAddCard } from '../public/js/views/add-card.js';
import { setWriteAvailability } from '../public/js/write-access.js';
import { Element, parseHtml } from './support/dom.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const card = (id, name = `Card ${id}`, language = 'en') => ({
  id, name, scryfallId: `printing-${id}`, language, setCode: 'tst', setName: 'Test set',
  collectorNumber: String(id), typeLine: 'Creature — Elf', finishes: ['nonfoil', 'foil'], usage: { owned: id }
});
const printing = (entry, variants = false) => ({
  ...entry, cardId: entry.id, printingKey: `tst|${entry.collectorNumber}`,
  ...(variants ? { variants: [{ language: entry.language, cardId: entry.id,
    scryfallId: entry.scryfallId, finishes: entry.finishes }] } : {})
});

class FormValues {
  constructor(form) {
    this.values = form.elements.filter((control) => control.name && !control.disabled
      && (!['checkbox', 'radio'].includes(control.type) || control.checked))
      .map((control) => [control.name, control.value]);
  }
  get(name) { return this.values.find(([key]) => key === name)?.[1] ?? null; }
  has(name) { return this.values.some(([key]) => key === name); }
  entries() { return this.values[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
}

function setup(t) {
  const keys = ['fetch', 'document', 'window', 'FormData', 'requestAnimationFrame', 'Element',
    'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement'];
  const original = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const append = function (child) { child.parentElement = this; this.children.push(child); };
  const document = parseHtml('<div id="app"></div><div id="toast-region"></div>');
  document.documentElement = document;
  document.body = document;
  document.append = append;
  document.contains = (child) => {
    for (let node = child; node; node = node.parentElement) if (node === document) return true;
    return false;
  };
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.getElementById('toast-region').append = append;
  document.createElement = (tag) => {
    const element = new Element(tag);
    element.append = append;
    element.remove = () => {
      if (element.parentElement) {
        element.parentElement.children = element.parentElement.children.filter((child) => child !== element);
        element.parentElement = null;
      }
    };
    element.showModal = () => { element.open = true; };
    element.close = () => { element.open = false; element.dispatch('close'); };
    return element;
  };
  globalThis.document = document;
  globalThis.window = { location: { hash: '#/add' },
    history: { replaceState: (_state, _title, hash) => { window.location.hash = hash; } },
    setTimeout, requestAnimationFrame: () => {} };
  globalThis.FormData = FormValues;
  globalThis.requestAnimationFrame = () => {};
  for (const key of keys.filter((key) => key.includes('Element'))) globalThis[key] = Element;
  setWriteAvailability(true);
  const requests = [];
  globalThis.fetch = (path, options = {}) => new Promise((resolve) => {
    const request = { path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
    requests.push(request);
    request.resolve = (data) => {
      request.settled = true;
      resolve(new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } }));
    };
  });
  const respond = async (request, data) => { assert.ok(request, 'expected pending request'); request.resolve(data); await flush(); };
  const next = (suffix) => requests.find((request) => !request.settled && request.path.includes(suffix));
  return {
    document, requests, respond, next,
    get: (id) => document.getElementById(id),
    writes: () => requests.filter((request) => request.method === 'POST'),
    async mount() {
      const view = await renderAddCard({ query: new URLSearchParams() });
      document.getElementById('app').innerHTML = view.html;
      await view.mount();
    },
    async select(entry, entryPrinting = printing(entry)) {
      const search = document.getElementById('add-card-search');
      search.value = entry.name;
      search.dispatch('input');
      search.dispatch('keydown', { key: 'Enter' });
      await flush();
      await respond(next('/cards/printings'), [entryPrinting]);
      await respond(next(`/cards/preview/${entry.scryfallId}`), entry);
      return document.getElementById('add-collection-form');
    },
    async submit(form) { form.dispatch('submit'); await flush(); }
  };
}

for (const action of ['collection', 'wanted', 'collection-deck']) {
  test(`a late usage response for A cannot change the ${action} target after selecting B`, async (t) => {
    const ui = setup(t);
    await ui.mount();
    const original = card(31, 'Original card');
    const current = card(42, 'Current card');
    const originalForm = await ui.select(original);
    await ui.submit(originalForm);
    await ui.respond(ui.next('/api/write/collection'), { id: 71 });
    const staleRefresh = ui.next('/cards/31');
    assert.ok(staleRefresh, 'a response without embedded card refreshes the original card');
    const form = await ui.select(current);
    form.querySelector('[name="finish"]').value = 'foil';
    form.querySelector('[name="quantity"]').value = '3';
    await ui.respond(staleRefresh, original);
    assert.equal(ui.document.querySelector('[data-card-detail-link]').getAttribute('href'), '#/cards/42');
    assert.match(ui.get('selected-card-panel').textContent, /Current card/);
    if (action === 'collection') await ui.submit(form);
    else if (action === 'wanted') {
      ui.get('selected-to-wanted').click();
      assert.match(ui.document.querySelector('dialog').textContent, /Current card/);
      await ui.submit(ui.document.querySelector('dialog').querySelector('form'));
    } else {
      ui.get('selected-to-collection-deck').click();
      await ui.respond(ui.next('/decks'), [{ id: 7, name: 'Test deck' }]);
      assert.match(ui.document.querySelector('dialog').textContent, /Current card/);
      await ui.submit(ui.document.querySelector('dialog').querySelector('form'));
    }
    const write = ui.writes().at(-1);
    assert.equal(write.body.cardId, current.id);
    assert.equal(write.body.scryfallId, current.scryfallId);
    assert.equal(write.body.quantity, 3);
    if (action !== 'wanted') assert.equal(write.body.finish, 'foil');
  });
}

test('detached actions from an old card form cannot submit data for the new selection', async (t) => {
  const ui = setup(t);
  await ui.mount();
  const oldForm = await ui.select(card(31));
  const oldWanted = ui.get('selected-to-wanted');
  const oldDeck = ui.get('selected-to-collection-deck');
  await ui.select(card(42));
  await ui.submit(oldForm);
  oldWanted.click();
  oldDeck.click();
  await flush();
  assert.equal(ui.writes().length, 0);
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.equal(ui.next('/decks'), undefined);
});

test('a delayed language preview cannot replace a later card selection', async (t) => {
  const ui = setup(t);
  await ui.mount();
  const original = card(31);
  const otherLanguage = card(32, original.name, 'ja');
  const originalPrinting = printing(original, true);
  originalPrinting.variants.push({ language: 'ja', scryfallId: otherLanguage.scryfallId, finishes: ['foil'] });
  const oldForm = await ui.select(original, originalPrinting);
  oldForm.querySelector('[name="language"]').value = 'ja';
  oldForm.querySelector('[name="language"]').dispatch('change');
  const stalePreview = ui.next('/preview/printing-32');
  const form = await ui.select(card(42));
  await ui.respond(stalePreview, otherLanguage);
  await ui.submit(form);
  assert.equal(ui.writes()[0].body.cardId, 42);
  assert.equal(ui.writes()[0].body.scryfallId, 'printing-42');
});

for (const action of ['collection', 'wanted', 'deck']) {
  test(`the shared ${action} dialog sends both the local and external printing identity`, async (t) => {
    const ui = setup(t);
    const target = card(31);
    let dialog;
    if (action === 'collection') {
      const opened = addCardToCollection(target, { onDone: () => {} });
      await ui.respond(ui.next('/cards/printings'), [printing(target, true)]);
      dialog = await opened;
    } else if (action === 'deck') {
      const opened = addCardToDeck(target, { onDone: () => {} });
      await ui.respond(ui.next('/decks'), [{ id: 7, name: 'Test deck' }]);
      dialog = await opened;
    } else dialog = addCardToWanted(target, { onDone: () => {} });
    await ui.submit(dialog.querySelector('form'));
    assert.equal(ui.writes()[0].body.cardId, 31);
    assert.equal(ui.writes()[0].body.scryfallId, 'printing-31');
  });
}
