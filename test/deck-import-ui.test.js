import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDeckImport } from '../public/js/deck-import.js';
import { setWriteAvailability } from '../public/js/write-access.js';
import { Element, parseHtml } from './support/dom.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function mount(t, { refreshError } = {}) {
  const globalKeys = ['document', 'window', 'FormData', 'Element', 'HTMLButtonElement',
    'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement'];
  const originals = globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const focus = Object.getOwnPropertyDescriptor(Element.prototype, 'focus');
  t.after(() => {
    setWriteAvailability(false);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    if (focus) Object.defineProperty(Element.prototype, 'focus', focus);
    else delete Element.prototype.focus;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Element.prototype.focus = function () { this.focused = true; };
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, options) => {
    const pending = deferred();
    requests.push({ url, options, ...pending });
    return pending.promise;
  });
  const append = function (child) { child.parentElement = this; this.children.push(child); };
  const document = parseHtml('<div id="app">Deck overzicht</div>');
  document.documentElement = document;
  document.body = document;
  document.append = append;
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.createElement = (tag) => {
    const element = new Element(tag);
    element.append = append;
    element.remove = () => {
      if (!element.parentElement) return;
      element.parentElement.children = element.parentElement.children.filter((child) => child !== element);
      element.parentElement = null;
    };
    element.showModal = () => { element.open = true; };
    element.close = () => { element.open = false; element.dispatch('close'); };
    return element;
  };
  globalThis.document = document;
  globalThis.window = Object.assign(new EventTarget(), { location: { hash: '#/decks/17?view=list' } });
  globalThis.FormData = class {
    constructor(form) {
      this.values = new Map(form.elements.filter((element) => element.name && !element.disabled)
        .map((element) => [element.name, element.value]));
    }
    get(name) { return this.values.get(name) ?? null; }
  };
  for (const key of globalKeys.filter((key) => key.includes('Element'))) globalThis[key] = Element;
  setWriteAvailability(true);
  let refreshed = 0;
  const dialog = openDeckImport(17, { onDone() {
    refreshed++;
    if (refreshError) throw refreshError;
    document.getElementById('app').innerHTML = 'Vernieuwd deck';
  } });
  const input = dialog.querySelector('[name="text"]');
  const form = dialog.querySelector('form');
  const submitButton = dialog.querySelector('[type="submit"]');
  return {
    document, dialog, input, form, submitButton, requests,
    refreshed: () => refreshed,
    submit(text = input.value) { input.value = text; form.dispatch('submit'); },
    result: () => document.querySelector('dialog'),
    title(result = document.querySelector('dialog')) {
      return result?.querySelector(`#${result.getAttribute('aria-labelledby')}`)?.textContent;
    },
    async respond(index, data, status = 201) {
      requests[index].resolve(Response.json(status < 400 ? { data } : { error: { message: data } }, { status }));
      await flush();
    },
    navigate(hash) {
      window.location.hash = hash;
      window.dispatchEvent(new Event('hashchange'));
    }
  };
}

const success = {
  importedCount: 2, importedQuantity: 3, totalRows: 2, failedCount: 0,
  imported: [{ quantity: 20 }, { quantity: 30 }], failed: [], notFound: []
};

test('deckimport reports successful added rows and quantities in a persistent read-only popup', async (t) => {
  const ui = mount(t);
  const text = '1 Sol Ring\n2 Forest';
  ui.submit(text);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].url, '/api/write/decks/17/import');
  assert.equal(ui.requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(ui.requests[0].options.body), { text });
  await ui.respond(0, success);
  const result = ui.result();
  assert.notEqual(result, ui.dialog);
  assert.equal(ui.dialog.open, false);
  assert.equal(result.open, true);
  assert.equal(result.querySelector('[data-write-action]'), null);
  assert.equal(result.querySelector('[type="submit"]'), null);
  assert.match(result.textContent, /2.*regels.*3.*kaarten/s);
  assert.doesNotMatch(result.textContent, /20|30|50/);
  assert.equal(ui.refreshed(), 1);
  assert.equal(ui.document.getElementById('app').textContent, 'Vernieuwd deck');
  assert.equal(ui.requests.length, 1);
});

test('partial deckimport lists every skipped original line, its physical number and reason as text', async (t) => {
  const ui = mount(t);
  const unsafeLine = '2 <script>alert(1)</script> & Card';
  ui.submit(`1 Sol Ring\nCommander\n${unsafeLine}\nSideboard\n1 Missing Card`);
  await ui.respond(0, {
    importedCount: 1, importedQuantity: 1, totalRows: 3, failedCount: 2, imported: [], notFound: [],
    failed: [
      { line: 3, rawLine: unsafeLine, quantity: 2, role: 'commander', name: '<script>alert(1)</script> & Card', reason: 'Niet gevonden <b>bij Scryfall</b>' },
      { line: 5, rawLine: '1 Missing Card', quantity: 1, role: 'sideboard', name: 'Missing Card', reason: 'Verkeerde printing' }
    ]
  });
  const result = ui.result();
  assert.match(result.textContent, /2.*overgeslagen/s);
  const rows = result.querySelectorAll('[data-import-failure]');
  assert.equal(rows.length, 2);
  assert.match(rows[0].querySelector('[data-import-line]').textContent, /^Regel 3:/);
  assert.equal(rows[0].querySelector('[data-import-role]').textContent, 'Sectie: Commander');
  assert.ok(rows[0].textContent.includes(unsafeLine));
  assert.ok(rows[0].textContent.includes('Niet gevonden <b>bij Scryfall</b>'));
  assert.match(rows[1].textContent, /5.*1 Missing Card.*Verkeerde printing/s);
  assert.equal(rows[1].querySelector('[data-import-role]').textContent, 'Sectie: Sideboard');
  assert.equal(result.querySelector('script'), null);
  assert.equal(result.querySelector('b'), null);
  assert.equal(ui.refreshed(), 1);
  assert.equal(ui.requests.length, 1);
});

test('all-skipped deckimport shows failures and zero successful rows', async (t) => {
  const ui = mount(t);
  ui.submit('1 Missing Card');
  await ui.respond(0, {
    importedCount: 0, importedQuantity: 0, totalRows: 1, failedCount: 1, imported: [], notFound: [],
    failed: [{ line: 1, rawLine: '1 Missing Card', name: 'Missing Card', reason: 'Niet gevonden bij Scryfall' }]
  });
  const result = ui.result();
  assert.match(result.textContent, /0.*geïmporteerd|geen.*geïmporteerd/i);
  assert.match(result.textContent, /1.*overgeslagen/s);
  assert.match(result.textContent, /1 Missing Card/);
  assert.doesNotMatch(result.textContent, /alles.*goed|alle.*succesvol/i);
});

test('legacy import responses still display failed names and reasons without inventing quantities', async (t) => {
  const ui = mount(t);
  ui.submit('1 Sol Ring\n1 Missing Card');
  await ui.respond(0, {
    importedCount: 1, imported: [{ quantity: 50 }], notFound: [],
    failed: [{ name: 'Missing Card', reason: 'Niet gevonden bij Scryfall' }]
  });
  const result = ui.result();
  assert.match(result.textContent, /Missing Card/);
  assert.match(result.textContent, /Niet gevonden bij Scryfall/);
  assert.doesNotMatch(result.textContent, /50/);
  assert.equal(result.querySelector('[data-import-role]'), null);
});

test('double submits and closing by button while importing cannot repeat a write', async (t) => {
  const ui = mount(t);
  ui.submit('1 Sol Ring');
  ui.submit('2 Forest');
  ui.dialog.querySelector('.close-dialog').click();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.submitButton.disabled, true);
  assert.equal(ui.dialog.open, true);
  await ui.respond(0, success);
  ui.form.dispatch('submit');
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.refreshed(), 1);
});

test('validation failure stays visible and preserves input for an explicit corrected retry', async (t) => {
  const ui = mount(t);
  ui.submit('0 Sol Ring');
  await ui.respond(0, 'Regel 1: Aantal moet een positief geheel getal zijn.', 400);
  assert.equal(ui.result(), ui.dialog);
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.input.value, '0 Sol Ring');
  const error = ui.dialog.querySelector('[data-import-error]');
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /Regel 1: Aantal/);
  assert.equal(ui.submitButton.disabled, false);
  assert.equal(ui.refreshed(), 0);
  assert.equal(ui.requests.length, 1);
  ui.submit('1 Sol Ring');
  await ui.respond(1, { ...success, importedCount: 1, importedQuantity: 1, totalRows: 1 });
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.refreshed(), 1);
  assert.notEqual(ui.result(), ui.dialog);
});

test('network failure does not claim nothing was added and never retries automatically', async (t) => {
  const ui = mount(t);
  ui.submit('1 Sol Ring');
  ui.requests[0].reject(new Error('Connection lost after sending'));
  await flush();
  const error = ui.dialog.querySelector('[data-import-error]');
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /controleer.*deck.*opnieuw/i);
  assert.equal(ui.input.value, '1 Sol Ring');
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.refreshed(), 0);
  assert.equal(ui.requests.length, 1);
});

test('a malformed success response cannot claim the import completed or trigger another write', async (t) => {
  const ui = mount(t);
  ui.submit('1 Sol Ring');
  await ui.respond(0, { importedCount: 'unknown', failed: [] });
  const error = ui.dialog.querySelector('[data-import-error]');
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /geen geldig importresultaat/);
  assert.match(error.textContent, /controleer.*deck.*opnieuw/i);
  assert.equal(ui.result(), ui.dialog);
  assert.equal(ui.refreshed(), 0);
  assert.equal(ui.requests.length, 1);
});

test('refresh failure keeps the completed import result and offers no duplicate import', async (t) => {
  const ui = mount(t, { refreshError: new Error('Render failed') });
  ui.submit('1 Sol Ring');
  await ui.respond(0, success);
  const result = ui.result();
  assert.notEqual(result, ui.dialog);
  assert.equal(result.open, true);
  assert.equal(result.querySelector('[type="submit"]'), null);
  const error = result.querySelector('[data-import-refresh-error]');
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /deckoverzicht.*niet.*vernieuwd/i);
  assert.equal(ui.refreshed(), 1);
  assert.equal(ui.requests.length, 1);
});

test('a closed input dialog cannot reopen a result from a late import response', async (t) => {
  const ui = mount(t);
  ui.submit('1 Sol Ring');
  ui.dialog.close();
  await ui.respond(0, success);
  assert.equal(ui.result(), null);
  assert.equal(ui.refreshed(), 0);
  assert.equal(ui.requests.length, 1);
});

test('navigating to another deck suppresses the former deck import result and refresh', async (t) => {
  const ui = mount(t);
  ui.submit('1 Sol Ring');
  ui.navigate('#/decks/18');
  await ui.respond(0, success);
  assert.equal(ui.result(), null);
  assert.equal(ui.refreshed(), 0);
  assert.equal(ui.requests.length, 1);
});

test('a changed route before submitting is rejected even without a hashchange event', async (t) => {
  const ui = mount(t);
  // Like history.replaceState, this changes the route without dispatching an event.
  window.location.hash = '#/decks/18';
  ui.submit('1 Sol Ring');
  await flush();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.result(), null);
  assert.equal(ui.refreshed(), 0);
  assert.equal(ui.requests.length, 0);
});
