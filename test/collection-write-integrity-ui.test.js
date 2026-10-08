import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addCardToCollection, addCardToWanted } from '../public/js/card-actions.js';
import { renderAddCard } from '../public/js/views/add-card.js';
import { renderCollection, renderCollectionRows } from '../public/js/views/collection.js';
import { setWriteAvailability } from '../public/js/write-access.js';
import { Element, parseHtml } from './support/dom.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const card = { id: 31, name: 'Test creature', scryfallId: 'printing-31', language: 'en',
  setCode: 'tst', setName: 'Test set', collectorNumber: '17', typeLine: 'Creature — Elf',
  rarity: 'common', finishes: ['nonfoil', 'foil'], usage: { owned: 1 } };
const printing = { ...card, cardId: card.id, printingKey: 'tst|17',
  variants: [{ language: 'en', cardId: card.id, scryfallId: card.scryfallId, finishes: ['nonfoil', 'foil'] }] };

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

function mount(t, { printings = [printing], collectionItems = [] } = {}) {
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
  globalThis.fetch = (path, options = {}) => {
    const request = { path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
    requests.push(request);
    if (request.method === 'GET' && path.startsWith('/api/read/collection')) {
      const data = path.endsWith('/options') ? { sets: [], abilities: [], decks: [] } : { items: collectionItems };
      return Promise.resolve(new Response(JSON.stringify({ data }), {
        headers: { 'content-type': 'application/json' }
      }));
    }
    if (request.method === 'GET' && path.startsWith('/api/read/cards/printings')) {
      return Promise.resolve(new Response(JSON.stringify({ data: printings }), {
        headers: { 'content-type': 'application/json' }
      }));
    }
    if (request.method === 'GET' && path.includes('/cards/preview/')) {
      return Promise.resolve(new Response(JSON.stringify({ data: card }), {
        headers: { 'content-type': 'application/json' }
      }));
    }
    return new Promise((resolve) => {
      request.resolve = (data) => resolve(new Response(JSON.stringify({ data }), {
        headers: { 'content-type': 'application/json' }
      }));
      request.fail = (message, status = 500) => resolve(new Response(JSON.stringify({ error: { message } }), {
        status, headers: { 'content-type': 'application/json' }
      }));
    });
  };
  return { document, requests, writes: () => requests.filter((request) => request.method === 'POST'),
    messages: () => document.getElementById('toast-region').textContent,
    async addPage() {
      const view = await renderAddCard({ query: new URLSearchParams('name=Test+creature') });
      document.getElementById('app').innerHTML = view.html;
      await view.mount();
      return document.getElementById('add-collection-form');
    },
    async collectionPage() {
      window.location.hash = '#/collection';
      const view = await renderCollection({ query: new URLSearchParams() });
      document.getElementById('app').innerHTML = view.html;
      view.mount();
    },
    async submit(form) { form.dispatch('submit'); await flush(); },
    async respond(request, data) { request.resolve(data); await flush(); }
  };
}

test('een lopende collectietoevoeging blijft vergrendeld bij opnieuw kiezen van dezelfde printing', async (t) => {
  const ui = mount(t);
  const form = await ui.addPage();
  form.querySelector('[name="finish"]').value = 'foil';
  await ui.submit(form);
  assert.equal(ui.writes()[0].body.finish, 'foil');
  ui.document.querySelector('.printing-card').click();
  assert.equal(form.querySelector('[type="submit"]').disabled, true);
  await ui.submit(form);
  assert.equal(ui.writes().length, 1);
  await ui.respond(ui.writes()[0], { id: 71, card });
});

test('collectietoevoeging sluit na opslaan ook wanneer het vernieuwen mislukt', async (t) => {
  const ui = mount(t);
  const dialog = await addCardToCollection(card, { onDone: () => { throw new Error('Verversen mislukt'); } });
  const form = dialog.querySelector('form');
  form.querySelector('[name="finish"]').value = 'foil';
  await ui.submit(form);
  assert.equal(ui.writes()[0].body.cardId, 31);
  assert.equal(ui.writes()[0].body.finish, 'foil');
  await ui.respond(ui.writes()[0], { id: 71, card });
  assert.equal(dialog.open, false);
  assert.match(ui.messages(), /toegevoegd.*overzicht.*vernieuwd/s);
  await ui.submit(form);
  assert.equal(ui.writes().length, 1);
});

test('Wanted-toevoeging sluit na opslaan ook wanneer het vernieuwen mislukt', async (t) => {
  const ui = mount(t);
  const dialog = addCardToWanted(card, { onDone: () => { throw new Error('Verversen mislukt'); } });
  const form = dialog.querySelector('form');
  await ui.submit(form);
  await ui.respond(ui.writes()[0], { id: 81 });
  assert.equal(dialog.open, false);
  assert.match(ui.messages(), /Wanted.*overzicht.*vernieuwd/s);
  await ui.submit(form);
  assert.equal(ui.writes().length, 1);
});

for (const page of ['kaart opzoeken', 'collectiedialoog']) {
  for (const preferredFinish of ['foil', 'nonfoil']) {
    test(`${page} bewaart expliciete ${preferredFinish}-keuze bij terugschakelen van een beperkte taalvariant`, async (t) => {
      const restrictedFinish = preferredFinish === 'foil' ? 'nonfoil' : 'foil';
      const ui = mount(t, { printings: [{ ...printing, variants: [
        ...printing.variants,
        { language: 'ja', cardId: 32, scryfallId: 'printing-32', finishes: [restrictedFinish] }
      ] }] });
      const form = page === 'kaart opzoeken' ? await ui.addPage()
        : (await addCardToCollection(card, { onDone: () => {} })).querySelector('form');
      const finish = form.querySelector('[name="finish"]');
      const language = form.querySelector('[name="language"]');
      finish.value = preferredFinish;
      finish.dispatch('change');
      language.value = 'ja';
      language.dispatch('change');
      assert.equal(finish.value, restrictedFinish, 'alleen de aangeboden afwerking is beschikbaar');
      language.value = 'en';
      language.dispatch('change');
      assert.equal(finish.value, preferredFinish, 'tijdelijke beperking mag de expliciete voorkeur niet vervangen');
      await ui.submit(form);
      assert.equal(ui.writes()[0].body.finish, preferredFinish);
      assert.equal(ui.writes()[0].body.cardId, 31);
      await ui.respond(ui.writes()[0], { id: 71, card });
    });
  }
}

test('collectie toont afwerking per fysieke collectieregel, ook bij dezelfde printing', () => {
  const items = ['foil', 'nonfoil', 'etched'].map((finish, index) => ({ id: 71 + index,
    card: { ...card, prices: { eur: '1.00', eur_foil: '2.00', eur_etched: '3.00' } },
    quantity: index + 1, finish, language: 'en', condition: 'near_mint' }));
  const document = parseHtml(renderCollectionRows(items));
  assert.deepEqual(document.querySelectorAll('.collection-card-row').map((row) => ({
    finish: row.querySelector('.collection-quantity').textContent,
    id: row.querySelector('.open-collection-card-actions').dataset.itemId
  })), [
    { finish: '1×foil', id: '71' }, { finish: '2×nonfoil', id: '72' }, { finish: '3×etched', id: '73' }
  ]);
});

for (const action of ['edit', 'remove']) {
  test(`collectie ${action} verstuurt de getoonde revisie en meldt een conflict zonder nieuw verzoek`, async (t) => {
    const item = { id: 71, revision: 'a'.repeat(64), card, quantity: 1, finish: 'nonfoil',
      language: 'en', condition: 'near_mint', location: '', notes: '' };
    const ui = mount(t, { collectionItems: [item] });
    await ui.collectionPage();
    ui.document.querySelector('.open-collection-card-actions').click();
    ui.document.querySelector(`[data-collection-card-action="${action}"]`).click();
    const form = ui.document.querySelector('dialog').querySelector('form');
    await ui.submit(form);
    const mutation = ui.requests.find((request) => request.method === (action === 'edit' ? 'PATCH' : 'DELETE'));
    assert.equal(mutation.path, '/api/write/collection/71');
    assert.equal(mutation.body.expectedRevision, item.revision);
    mutation.fail('De collectieregel is intussen gewijzigd. Vernieuw de collectie.', 409);
    await flush();
    assert.match(ui.messages(), /collectieregel is intussen gewijzigd/);
    assert.equal(ui.requests.filter((request) => ['PATCH', 'DELETE'].includes(request.method)).length, 1);
  });
}
