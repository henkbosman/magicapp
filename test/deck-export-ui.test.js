import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openDeckExport } from '../public/js/deck-export.js';
import { applyWriteAvailability, setWriteAvailability } from '../public/js/write-access.js';
import { Element, parseHtml } from './support/dom.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const txt = { format: 'txt', filename: 'mijn-deck.txt', text: '1 Llanowar Elves\n2 Forest\n' };
const dck = { format: 'dck', filename: 'mijn-deck.dck', text: '[metadata]\nName=Mijn deck\n[Main]\n1 Llanowar Elves|FDN|[227]\n2 Forest|TRK|[325]\n' };

function mount(t, { clipboard, execCommand } = {}) {
  const globalKeys = ['document', 'navigator', 'Element', 'HTMLButtonElement',
    'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement'];
  const originals = globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const prototypeOriginals = ['focus', 'select'].map((key) => [key, Object.getOwnPropertyDescriptor(Element.prototype, key)]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    for (const [key, descriptor] of prototypeOriginals) {
      if (descriptor) Object.defineProperty(Element.prototype, key, descriptor);
      else delete Element.prototype[key];
    }
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Element.prototype.focus = function () { this.focused = true; };
  Element.prototype.select = function () { this.selection = this.value; };
  const requests = [];
  const downloads = [];
  const blobs = new Map();
  const revoked = [];
  t.mock.method(globalThis, 'fetch', (url, options) => {
    const pending = deferred();
    requests.push({ url, options, ...pending });
    return pending.promise;
  });
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = `blob:export-${blobs.size + 1}`;
    blobs.set(url, blob);
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const append = function (child) { child.parentElement = this; this.children.push(child); };
  const document = parseHtml('');
  document.documentElement = document;
  document.body = document;
  document.append = append;
  document.execCommand = execCommand;
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
    if (tag === 'a') element.click = () => downloads.push({ filename: element.download, blob: blobs.get(element.href) });
    return element;
  };
  globalThis.document = document;
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true });
  for (const key of globalKeys.filter((key) => key.includes('Element'))) globalThis[key] = Element;
  setWriteAvailability(false);

  const dialog = openDeckExport(17);
  applyWriteAvailability(dialog);
  const controls = Object.fromEntries(['format', 'text', 'status', 'download', 'copy']
    .map((name) => [name, dialog.querySelector(`[data-export-${name}]`)]));
  return {
    dialog, requests, downloads, revoked, ...controls,
    change(format) { controls.format.value = format; controls.format.dispatch('change'); },
    async respond(index, data, status = 200) {
      requests[index].resolve(Response.json(status === 200 ? { data } : { error: { message: data } }, { status }));
      await flush();
    }
  };
}

test('deck export stays read-only and copies/downloads the exact default TXT preview', async (t) => {
  const copied = [];
  const ui = mount(t, { clipboard: { writeText: async (value) => copied.push(value) } });
  assert.equal(ui.dialog.querySelector('[data-write-action]'), null);
  assert.equal(ui.dialog.querySelector('[type="submit"]'), null);
  assert.equal(ui.format.value, 'txt');
  assert.equal(ui.dialog.querySelector('[data-export-printings]').hidden, true);
  assert.equal(ui.download.disabled, true);
  assert.equal(ui.copy.disabled, true);
  assert.equal(ui.text.getAttribute('readonly'), '');
  assert.equal(ui.requests[0].url, '/api/read/decks/17/export?format=txt');
  assert.equal(ui.requests[0].options.method, 'GET');

  const exported = { ...txt, text: '1 Æther Spellbomb\n1 Fire // Ice\n2 Forest\n' };
  await ui.respond(0, exported);
  assert.equal(ui.text.value, exported.text);
  assert.equal(ui.download.disabled, false);
  assert.equal(ui.copy.disabled, false);
  ui.copy.click();
  await flush();
  assert.deepEqual(copied, [exported.text]);
  assert.equal(ui.status.textContent, 'Decklijst gekopieerd.');
  ui.download.click();
  assert.equal(ui.downloads.length, 1);
  assert.equal(ui.downloads[0].filename, exported.filename);
  assert.equal(await ui.downloads[0].blob.text(), exported.text);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests.every((request) => request.options.method === 'GET'), true);
  t.mock.timers.tick(1000);
  assert.deepEqual(ui.revoked, ['blob:export-1']);
});

test('format switching blocks stale actions and ignores an older response arriving last', async (t) => {
  const ui = mount(t);
  ui.change('dck');
  assert.equal(ui.dialog.querySelector('[data-export-printings]').hidden, false);
  assert.equal(ui.requests[0].options.signal.aborted, true);
  assert.equal(ui.requests[1].url, '/api/read/decks/17/export?format=dck');
  ui.download.click();
  ui.copy.click();
  assert.equal(ui.downloads.length, 0);
  await ui.respond(1, dck);
  await ui.respond(0, txt); // Simulate a server/client that completes despite cancellation.
  assert.equal(ui.text.value, dck.text);
  assert.equal(ui.status.textContent, dck.filename);
  ui.download.click();
  assert.equal(ui.downloads[0].filename, dck.filename);
  assert.equal(await ui.downloads[0].blob.text(), dck.text);
  ui.change('txt');
  assert.equal(ui.dialog.querySelector('[data-export-printings]').hidden, true);
  assert.equal(ui.text.value, '');
  assert.equal(ui.download.disabled, true);
  assert.equal(ui.copy.disabled, true);
  ui.download.click();
  assert.equal(ui.downloads.length, 1);
  await ui.respond(2, txt);
  assert.equal(ui.text.value, txt.text);
});

test('failed or malformed exports cannot expose the previous format and can recover', async (t) => {
  const ui = mount(t);
  await ui.respond(0, txt);
  ui.change('dck');
  await ui.respond(1, 'Deck niet gevonden.', 404);
  assert.equal(ui.text.value, '');
  assert.equal(ui.status.textContent, 'Deck niet gevonden.');
  assert.equal(ui.download.disabled, true);
  assert.equal(ui.copy.disabled, true);
  ui.download.click();
  assert.equal(ui.downloads.length, 0);
  ui.change('txt');
  await ui.respond(2, { ...txt, filename: 'wrong.dck' });
  assert.match(ui.status.textContent, /geen geldige deckexport/);
  assert.equal(ui.download.disabled, true);
  ui.change('dck');
  await ui.respond(3, dck);
  assert.equal(ui.text.value, dck.text);
  assert.equal(ui.download.disabled, false);
});

test('HTTP browsers without the Clipboard API can copy the selected text through the fallback', async (t) => {
  const commands = [];
  const ui = mount(t, { execCommand: (command) => { commands.push(command); return true; } });
  await ui.respond(0, txt);
  ui.copy.click();
  await flush();
  assert.equal(ui.text.selection, txt.text);
  assert.equal(ui.text.focused, true);
  assert.deepEqual(commands, ['copy']);
  assert.equal(ui.status.textContent, 'Decklijst gekopieerd.');
  assert.equal(ui.copy.disabled, false);
});

test('denied clipboard permissions leave the text selected with honest manual-copy guidance', async (t) => {
  const ui = mount(t, {
    clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } },
    execCommand: () => { throw new Error('Blocked'); }
  });
  await ui.respond(0, txt);
  ui.copy.click();
  await flush();
  assert.equal(ui.text.selection, txt.text);
  assert.match(ui.status.textContent, /Kopieer met Ctrl\+C of ⌘C/);
  assert.doesNotMatch(ui.status.textContent, /gekopieerd/);
  assert.equal(ui.copy.disabled, false);
});

test('a clipboard failure from the previous format does not select or overwrite the new format', async (t) => {
  const copying = deferred();
  const ui = mount(t, { clipboard: { writeText: () => copying.promise } });
  await ui.respond(0, txt);
  ui.copy.click();
  assert.equal(ui.copy.disabled, true);
  ui.change('dck');
  await ui.respond(1, dck);
  copying.reject(new Error('Blocked'));
  await flush();
  assert.equal(ui.text.selection, undefined);
  assert.equal(ui.text.value, dck.text);
  assert.equal(ui.status.textContent, dck.filename);
  assert.equal(ui.copy.disabled, false);
});

test('closing the popup cancels loading and prevents late responses or clicks from exporting', async (t) => {
  const ui = mount(t);
  ui.dialog.querySelector('.close-dialog').click();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.requests[0].options.signal.aborted, true);
  await ui.respond(0, txt);
  assert.equal(ui.text.value, '');
  assert.equal(ui.download.disabled, true);
  ui.download.click();
  ui.copy.click();
  assert.equal(ui.downloads.length, 0);
});
