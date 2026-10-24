import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDeckSynergyManager, openDeckCardSynergies } from '../public/js/deck-synergies.js';
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
    navigate(hash) { window.location.hash = hash; window.dispatchEvent(new Event('hashchange')); }
  };
}

const item = { id: 51, card: { name: 'Llanowar Elves' }, relations: [{ id: 12, type: 'synergy', name: 'Stale membership' }] };
const groups = [
  { id: 11, deckId: 7, type: 'synergy', name: 'Landfall', memberCount: 2, members: [{ deckCardId: 51 }, { deckCardId: 52 }], note: 'Keep this' },
  { id: 12, deckId: 7, type: 'synergy', name: 'Tokens', memberCount: 0, members: [], note: '' },
  { id: 13, deckId: 7, type: 'combo', name: 'Combo only', memberCount: 2, members: [{ deckCardId: 51 }, { deckCardId: 52 }], note: '' }
];

test('synergy manager creates an empty synergy once, reloads and retains save success on refresh failure', async (t) => {
  const ui = mount(t);
  let refreshes = 0;
  const dialog = openDeckSynergyManager(7, { onChanged() { refreshes++; throw new Error('Refresh failed'); } });
  assert.equal(ui.requests[0].url, '/api/read/decks/7/links');
  assert.equal(dialog.querySelector('[data-create-deck-synergy]').disabled, true);
  await ui.respond(0, []);
  const input = dialog.querySelector('[name="newSynergy"]');
  input.value = '  Tokens  ';
  dialog.querySelector('[data-create-deck-synergy]').click();
  dialog.querySelector('[data-create-deck-synergy]').click();
  dialog.querySelector('form').dispatch('submit');
  assert.equal(ui.writes().length, 1);
  assert.equal(ui.writes()[0].url, '/api/write/decks/7/links');
  assert.equal(ui.writes()[0].options.method, 'POST');
  assert.deepEqual(ui.writes()[0].body, { name: 'Tokens', type: 'synergy', deckCardIds: [] });
  await ui.respond(1, groups[1], 201);
  assert.equal(input.value, '');
  assert.equal(ui.requests[2].url, '/api/read/decks/7/links');
  await ui.respond(2, [groups[1]]);
  assert.equal(refreshes, 1);
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent, /Tokens/);
  assert.match(dialog.textContent, /opgeslagen.*niet worden vernieuwd/);
  assert.equal(ui.writes().length, 1);
});

test('synergy manager preserves members on rename and confirms delete without exposing combo controls', async (t) => {
  const ui = mount(t);
  let refreshes = 0;
  const dialog = openDeckSynergyManager(7, { onChanged() { refreshes++; } });
  await ui.respond(0, groups);
  assert.deepEqual(dialog.querySelectorAll('[data-deck-synergy-row]').map((row) => row.dataset.deckSynergyRow), ['11', '12']);
  assert.equal(dialog.querySelector('[data-rename-deck-synergy="13"]'), null);
  dialog.querySelector('[data-rename-deck-synergy="11"]').click();
  let child = ui.document.querySelectorAll('dialog').at(-1);
  child.querySelector('[name="name"]').value = '  Lands  ';
  child.querySelector('form').dispatch('submit');
  assert.equal(ui.writes()[0].options.method, 'PATCH');
  assert.equal(ui.writes()[0].url, '/api/write/decks/7/links/11');
  assert.deepEqual(ui.writes()[0].body, { name: 'Lands' });
  await ui.respond(1, { ...groups[0], name: 'Lands' });
  await ui.respond(2, [{ ...groups[0], name: 'Lands' }, ...groups.slice(1)]);
  assert.equal(child.open, false);
  assert.equal(refreshes, 1);
  dialog.querySelector('[data-delete-deck-synergy="11"]').click();
  child = ui.document.querySelectorAll('dialog').at(-1);
  assert.match(child.textContent, /De kaarten blijven in het deck/);
  assert.equal(ui.writes().length, 1);
  child.querySelector('form').dispatch('submit');
  child.querySelector('form').dispatch('submit');
  assert.equal(ui.writes().length, 2);
  assert.equal(ui.writes()[1].options.method, 'DELETE');
  assert.equal(ui.writes()[1].url, '/api/write/decks/7/links/11');
  await ui.respond(3, { deleted: true });
  await ui.respond(4, groups.slice(1));
  assert.equal(child.open, false);
  assert.equal(dialog.querySelector('[data-deck-synergy-row="11"]'), null);
  assert.equal(refreshes, 2);
});

test('manager load errors block writing, offer retry and ignore responses after navigation', async (t) => {
  const ui = mount(t);
  const dialog = openDeckSynergyManager(7);
  const retry = dialog.querySelector('[data-deck-synergies-retry]');
  assert.equal(retry.hidden, true);
  await ui.respond(0, 'Temporary outage', 503);
  assert.equal(retry.hidden, false);
  assert.equal(dialog.querySelector('[data-create-deck-synergy]').disabled, true);
  dialog.querySelector('[name="newSynergy"]').value = 'Landfall';
  dialog.querySelector('[data-create-deck-synergy]').click();
  assert.equal(ui.writes().length, 0);
  retry.click();
  await ui.respond(1, groups);
  assert.equal(retry.hidden, true);
  assert.equal(dialog.querySelector('[data-create-deck-synergy]').disabled, false);
  const pending = openDeckSynergyManager(7);
  ui.navigate('#/decks/8');
  assert.equal(pending.open, false);
  assert.equal(ui.requests[2].options.signal.aborted, true);
  await ui.respond(2, groups);
  assert.equal(ui.document.querySelectorAll('dialog').length, 0);
  assert.equal(pending.querySelectorAll('[data-deck-synergy-row]').length, 0);
});

test('manager respects read-only access and escapes hostile synergy names', async (t) => {
  const ui = mount(t, { available: false });
  const dialog = openDeckSynergyManager(7);
  await ui.respond(0, [{ ...groups[0], name: '<img src=x onerror=alert(1)>' }]);
  assert.equal(dialog.querySelector('img'), null);
  assert.match(dialog.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.ok(dialog.querySelectorAll('[data-write-action]').every((element) => element.disabled));
  dialog.querySelector('[name="newSynergy"]').value = 'Tokens';
  dialog.querySelector('[data-create-deck-synergy]').click();
  dialog.querySelector('[data-delete-deck-synergy="11"]').click();
  assert.equal(ui.writes().length, 0);
  assert.equal(ui.document.querySelectorAll('dialog').length, 1);
});

test('assignment loads current memberships, submits several synergy IDs once and supports clearing all', async (t) => {
  const ui = mount(t);
  let refreshes = 0;
  let dialog = openDeckCardSynergies(7, item, { onChanged() { refreshes++; } });
  assert.equal(dialog.querySelector('[type="submit"]').disabled, true);
  await ui.respond(0, groups);
  assert.equal(dialog.querySelector('[data-card-synergy-id="11"]').checked, true);
  assert.equal(dialog.querySelector('[data-card-synergy-id="12"]').checked, false, 'stale item.relations cannot override current server membership');
  assert.equal(dialog.querySelector('[data-card-synergy-id="13"]'), null);
  dialog.querySelector('[data-card-synergy-id="12"]').checked = true;
  dialog.querySelector('form').dispatch('submit');
  dialog.querySelector('form').dispatch('submit');
  assert.equal(ui.writes().length, 1);
  assert.equal(ui.writes()[0].url, '/api/write/decks/7/cards/51/synergies');
  assert.equal(ui.writes()[0].options.method, 'PUT');
  assert.deepEqual(ui.writes()[0].body, { synergyIds: [11, 12] });
  await ui.respond(1, groups.slice(0, 2));
  assert.equal(dialog.open, false);
  assert.equal(refreshes, 1);
  dialog = openDeckCardSynergies(7, item);
  await ui.respond(2, groups);
  for (const checkbox of dialog.querySelectorAll('[data-card-synergy-id]')) checkbox.checked = false;
  dialog.querySelector('form').dispatch('submit');
  assert.deepEqual(ui.writes()[1].body, { synergyIds: [] });
  await ui.respond(3, []);
  assert.equal(dialog.open, false);
});

test('assignment blocks writes after failed loads, supports retry and ignores a closed response', async (t) => {
  const ui = mount(t);
  const dialog = openDeckCardSynergies(7, item);
  await ui.respond(0, 'Unavailable', 503);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, true);
  const retry = dialog.querySelector('[data-card-synergy-retry]');
  assert.equal(retry.hidden, false);
  dialog.querySelector('form').dispatch('submit');
  assert.equal(ui.writes().length, 0);
  retry.click();
  await ui.respond(1, groups);
  assert.equal(retry.hidden, true);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, false);
  dialog.close();
  const pending = openDeckCardSynergies(7, item);
  pending.close();
  assert.equal(ui.requests[2].options.signal.aborted, true);
  await ui.respond(2, groups);
  assert.equal(pending.querySelectorAll('[data-card-synergy-id]').length, 0);
  assert.equal(ui.writes().length, 0);
});

test('assignment respects read-only mode, escapes names and rejects groups belonging to another deck', async (t) => {
  const ui = mount(t, { available: false });
  let dialog = openDeckCardSynergies(7, item);
  await ui.respond(0, [{ ...groups[0], name: '<script>unsafe</script>' }]);
  assert.equal(dialog.querySelector('script'), null);
  assert.match(dialog.textContent, /<script>unsafe<\/script>/);
  assert.ok(dialog.querySelectorAll('[data-write-action]').every((element) => element.disabled));
  dialog.querySelector('form').dispatch('submit');
  assert.equal(ui.writes().length, 0);
  dialog.close();
  setWriteAvailability(true);
  dialog = openDeckCardSynergies(7, item);
  await ui.respond(1, [{ ...groups[0], deckId: 8 }]);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, true);
  assert.match(dialog.textContent, /geen geldige lijst/);
  assert.equal(ui.writes().length, 0);
});

test('assignment retains committed success when refreshing fails and never submits it twice', async (t) => {
  const ui = mount(t);
  let refreshes = 0;
  const dialog = openDeckCardSynergies(7, item, { onChanged() { refreshes++; throw new Error('Render failed'); } });
  await ui.respond(0, groups);
  dialog.querySelector('form').dispatch('submit');
  await ui.respond(1, [groups[0]]);
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent, /opgeslagen.*niet worden vernieuwd/);
  assert.ok(dialog.querySelectorAll('[data-card-synergy-id]').every((checkbox) => checkbox.disabled));
  dialog.querySelector('form').dispatch('submit');
  await flush();
  assert.equal(dialog.open, false);
  assert.equal(ui.writes().length, 1);
  assert.equal(refreshes, 1);
});

test('a completed write after navigation never refreshes a different deck', async (t) => {
  const ui = mount(t);
  let refreshes = 0;
  const dialog = openDeckCardSynergies(7, item, { onChanged() { refreshes++; } });
  await ui.respond(0, groups);
  dialog.querySelector('form').dispatch('submit');
  ui.navigate('#/decks/8');
  assert.equal(dialog.open, false);
  await ui.respond(1, [groups[0]]);
  assert.equal(refreshes, 0);
  assert.equal(ui.writes().length, 1);
  assert.equal(ui.requests.length, 2);
});

test('a stale deleted synergy blocks repeated writes until a fresh GET and explicit corrected submission', async (t) => {
  const ui = mount(t);
  let refreshes = 0;
  const dialog = openDeckCardSynergies(7, item, { onChanged() { refreshes++; } });
  await ui.respond(0, groups);
  dialog.querySelector('[data-card-synergy-id="12"]').checked = true;
  dialog.querySelector('form').dispatch('submit');
  assert.deepEqual(ui.writes()[0].body, { synergyIds: [11, 12] });
  await ui.respond(1, 'Een gekozen synergie is intussen verwijderd.', 409);
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, true);
  assert.equal(dialog.querySelector('[data-card-synergy-error]').hidden, false);
  assert.match(dialog.querySelector('[data-card-synergy-error]').textContent, /intussen verwijderd/);
  assert.equal(refreshes, 0);
  dialog.querySelector('form').dispatch('submit');
  assert.equal(ui.writes().length, 1);
  const retry = dialog.querySelector('[data-card-synergy-retry]');
  assert.equal(retry.hidden, false);
  assert.equal(retry.disabled, false);
  retry.click();
  assert.equal(ui.requests[2].url, '/api/read/decks/7/links');
  assert.equal(ui.requests[2].options.method, 'GET');
  await ui.respond(2, [{ ...groups[0], members: [], memberCount: 0 }, groups[2]]);
  assert.equal(dialog.querySelector('[data-card-synergy-id="12"]'), null);
  assert.equal(dialog.querySelector('[data-card-synergy-id="11"]').checked, false);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, false);
  assert.equal(retry.hidden, true);
  assert.equal(ui.writes().length, 1, 'refreshing never automatically repeats the failed write');
  dialog.querySelector('[data-card-synergy-id="11"]').checked = true;
  dialog.querySelector('form').dispatch('submit');
  assert.deepEqual(ui.writes()[1].body, { synergyIds: [11] });
  await ui.respond(3, [groups[0]]);
  assert.equal(dialog.open, false);
  assert.equal(refreshes, 1);
});
