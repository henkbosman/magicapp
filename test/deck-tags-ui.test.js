import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindDeckTagPicker, deckTagPickerHtml, openDeckTagManager } from '../public/js/deck-tags.js';
import { openDialog } from '../public/js/utils.js';
import { setWriteAvailability } from '../public/js/write-access.js';
import { Element, parseHtml } from './support/dom.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function mount(t, { available = true } = {}) {
  const keys = ['document', 'window', 'FormData', 'Element', 'HTMLButtonElement',
    'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement'];
  const originals = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const oldFocus = Object.getOwnPropertyDescriptor(Element.prototype, 'focus');
  t.after(() => {
    setWriteAvailability(false);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    if (oldFocus) Object.defineProperty(Element.prototype, 'focus', oldFocus);
    else delete Element.prototype.focus;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Element.prototype.focus = function () { this.focused = true; };
  const append = function (child) { child.parentElement = this; this.children.push(child); };
  const document = parseHtml('<div id="app">Deck</div>');
  document.documentElement = document;
  document.body = document;
  document.append = append;
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.createElement = (tag) => {
    const element = new Element(tag);
    element.append = append;
    element.showModal = () => { element.open = true; };
    element.close = () => { element.open = false; element.dispatch('close'); };
    element.remove = () => {
      if (element.parentElement) element.parentElement.children = element.parentElement.children.filter((child) => child !== element);
      element.parentElement = null;
    };
    return element;
  };
  globalThis.document = document;
  globalThis.window = Object.assign(new EventTarget(), { location: { hash: '#/decks/7?view=cards' } });
  globalThis.FormData = class {
    constructor(form) {
      this.values = form.elements.filter((element) => element.name && !element.disabled
        && (!['checkbox', 'radio'].includes(element.type) || element.checked))
        .map((element) => [element.name, element.value]);
    }
    get(name) { return this.values.find(([key]) => key === name)?.[1] ?? null; }
  };
  for (const key of keys.filter((key) => key.includes('Element'))) globalThis[key] = Element;
  setWriteAvailability(available);
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, options = {}) => new Promise((resolve, reject) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null, resolve, reject });
  }));
  return {
    document, requests,
    writes: () => requests.filter((request) => request.options.method !== 'GET'),
    async respond(index, data, status = 200) {
      requests[index].resolve(Response.json(status < 400 ? { data } : { error: { message: data } }, { status }));
      await flush();
    },
    picker(options = {}) {
      let selected;
      const dialog = openDialog({
        title: 'Aan deck toevoegen',
        content: `<select name="deckId"><option value="7">Eerste deck</option><option value="8">Tweede deck</option></select>${deckTagPickerHtml()}`,
        onSubmit: () => { selected = controller.readSelectedTagIds(); return false; }
      });
      const deckSelect = dialog.querySelector('[name="deckId"]');
      const controller = bindDeckTagPicker(dialog, { deckId: 7, deckSelect, ...options });
      return { dialog, deckSelect, controller, submitted: () => selected };
    },
    navigate(hash) { window.location.hash = hash; window.dispatchEvent(new Event('hashchange')); }
  };
}

const tagList = [{ id: 11, name: 'Ramp', cardCount: 2 }, { id: 12, name: 'Draw', cardCount: 0 }];

test('tagpicker offers only registered tags, selects several and uses stable IDs for renamed tags', async (t) => {
  const ui = mount(t);
  const { dialog, controller } = ui.picker({ selectedTagIds: [11], selectedTags: ['Old name'] });
  assert.equal(ui.requests[0].url, '/api/read/decks/7/tags');
  assert.equal(dialog.querySelector('[type="submit"]').disabled, true);
  assert.throws(() => controller.readSelectedTagIds(), /Wacht/);
  await ui.respond(0, tagList);
  assert.equal(await controller.ready, true);
  assert.equal(dialog.querySelector('[name="tags"]'), null);
  assert.deepEqual(controller.readSelectedTagIds(), [11]);
  dialog.querySelector('[data-deck-tag-id="12"]').checked = true;
  assert.deepEqual(controller.readSelectedTagIds(), [11, 12]);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, false);
  dialog.querySelector('[data-deck-tag-id="11"]').checked = false;
  assert.deepEqual(controller.readSelectedTagIds(), [12]);
  assert.equal(ui.writes().length, 0);
});

test('switching decks clears old tags and ignores delayed responses for the previous deck', async (t) => {
  const ui = mount(t);
  const { dialog, deckSelect, controller } = ui.picker();
  deckSelect.value = '8';
  deckSelect.dispatch('change');
  assert.equal(ui.requests[1].url, '/api/read/decks/8/tags');
  assert.equal(ui.requests[0].options.signal.aborted, true);
  await ui.respond(1, [{ id: 31, name: 'Removal', cardCount: 1 }]);
  dialog.querySelector('[data-deck-tag-id="31"]').checked = true;
  await ui.respond(0, tagList);
  assert.deepEqual(controller.readSelectedTagIds(), [31]);
  assert.equal(dialog.querySelector('[data-deck-tag-id="11"]'), null);
  deckSelect.value = '7';
  assert.throws(() => controller.readSelectedTagIds(), /gekozen deck/);
  deckSelect.dispatch('change');
  assert.equal(dialog.querySelector('[data-deck-tag-id="31"]'), null);
  assert.throws(() => controller.readSelectedTagIds(), /Wacht/);
  await ui.respond(2, tagList);
  assert.deepEqual(controller.readSelectedTagIds(), []);
});

test('empty decks permit no-tag selection; errors block submit and retry only fetches tags', async (t) => {
  const ui = mount(t);
  const { dialog, controller } = ui.picker();
  await ui.respond(0, 'Laden mislukt', 503);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, true);
  assert.throws(() => controller.readSelectedTagIds(), /Laad eerst/);
  assert.match(dialog.textContent, /Laden mislukt/);
  dialog.querySelector('[data-deck-tag-retry]').click();
  await ui.respond(1, []);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, false);
  assert.match(dialog.textContent, /Deckacties/);
  assert.deepEqual(controller.readSelectedTagIds(), []);
  assert.equal(ui.writes().length, 0);
});

test('missing assigned tags block stale editors and names are escaped as text', async (t) => {
  const ui = mount(t);
  const stale = ui.picker({ selectedTagIds: [999] });
  await ui.respond(0, tagList);
  assert.equal(stale.dialog.querySelector('[type="submit"]').disabled, true);
  assert.match(stale.dialog.textContent, /intussen verwijderd/);
  assert.throws(() => stale.controller.readSelectedTagIds());
  stale.dialog.close();
  const current = ui.picker({ selectedTags: [' ramp '] });
  await ui.respond(1, [...tagList, { id: 13, name: '<script>unsafe</script> & "tag"', cardCount: 0 }]);
  assert.deepEqual(current.controller.readSelectedTagIds(), [11]);
  assert.equal(current.dialog.querySelector('script'), null);
  assert.match(current.dialog.textContent, /<script>unsafe<\/script> & "tag"/);
  current.dialog.querySelector('[data-deck-tag-id="13"]').value = '999';
  current.dialog.querySelector('[data-deck-tag-id="13"]').checked = true;
  assert.throws(() => current.controller.readSelectedTagIds(), /bestaande tags/);
});

test('closed tagpickers cannot accept delayed data or issue further loads', async (t) => {
  const ui = mount(t);
  const { dialog, controller } = ui.picker();
  dialog.close();
  assert.equal(ui.requests[0].options.signal.aborted, true);
  await ui.respond(0, tagList);
  assert.equal(await controller.ready, false);
  assert.throws(() => controller.readSelectedTagIds(), /niet meer actief/);
  assert.equal(await controller.load(8), false);
  assert.equal(ui.requests.length, 1);
});

test('tagmanager creates unused tags once and survives a failed overview refresh after saving', async (t) => {
  const ui = mount(t);
  let refreshes = 0;
  const dialog = openDeckTagManager(7, { onChanged() { refreshes++; throw new Error('Refresh failed'); } });
  await ui.respond(0, []);
  const input = dialog.querySelector('[name="newTag"]');
  input.value = ' Protection ';
  const create = dialog.querySelector('[data-create-deck-tag]');
  create.click();
  create.click();
  assert.equal(ui.writes().length, 1);
  assert.equal(ui.writes()[0].url, '/api/write/decks/7/tags');
  assert.deepEqual(ui.writes()[0].body, { name: 'Protection' });
  await ui.respond(1, { id: 20, name: 'Protection', cardCount: 0 }, 201);
  assert.equal(input.value, '');
  assert.equal(ui.requests[2].url, '/api/read/decks/7/tags');
  await ui.respond(2, [{ id: 20, name: 'Protection', cardCount: 0 }]);
  assert.equal(refreshes, 1);
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent, /Protection/);
  assert.match(dialog.textContent, /opgeslagen.*niet worden vernieuwd/);
  assert.equal(ui.writes().length, 1);
});

test('tagmanager renames by stable ID, shows conflicts and confirms removal without deleting cards', async (t) => {
  const ui = mount(t);
  let refreshes = 0;
  const dialog = openDeckTagManager(7, { onChanged() { refreshes++; } });
  await ui.respond(0, tagList);
  dialog.querySelector('[data-rename-deck-tag="11"]').click();
  let editor = ui.document.querySelectorAll('dialog').at(-1);
  editor.querySelector('[name="name"]').value = 'Draw';
  editor.querySelector('form').dispatch('submit');
  assert.equal(ui.writes()[0].options.method, 'PATCH');
  assert.equal(ui.writes()[0].url, '/api/write/decks/7/tags/11');
  await ui.respond(1, 'Er bestaat al een tag met deze naam.', 409);
  assert.equal(editor.open, true);
  assert.match(editor.textContent, /al een tag/);
  assert.equal(refreshes, 0);
  editor.querySelector('[name="name"]').value = 'Mana';
  editor.querySelector('form').dispatch('submit');
  await ui.respond(2, { id: 11, name: 'Mana', cardCount: 2 });
  await ui.respond(3, [{ id: 11, name: 'Mana', cardCount: 2 }, tagList[1]]);
  assert.equal(editor.open, false);
  assert.equal(refreshes, 1);
  dialog.querySelector('[data-delete-deck-tag="11"]').click();
  editor = ui.document.querySelectorAll('dialog').at(-1);
  assert.match(editor.textContent, /De kaarten blijven in het deck/);
  assert.equal(ui.writes().length, 2, 'opening delete confirmation does not mutate');
  editor.querySelector('form').dispatch('submit');
  editor.querySelector('form').dispatch('submit');
  assert.equal(ui.writes().length, 3);
  assert.equal(ui.writes()[2].options.method, 'DELETE');
  assert.equal(ui.writes()[2].url, '/api/write/decks/7/tags/11');
  await ui.respond(4, { deleted: true });
  await ui.respond(5, [tagList[1]]);
  assert.equal(editor.open, false);
  assert.equal(dialog.querySelector('[data-deck-tag-row="11"]'), null);
  assert.equal(refreshes, 2);
  assert.ok(ui.writes().every((request) => request.url.includes('/tags')));
});

test('tagmanager is read-only without write access and renders hostile names safely', async (t) => {
  const ui = mount(t, { available: false });
  const dialog = openDeckTagManager(7);
  await ui.respond(0, [{ id: 11, name: '<img src=x onerror=alert(1)>', cardCount: 1 }]);
  assert.equal(dialog.querySelector('img'), null);
  assert.match(dialog.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.ok(dialog.querySelectorAll('[data-write-action]').every((element) => element.disabled));
  dialog.querySelector('[name="newTag"]').value = 'Ramp';
  dialog.querySelector('[data-create-deck-tag]').click();
  dialog.querySelector('[data-delete-deck-tag="11"]').click();
  assert.equal(ui.writes().length, 0);
  assert.equal(ui.document.querySelectorAll('dialog').length, 1);
});

test('tagmanager can recover from a failed initial load without a permanent refresh action', async (t) => {
  const ui = mount(t);
  const dialog = openDeckTagManager(7);
  assert.equal(dialog.querySelector('[data-reload-deck-tags]'), null);
  const retry = dialog.querySelector('[data-retry-deck-tags]');
  assert.equal(retry.hidden, true);
  await ui.respond(0, 'Tijdelijk niet bereikbaar', 503);
  assert.equal(retry.hidden, false);
  assert.equal(dialog.querySelector('[data-create-deck-tag]').disabled, true);
  retry.click();
  await ui.respond(1, tagList);
  assert.equal(retry.hidden, true);
  assert.equal(dialog.querySelector('[data-create-deck-tag]').disabled, false);
  assert.equal(dialog.querySelector('[data-deck-tags-error]').hidden, true);
  assert.equal(ui.writes().length, 0);
});

test('navigation closes the manager and a late mutation does not refresh another deck', async (t) => {
  const ui = mount(t);
  let refreshes = 0;
  const dialog = openDeckTagManager(7, { onChanged() { refreshes++; } });
  await ui.respond(0, tagList);
  dialog.querySelector('[name="newTag"]').value = 'Protection';
  dialog.querySelector('[data-create-deck-tag]').click();
  ui.navigate('#/decks/8');
  assert.equal(dialog.open, false);
  await ui.respond(1, { id: 21, name: 'Protection', cardCount: 0 }, 201);
  assert.equal(refreshes, 0);
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.document.querySelectorAll('dialog').length, 0);
});
