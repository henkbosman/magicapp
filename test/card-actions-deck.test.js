import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addCardToDeck } from '../public/js/card-actions.js';
import { applyWriteAvailability, setWriteAvailability } from '../public/js/write-access.js';
import { Element, parseHtml } from './support/dom.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const decks = [{ id: 1, name: 'First deck' }, { id: 2, name: 'Yedora & friends' }];
const catalogCard = { catalogId: 'oracle:elves:0', name: 'Llanowar Elves', typeLine: 'Creature — Elf Druid',
  scryfallOracleId: 'a0000000-0000-4000-8000-000000000001' };
const response = (data, status = 200) => new Response(JSON.stringify({ data }), {
  status, headers: { 'content-type': 'application/json' }
});

class FormValues {
  constructor(form) {
    this.values = form.elements.filter((control) => control.name && !control.disabled
      && (!['checkbox', 'radio'].includes(control.type) || control.checked))
      .map((control) => [control.name, control.value]);
  }
  get(name) { return this.values.find(([key]) => key === name)?.[1] ?? null; }
  has(name) { return this.values.some(([key]) => key === name); }
}

function mount(t, { available = true, availableDecks = decks } = {}) {
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
  const document = parseHtml('<div id="toast-region"></div>');
  document.documentElement = document;
  document.body = document;
  document.append = append;
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
  globalThis.window = { location: { hash: '#/discover' } };
  globalThis.FormData = FormValues;
  globalThis.requestAnimationFrame = (callback) => callback();
  for (const key of keys.filter((key) => key.includes('Element'))) globalThis[key] = Element;
  setWriteAvailability(available);

  const requests = [];
  globalThis.fetch = (path, options = {}) => {
    const request = { path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
    requests.push(request);
    if (request.method === 'GET' && path === '/api/read/decks') return Promise.resolve(response(availableDecks));
    return new Promise((resolve) => {
      request.resolve = (data) => resolve(response(data));
      request.fail = (message = 'Test failure', status = 500) => resolve(new Response(JSON.stringify({ error: { message } }), {
        status, headers: { 'content-type': 'application/json' }
      }));
    });
  };
  return {
    document, requests,
    writes: () => requests.filter((request) => request.method === 'POST'),
    messages: () => document.getElementById('toast-region').textContent,
    async open(card = catalogCard, options = {}) {
      const dialog = await addCardToDeck(card, { onDone: () => {}, ...options });
      if (dialog) applyWriteAvailability(dialog); // The app's MutationObserver does this for new dialogs.
      return dialog;
    },
    async submit(dialog) { dialog.querySelector('form').dispatch('submit'); await flush(); },
    async respond(request, data) { request.resolve(data); await flush(); }
  };
}

test('cataloguskaart opent de gewone deckdialoog en schrijft pas na bevestigen op naam', async (t) => {
  const ui = mount(t);
  let completed = 0;
  const dialog = await ui.open({ ...catalogCard, id: 91, scryfallId: 'unrelated-printing' }, {
    deckId: 2, onDone: () => { completed += 1; }
  });
  assert.equal(dialog.open, true);
  assert.equal(ui.writes().length, 0);
  assert.equal(dialog.querySelector('[name="deckId"]').value, '2');
  assert.equal(dialog.querySelector('[name="addMissingWanted"]').checked, false);
  assert.equal(dialog.querySelector('[name="role"]').value, 'main');
  dialog.querySelector('[name="quantity"]').value = '3';
  dialog.querySelector('[name="tags"]').value = 'Ramp, Draw, Ramp';
  dialog.querySelector('[name="note"]').value = 'Interesting card';
  await ui.submit(dialog);
  assert.equal(ui.writes()[0].path, '/api/write/decks/2/cards');
  assert.deepEqual(ui.writes()[0].body, {
    name: catalogCard.name, expectedOracleId: catalogCard.scryfallOracleId,
    quantity: 3, role: 'main', tags: ['Ramp', 'Draw'], note: 'Interesting card'
  });
  await ui.respond(ui.writes()[0], { card: { id: 701, usage: { shortage: 3, wanted: 0 } } });
  assert.equal(dialog.open, false);
  assert.equal(completed, 1);
  assert.equal(ui.writes().length, 1);
});

test('bestaande collectiekaart behoudt zijn lokale printingnummer', async (t) => {
  const ui = mount(t);
  const dialog = await ui.open({ id: 91, name: 'Llanowar Elves', scryfallId: 'specific-printing' });
  await ui.submit(dialog);
  assert.equal(ui.writes()[0].body.cardId, 91);
  assert.equal(Object.hasOwn(ui.writes()[0].body, 'name'), false);
  await ui.respond(ui.writes()[0], { card: { id: 91 } });
  assert.equal(dialog.open, false);
});

test('optioneel Wanted gebruikt het teruggegeven lokale kaartnummer en alleen het tekort', async (t) => {
  const ui = mount(t);
  const dialog = await ui.open();
  dialog.querySelector('[name="quantity"]').value = '4';
  dialog.querySelector('[name="addMissingWanted"]').checked = true;
  await ui.submit(dialog);
  await ui.respond(ui.writes()[0], { card: { id: 701, usage: { shortage: 5, wanted: 2 } } });
  assert.equal(ui.writes()[1].path, '/api/write/wanted');
  assert.equal(ui.writes()[1].body.cardId, 701);
  assert.equal(ui.writes()[1].body.quantity, 3);
  assert.equal(ui.writes()[1].body.deckId, 1);
  await ui.respond(ui.writes()[1], { id: 81 });
  assert.equal(dialog.open, false);
});

test('Annuleren veroorzaakt geen schrijfactie', async (t) => {
  const ui = mount(t);
  const dialog = await ui.open();
  dialog.querySelector('.close-dialog').dispatch('click');
  assert.equal(dialog.open, false);
  assert.equal(ui.writes().length, 0);
});

test('zonder decks verwijst de actie naar het deckoverzicht', async (t) => {
  const ui = mount(t, { availableDecks: [] });
  assert.equal(await ui.open(), null);
  assert.equal(window.location.hash, '#/decks');
  assert.equal(ui.writes().length, 0);
  assert.match(ui.messages(), /Maak eerst een deck aan/);
});

test('een mislukte decktoevoeging blijft corrigeerbaar zonder Wanted of verversen', async (t) => {
  const ui = mount(t);
  let completed = 0;
  const dialog = await ui.open(catalogCard, { onDone: () => { completed += 1; } });
  await ui.submit(dialog);
  ui.writes()[0].fail('Kaart niet gevonden', 404);
  await flush();
  assert.equal(dialog.open, true);
  assert.equal(completed, 0);
  assert.match(ui.messages(), /Kaart niet gevonden/);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, false);
  await ui.submit(dialog);
  await ui.respond(ui.writes()[1], { card: { id: 701 } });
  assert.equal(dialog.open, false);
  assert.equal(completed, 1);
});

test('dubbel indienen en een Wanted-fout kunnen een toegevoegde kaart niet opnieuw toevoegen', async (t) => {
  const ui = mount(t);
  const dialog = await ui.open();
  dialog.querySelector('[name="addMissingWanted"]').checked = true;
  await ui.submit(dialog);
  await ui.submit(dialog);
  assert.equal(ui.writes().length, 1);
  await ui.respond(ui.writes()[0], { card: { id: 701, usage: { shortage: 1 } } });
  await ui.submit(dialog);
  assert.equal(ui.writes().length, 2);
  ui.writes()[1].fail('Wanted niet beschikbaar');
  await flush();
  assert.equal(dialog.open, false);
  assert.match(ui.messages(), /is aan het deck toegevoegd.*Wanted bijwerken mislukte/);
  assert.equal(ui.writes().filter((request) => request.path.endsWith('/cards')).length, 1);
});

test('een fout tijdens verversen sluit de reeds opgeslagen toevoeging af', async (t) => {
  const ui = mount(t);
  const dialog = await ui.open(catalogCard, { onDone: () => { throw new Error('Zoekresultaten niet beschikbaar'); } });
  await ui.submit(dialog);
  await ui.respond(ui.writes()[0], { card: { id: 701 } });
  assert.equal(dialog.open, false);
  assert.match(ui.messages(), /De kaart is toegevoegd, maar het overzicht kon niet worden vernieuwd/);
  await ui.submit(dialog);
  assert.equal(ui.writes().length, 1);
});

test('catalogus basic lands tonen geen Wanted-optie en alleen-lezen schakelt indienen uit', async (t) => {
  const ui = mount(t, { available: false });
  const dialog = await ui.open({ catalogId: 'forest:0', name: 'Forest', typeLine: 'Basic Land — Forest' });
  assert.equal(dialog.querySelector('[name="addMissingWanted"]'), null);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, true);
  assert.equal(dialog.querySelector('[type="submit"]').getAttribute('aria-disabled'), 'true');
  assert.equal(ui.writes().length, 0);
});
