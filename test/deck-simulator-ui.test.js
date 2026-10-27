import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderDeckSimulator } from '../public/js/views/deck-simulator.js';
import { setWriteAvailability } from '../public/js/write-access.js';
import { Element, parseHtml } from './support/dom.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function deckCard(id, name, quantity, overrides = {}) {
  const cardId = id + 100;
  return {
    id, role: 'main', quantity,
    card: {
      id: cardId, name, cardKey: `oracle:${name.toLowerCase()}`,
      scryfallId: `printing-${cardId}`, updatedAt: '2026-10-25',
      typeLine: name.includes('Forest') ? 'Basic Land — Forest' : 'Creature — Elf Druid',
      images: { normal: `https://cards.scryfall.io/normal/front/a/b/${cardId}.jpg` },
      ...overrides
    }
  };
}

const sampleDeck = () => [
  deckCard(11, 'Forest', 2),
  deckCard(12, 'Forest', 2),
  deckCard(13, 'Snow-Covered Forest', 1),
  deckCard(14, 'Llanowar Elves', 2),
  { ...deckCard(15, 'Commander', 1), role: 'commander' },
  { ...deckCard(16, 'Sideboard card', 1), role: 'sideboard' }
];

async function setup(t, cards = sampleDeck(), { tokens = () => [], nativeDialogFocus = false } = {}) {
  const keys = ['document', 'window', 'Element', 'FormData', 'HTMLButtonElement',
    'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement'];
  const originals = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const additions = ['focus', 'select', 'append', 'remove', 'contains', 'removeEventListener', 'getBoundingClientRect',
    'style', 'className', 'isConnected', 'dispatch', 'matches'];
  const oldMethods = additions.map((name) => [name, Object.getOwnPropertyDescriptor(Element.prototype, name)]);
  const oldMatches = Element.prototype.matches;
  let dispose;
  t.after(() => {
    dispose?.();
    setWriteAvailability(false);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    for (const [name, descriptor] of oldMethods) {
      if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
      else delete Element.prototype[name];
    }
  });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  t.mock.method(Math, 'random', () => 0.999999);
  Element.prototype.focus = function () {
    if (globalThis.document.activeElement === this) return;
    globalThis.document.activeElement?.dispatch('blur');
    this.focused = true;
    globalThis.document.activeElement = this;
    this.dispatch('focus');
  };
  Element.prototype.select = function () {
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
    this.selectionCalls = (this.selectionCalls || 0) + 1;
  };
  const append = function (child) { child.parentElement = this; this.children.push(child); };
  const remove = function () {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  };
  Element.prototype.append = append;
  Element.prototype.remove = remove;
  Element.prototype.contains = function (child) {
    for (let node = child; node; node = node.parentElement) if (node === this) return true;
    return false;
  };
  Element.prototype.removeEventListener = function (type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== callback));
  };
  Element.prototype.getBoundingClientRect = () => ({ left: 20, top: 20, right: 132, bottom: 176, width: 112, height: 156 });
  Object.defineProperties(Element.prototype, {
    style: { configurable: true, get() { return this._style ||= {}; }, set(value) { this._style = value; } },
    className: { configurable: true, get() { return this.attributes.class || ''; }, set(value) { this.attributes.class = value; } },
    isConnected: { configurable: true, get() { return globalThis.document?.contains(this) || false; } }
  });
  Element.prototype.matches = function (selector) {
    return selector.split(',').some((part) => {
      if (part.includes(':not(:disabled)')) {
        if (this.disabled) return false;
        part = part.replace(':not(:disabled)', '');
      }
      if (part.includes(':disabled')) {
        if (!this.disabled) return false;
        part = part.replace(':disabled', '');
      }
      return oldMatches.call(this, part);
    });
  };
  Element.prototype.dispatch = function (type, details = {}) {
    let stopped = false;
    const event = {
      type, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { stopped = true; },
      ...details
    };
    const path = [];
    for (let node = this; node; node = node.parentElement) path.push(node);
    for (const node of path) {
      event.currentTarget = node;
      for (const listener of [...(node.listeners.get(type) || [])]) listener(event);
      if (stopped || type === 'close' || type === 'cancel') break;
    }
    if (type === 'cancel' && !event.defaultPrevented) this.close();
    return event;
  };
  const document = parseHtml('<main id="app"></main>');
  document.documentElement = document;
  document.body = document;
  document.append = append;
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.createElement = (tag) => {
    const element = new Element(tag);
    element.append = append;
    element.remove = remove;
    element.showModal = () => {
      element.open = true;
      if (nativeDialogFocus) element.querySelector('input')?.focus();
    };
    element.close = () => { if (!element.open) return; element.open = false; element.dispatch('close'); };
    return element;
  };
  globalThis.document = document;
  const storageWrites = [];
  const storage = { getItem: () => null, setItem: (...args) => storageWrites.push(args), removeItem() {} };
  globalThis.window = Object.assign(new EventTarget(), {
    location: { hash: '#/decks/7/simulate' }, sessionStorage: storage, localStorage: storage,
    innerWidth: 1280, innerHeight: 900,
    setTimeout: (...args) => setTimeout(...args)
  });
  globalThis.FormData = class {
    constructor(form) {
      this.values = form.elements.filter((field) => field.name && !field.disabled
        && (!['checkbox', 'radio'].includes(field.type) || field.checked))
        .map((field) => [field.name, field.value]);
    }
    get(name) { return this.values.find(([key]) => key === name)?.[1] ?? null; }
    getAll(name) { return this.values.filter(([key]) => key === name).map(([, value]) => value); }
    entries() { return this.values[Symbol.iterator](); }
    [Symbol.iterator]() { return this.entries(); }
  };
  for (const key of keys.filter((key) => key.includes('Element'))) globalThis[key] = Element;
  setWriteAvailability(false);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET' });
    if (String(url) === '/api/read/decks/7') return Response.json({ data: { id: 7, name: 'Forest test', format: 'Commander' } });
    if (String(url) === '/api/read/decks/7/cards') return Response.json({ data: cards });
    const tokenMatch = String(url).match(/^\/api\/read\/cards\/(\d+)\/tokens$/);
    if (tokenMatch) {
      const response = await tokens(Number(tokenMatch[1]), options);
      return response instanceof Response ? response : Response.json({ data: response });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const app = document.getElementById('app');
  async function open() {
    dispose?.();
    const view = await renderDeckSimulator({ params: { id: '7' }, query: new URLSearchParams() });
    // The small test parser treats every literal '<' as a tag opener; browsers
    // correctly render the existing '<-' back label as text.
    app.innerHTML = view.html.replace('<- ', '&lt;- ');
    dispose = view.mount();
  }
  await open();
  const root = () => document.getElementById('deck-simulator-root');
  const zone = (name) => root().querySelector(`[data-sim-dropzone="${name}"]`);
  const instance = (id) => root().querySelector(`[data-sim-instance="${id}"]`);
  const instances = (name) => (name ? zone(name) : root()).querySelectorAll('[data-sim-instance]');
  const drag = (source, target) => {
    assert.ok(source, 'drag source exists');
    const dataTransfer = { setData() {} };
    source.dispatch('dragstart', { dataTransfer });
    zone(target).dispatch('dragover', { dataTransfer });
    zone(target).dispatch('drop', { dataTransfer });
  };
  const zoneCount = (name) => Number(zone(name).getAttribute('data-sim-count'));
  const libraryCount = () => zoneCount('library');
  const allToBattlefield = () => {
    while (libraryCount()) drag(root().querySelector('[data-sim-library-source]'), 'battlefield');
    for (const id of instances('hand').map((card) => card.dataset.simInstance)) drag(instance(id), 'battlefield');
  };
  const cloneForTouch = (source) => {
    source.cloneNode = () => {
      const ghost = new Element(source.tagName, { ...source.attributes });
      ghost.style = {};
      ghost.remove = remove;
      return ghost;
    };
    return source;
  };
  return {
    app, document, requests, storageWrites, root, zone, instance, instances, drag,
    libraryCount, zoneCount, allToBattlefield, open, cloneForTouch, dispose: () => dispose?.(),
    libraryAction(action) {
      root().querySelector('[data-sim-library-source]').dispatch('contextmenu', { clientX: 30, clientY: 50 });
      const button = document.querySelector(`[data-sim-library-action="${action}"]`);
      assert.ok(button, `library action ${action} exists`);
      button.click();
    },
    revealed: () => document.querySelectorAll('[data-sim-revealed-instance]'),
    revealMove(id, target) {
      const card = document.querySelector(`[data-sim-revealed-instance="${id}"]`);
      assert.ok(card, `revealed card ${id} exists`);
      card.dispatch('contextmenu', { clientX: 100, clientY: 100 });
      const button = document.querySelector(`[data-sim-reveal-target="${target}"]`);
      assert.ok(button, `revealed card destination ${target} exists`);
      button.click();
    },
    stacks: () => zone('battlefield').querySelectorAll('.simulator-card-stack'),
    tick: (milliseconds) => t.mock.timers.tick(milliseconds)
  };
}

function assertUniqueInstances(ui, expected) {
  const ids = ui.instances().map((card) => card.dataset.simInstance);
  assert.equal(new Set(ids).size, ids.length, 'every visible physical copy occurs only once');
  for (const zone of ['library', 'graveyard', 'exile']) {
    assert.equal(Number(ui.zone(zone).querySelector('.library-pile-count').textContent), ui.zoneCount(zone), `${zone} badge follows its current count`);
  }
  for (const stack of ui.stacks()) {
    const count = Number(stack.dataset.simStackCount);
    assert.equal(stack.querySelectorAll('[data-sim-instance]').length, 1, 'one action target represents every stack');
    assert.equal(stack.querySelectorAll('img').length, 1, 'one image per stack, independent of quantity');
    const badge = stack.querySelector('.simulator-stack-count');
    if (count > 1) assert.equal(Number(badge?.textContent), count, 'stack badge counts every actual instance');
    else assert.equal(badge, null, 'a single card needs no stack badge');
  }
  assert.equal(ui.stacks().reduce((total, stack) => total + Number(stack.dataset.simStackCount), 0), ui.zoneCount('battlefield'), 'stack counts represent all battlefield copies');
  assert.equal(['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'].reduce((total, zone) => total + ui.zoneCount(zone), 0), expected, 'no copies lost or created across all zones, including cards hidden beneath piles');
}

test('goldfishing opens without the sidebar, end-turn or header library buttons and exposes exile', async (t) => {
  const ui = await setup(t);
  assert.match(ui.app.innerHTML, /<h1>[^<]*Goldfishing[^<]*<\/h1>/i);
  assert.equal(ui.root().querySelector('.simulator-information'), null);
  for (const label of ['Huidige beurt', 'Beschikbare mana op tafel', 'Deckzoekfuncties', "Combo's en synergieen", 'Acties deze beurt']) {
    assert.ok(!ui.root().textContent.includes(label), `${label} sidebar removed`);
  }
  assert.equal(ui.root().querySelector('[data-sim-end-turn]'), null);
  for (const id of ['sim-end-turn', 'sim-search-library', 'sim-shuffle-library']) assert.equal(ui.document.getElementById(id), null);
  assert.equal(ui.instances('exile').length, 0);
  assert.equal(ui.document.querySelector('.simulator-metrics'), null);
  assert.equal(ui.root().textContent.replace(/[\d\s]/g, ''), '', 'playfield shows numeric badges without text headings');
  assert.equal(ui.root().querySelector('header'), null);
  assert.equal(ui.root().querySelector('h3'), null);
  for (const zone of ['library', 'graveyard', 'exile']) assert.equal(ui.zone(zone).querySelector('.library-pile-count').textContent, '0');
  assert.ok(ui.zone('exile').getAttribute('aria-label').includes('Exile'));
  assert.equal(ui.instances('hand').length, 7);
  assert.equal(ui.instances('command').length, 1);
  assert.equal(ui.instances().some((card) => card.dataset.simInstance === '16:1'), false, 'sideboard excluded');
  assert.deepEqual(ui.requests, [
    { url: '/api/read/decks/7', method: 'GET' },
    { url: '/api/read/decks/7/cards', method: 'GET' }
  ]);
});

const stackSize = (card) => Number(card.closest('.simulator-card-stack').dataset.simStackCount);
const stackSizes = (ui) => ui.stacks().map((stack) => Number(stack.dataset.simStackCount)).sort((a, b) => a - b);

test('same battlefield cards use one image per stack across printings while every physical copy remains in state', async (t) => {
  const cards = sampleDeck();
  const original = structuredClone(cards);
  const ui = await setup(t, cards);
  assert.equal(ui.zone('hand').querySelector('.simulator-card-stack'), null);
  ui.allToBattlefield();
  assert.equal(ui.stacks().length, 3, 'Forest, Snow-Covered Forest and Llanowar Elves have separate groups');
  const forest = ui.instance('12:2').closest('.simulator-card-stack');
  assert.equal(forest.querySelectorAll('[data-sim-instance]').length, 1);
  assert.equal(ui.instance('11:1'), null, 'buried copies have no image or action target');
  assert.notEqual(ui.instance('13:1').closest('.simulator-card-stack'), forest);
  assert.equal(forest.querySelector('.simulator-stack-count').textContent, '4');
  assert.match(forest.getAttribute('aria-label'), /4/);
  assert.match(ui.instance('12:2').querySelector('img').getAttribute('src'), /\/cards\/112\/image/);
  assert.ok(ui.instances('battlefield').every((card) => card.getAttribute('draggable') === 'true' && card.getAttribute('tabindex') === '0'));
  assert.equal(ui.zone('command').querySelector('.simulator-card-stack'), null);
  assertUniqueInstances(ui, 8);
  while (ui.zoneCount('battlefield')) ui.drag(ui.instances('battlefield')[0], 'hand');
  assert.equal(ui.instances('hand').length, 7, 'every physical copy is recoverable');
  assert.match(ui.instance('11:1').querySelector('img').getAttribute('src'), /\/cards\/111\/image/);
  assert.deepEqual(cards, original, 'rendering and moving cannot change fetched deck/card records');
});

test('tapping stack representatives splits one copy and restores focus when it rejoins a stack', async (t) => {
  const ui = await setup(t);
  ui.allToBattlefield();
  ui.tick(450);
  ui.instance('12:2').click();
  assert.ok(ui.instance('12:2').classList.contains('tapped'));
  assert.ok(!ui.instance('12:1').classList.contains('tapped'));
  assert.equal(stackSize(ui.instance('12:2')), 1);
  assert.equal(stackSize(ui.instance('12:1')), 3);
  ui.instance('12:1').dispatch('keydown', { key: ' ' });
  assert.equal(ui.instance('12:2').focused, true, 'focus follows the merged stack representative');
  assert.equal(ui.instance('12:1'), null, 'two tapped copies share one image');
  assert.equal(stackSize(ui.instance('12:2')), 2);
  ui.instance('12:2').dispatch('keydown', { key: ' ' });
  assert.ok(!ui.instance('12:2').classList.contains('tapped'));
  assert.ok(ui.instance('12:1').classList.contains('tapped'));
  ui.instance('12:1').dispatch('keydown', { key: ' ' });
  assert.ok(ui.instances('battlefield').every((card) => !card.classList.contains('tapped')));
  assert.equal(stackSize(ui.instance('12:2')), 4);
  assert.equal(ui.instance('12:2').focused, true);
  assertUniqueInstances(ui, 8);
});

test('stack identity handles older printing IDs and missing IDs without mixing different Oracle cards', async (t) => {
  const ui = await setup(t, [
    deckCard(41, 'Forest', 1, { cardKey: 'old-print-a', scryfallId: 'old-print-a' }),
    deckCard(42, ' Forest ', 1, { cardKey: 'old-print-b', scryfallId: 'old-print-b' }),
    deckCard(43, 'forest', 1, { cardKey: null, scryfallId: null, typeLine: 'Basic Land — Forest' }),
    deckCard(44, 'Identical display name', 1, { cardKey: 'printing-a', oracleId: 'oracle-one' }),
    deckCard(45, 'Identical display name', 1, { cardKey: 'printing-b', oracleId: 'oracle-one' }),
    deckCard(46, 'Identical display name', 1, { cardKey: 'printing-c', oracleId: 'oracle-two' })
  ]);
  ui.allToBattlefield();
  assert.equal(ui.stacks().length, 3);
  assert.equal(stackSize(ui.instance('43:1')), 3);
  assert.equal(stackSize(ui.instance('45:1')), 2);
  assert.equal(stackSize(ui.instance('46:1')), 1);
  assertUniqueInstances(ui, 6);
});

test('dragging a stack moves exactly one copy and preserves its printing through every zone', async (t) => {
  const ui = await setup(t);
  ui.allToBattlefield();
  ui.drag(ui.instance('12:2'), 'hand');
  ui.drag(ui.instance('12:1'), 'hand');
  const id = '11:2';
  ui.tick(450);
  ui.instance(id).click();
  ui.drag(ui.instance(id), 'graveyard');
  assert.equal(ui.zoneCount('battlefield'), 4);
  assert.equal(ui.instances('graveyard').length, 1);
  assert.equal(ui.instance(id).dataset.simSourceZone, 'graveyard');
  assert.equal(ui.zone('graveyard').querySelector('.simulator-card-stack'), null);
  assert.ok(!ui.instance(id).classList.contains('tapped'));
  ui.drag(ui.instance(id), 'library');
  assert.equal(ui.libraryCount(), 1);
  assert.equal(ui.instance(id), null);
  ui.root().querySelector('[data-sim-library-source]').dispatch('dblclick');
  assert.equal(ui.instance(id).dataset.simSourceZone, 'hand');
  assert.match(ui.instance(id).querySelector('img').getAttribute('src'), /\/cards\/111\/image/);
  ui.drag(ui.instance(id), 'battlefield');
  assert.equal(stackSize(ui.instance('11:1')), 2);
  assertUniqueInstances(ui, 8);
});

test('large land groups render one image and do not lose copies when tapping or moving representatives', async (t) => {
  const ui = await setup(t, [deckCard(21, 'Forest', 13)]);
  ui.allToBattlefield();
  assert.deepEqual(stackSizes(ui), [13]);
  assert.equal(ui.instances('battlefield').length, 1);
  const firstId = ui.instances('battlefield')[0].dataset.simInstance;
  ui.tick(450);
  ui.instance(firstId).click();
  const secondId = ui.instances('battlefield').find((card) => card.dataset.simInstance !== firstId).dataset.simInstance;
  ui.drag(ui.instance(secondId), 'graveyard');
  assert.deepEqual(stackSizes(ui), [1, 11]);
  assert.ok(ui.instance(firstId).classList.contains('tapped'));
  ui.tick(450);
  ui.instance(firstId).click();
  ui.drag(ui.instance(secondId), 'battlefield');
  assertUniqueInstances(ui, 13);
  assert.deepEqual(stackSizes(ui), [13]);
});

test('zoom uses the visible representative printing and drag does not open an accidental zoom', async (t) => {
  const ui = await setup(t, [deckCard(11, 'Llanowar Elves', 2), deckCard(12, 'Llanowar Elves', 2)]);
  ui.allToBattlefield();
  ui.instance('12:2').click();
  ui.tick(350);
  assert.equal(ui.document.querySelector('dialog'), null, 'post-drag click is suppressed');
  ui.tick(100);
  ui.instance('12:2').click();
  ui.tick(320);
  let dialog = ui.document.querySelector('dialog');
  assert.ok(dialog);
  assert.match(dialog.querySelector('img').getAttribute('src'), /\/cards\/112\/image\?face=front&size=large/);
  dialog.close();
  ui.drag(ui.instance('12:2'), 'hand');
  ui.drag(ui.instance('12:1'), 'hand');
  ui.instance('11:2').dispatch('keydown', { key: 'Enter' });
  dialog = ui.document.querySelector('dialog');
  assert.match(dialog.querySelector('img').getAttribute('src'), /\/cards\/111\/image\?face=front&size=large/);
  assertUniqueInstances(ui, 4);
});

test('touch dragging a stack moves only its representative instance', async (t) => {
  const ui = await setup(t);
  ui.allToBattlefield();
  const source = ui.cloneForTouch(ui.instance('12:2'));
  ui.document.elementFromPoint = () => ui.zone('graveyard');
  source.dispatch('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 20, clientY: 20 });
  ui.tick(220);
  ui.root().dispatch('pointermove', { pointerType: 'touch', pointerId: 7, clientX: 100, clientY: 100 });
  ui.root().dispatch('pointerup', { pointerType: 'touch', pointerId: 7, clientX: 100, clientY: 100 });
  assert.equal(ui.instance('12:2').dataset.simSourceZone, 'graveyard');
  assert.equal(ui.instance('12:1').dataset.simSourceZone, 'battlefield');
  assert.equal(stackSize(ui.instance('12:1')), 3);
  assert.equal(ui.instances('graveyard').length, 1);
  assert.equal(ui.document.body.classList.contains('simulator-touch-dragging'), false);
  assertUniqueInstances(ui, 8);
});

test('the library search still moves an exact printing into a stack after sidebar removal', async (t) => {
  const ui = await setup(t, [deckCard(51, 'Forest', 8), deckCard(52, 'Llanowar Elves', 8)]);
  ui.libraryAction('search');
  const dialog = ui.document.querySelector('dialog');
  const search = dialog.querySelector('#sim-library-filter');
  search.value = 'llanowar';
  search.dispatch('input');
  const choices = dialog.querySelectorAll('[data-library-search-row]');
  assert.ok(choices.filter((card) => card.dataset.libraryInstance.startsWith('51:')).every((card) => card.hidden));
  const selected = choices.find((card) => card.dataset.libraryInstance.startsWith('52:'));
  assert.ok(selected && !selected.hidden);
  const selectedId = selected.dataset.libraryInstance;
  selected.click();
  dialog.querySelector('[data-library-dialog-target="battlefield"]').click();
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.equal(ui.instance(selectedId).dataset.simSourceZone, 'battlefield');
  assert.match(ui.instance(selectedId).querySelector('img').getAttribute('src'), /\/cards\/152\/image/);
  assert.equal(ui.libraryCount(), 8);
  assertUniqueInstances(ui, 16);
});

test('goldfishing remains temporary and fully usable in read-only mode, including reset', async (t) => {
  const ui = await setup(t, [deckCard(31, 'Forest', 10)]);
  ui.allToBattlefield();
  ui.tick(450);
  ui.instances('battlefield')[0].click();
  ui.document.getElementById('sim-reset').click();
  const dialog = ui.document.querySelector('dialog');
  assert.equal(dialog.querySelector('[data-write-action]'), null);
  dialog.querySelector('form').dispatch('submit');
  await flush();
  assert.equal(ui.instances('battlefield').length, 0);
  assert.equal(ui.instances('hand').length, 7);
  assert.equal(ui.libraryCount(), 3);
  ui.allToBattlefield();
  await ui.open();
  assert.equal(ui.instances('battlefield').length, 0, 'reopening starts a fresh game');
  assert.equal(ui.instances('hand').length, 7);
  assert.equal(ui.libraryCount(), 3);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
  assert.equal(ui.storageWrites.length, 0);
  assertUniqueInstances(ui, 10);
});

const orderedDeck = (quantity = 12) => Array.from({ length: quantity }, (_, index) =>
  deckCard(61 + index, `Ordered card ${61 + index}`, 1));
const revealedIds = (ui) => ui.revealed().map((card) => card.dataset.simRevealedInstance);
const revealControl = (ui, attribute) => {
  const button = ui.document.querySelector(`[${attribute}]`);
  assert.ok(button, `${attribute} is available`);
  return button;
};
const finishReveal = (ui, method) => {
  assert.equal(ui.document.querySelector('[data-sim-reveal-return]'), null, 'return choices are direct buttons, not a dropdown');
  const button = ui.document.querySelector(`[data-sim-reveal-finish="${method}"]`);
  assert.ok(button, `direct return action ${method} exists`);
  button.click();
};
const millAll = (ui) => {
  const milled = [];
  while (ui.libraryCount()) {
    ui.libraryAction('mill');
    milled.push(ui.instances('graveyard')[0].dataset.simInstance);
  }
  return milled;
};

test('library peek toggles the current top printing inline and follows mill without a popup', async (t) => {
  const cards = orderedDeck();
  const original = structuredClone(cards);
  const ui = await setup(t, cards);
  const library = () => ui.root().querySelector('[data-sim-library-source]');
  assert.equal(ui.libraryCount(), 5);
  assert.equal(library().querySelector('img'), null);
  ui.libraryAction('peek');
  assert.equal(ui.document.querySelector('dialog'), null, 'showing top does not open a popup');
  assert.match(library().querySelector('img').getAttribute('src'), /\/cards\/165\/image/);
  assert.equal(ui.document.activeElement, library(), 'focus follows the updated library pile');
  library().dispatch('contextmenu', { clientX: 30, clientY: 50 });
  assert.equal(ui.document.querySelector('[data-sim-library-action="peek"]').textContent.trim().endsWith('Verberg bovenste kaart'), true);
  ui.libraryAction('mill');
  assert.equal(ui.libraryCount(), 4);
  assert.equal(ui.instances('graveyard')[0].dataset.simInstance, '65:1');
  assert.match(library().querySelector('img').getAttribute('src'), /\/cards\/164\/image/);
  ui.libraryAction('mill');
  assert.equal(ui.libraryCount(), 3);
  assert.equal(ui.zoneCount('graveyard'), 2);
  assert.equal(ui.instances('graveyard').length, 1, 'graveyard displays only its top copy');
  assert.equal(ui.instances('graveyard')[0].dataset.simInstance, '64:1');
  assert.match(library().querySelector('img').getAttribute('src'), /\/cards\/163\/image/);
  ui.libraryAction('peek');
  assert.equal(library().querySelector('img'), null, 'hiding returns the library back');
  assert.equal(ui.document.querySelector('dialog'), null);
  assertUniqueInstances(ui, 12);
  assert.deepEqual(cards, original);
});

test('revealing plus and minus inspects an ordered prefix without moving or duplicating library cards', async (t) => {
  const ui = await setup(t, orderedDeck());
  ui.libraryAction('reveal');
  assert.deepEqual(revealedIds(ui), ['65:1']);
  revealControl(ui, 'data-sim-reveal-more').click();
  revealControl(ui, 'data-sim-reveal-more').click();
  assert.deepEqual(revealedIds(ui), ['65:1', '64:1', '63:1']);
  revealControl(ui, 'data-sim-reveal-less').click();
  assert.deepEqual(revealedIds(ui), ['65:1', '64:1']);
  revealControl(ui, 'data-sim-reveal-more').click();
  assert.deepEqual(revealedIds(ui), ['65:1', '64:1', '63:1']);
  assert.equal(ui.libraryCount(), 5, 'looked-at cards still belong to the library');
  assertUniqueInstances(ui, 12);
  finishReveal(ui, 'top');
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.deepEqual(millAll(ui), ['65:1', '64:1', '63:1', '62:1', '61:1']);
  assertUniqueInstances(ui, 12);
});

test('revealed card menus live inside the modal and move exact copies to all four destinations once', async (t) => {
  const ui = await setup(t, orderedDeck());
  ui.libraryAction('reveal');
  for (let index = 0; index < 3; index += 1) revealControl(ui, 'data-sim-reveal-more').click();
  const dialog = ui.document.querySelector('dialog');
  const destinations = ['hand', 'battlefield', 'graveyard', 'exile'];
  for (const [index, target] of destinations.entries()) {
    const id = `${65 - index}:1`;
    const card = ui.document.querySelector(`[data-sim-revealed-instance="${id}"]`);
    card.dispatch('contextmenu', { clientX: 40, clientY: 60 });
    const button = ui.document.querySelector(`[data-sim-reveal-target="${target}"]`);
    assert.equal(button.closest('dialog'), dialog, 'context menu stays in the modal top layer');
    button.click();
    button.click(); // A stale/double activation must not repeat a completed move.
    assert.equal(ui.instance(id).dataset.simSourceZone, target);
    assert.match(ui.instance(id).querySelector('img').getAttribute('src'), new RegExp(`/cards/${165 - index}/image`));
    assert.ok(!revealedIds(ui).includes(id));
    assertUniqueInstances(ui, 12);
  }
  assert.equal(ui.libraryCount(), 1);
  assert.equal(ui.revealed().length, 0);
  assert.equal(ui.instances('exile').length, 1);
  finishReveal(ui, 'top');
  assert.equal(ui.document.querySelector('dialog'), null);
  assertUniqueInstances(ui, 12);
});

for (const [method, expected] of [
  ['top', ['65:1', '63:1', '62:1', '61:1']],
  ['bottom', ['62:1', '61:1', '65:1', '63:1']]
]) {
  test(`returning remaining revealed cards to ${method} preserves draw order after moving a middle card`, async (t) => {
    const ui = await setup(t, orderedDeck());
    ui.libraryAction('reveal');
    revealControl(ui, 'data-sim-reveal-more').click();
    revealControl(ui, 'data-sim-reveal-more').click();
    ui.revealMove('64:1', 'exile');
    assert.deepEqual(revealedIds(ui), ['65:1', '63:1']);
    finishReveal(ui, method);
    assert.equal(ui.document.querySelector('dialog'), null);
    assert.equal(ui.libraryCount(), 4);
    assert.deepEqual(millAll(ui), expected);
    assert.equal(ui.instance('64:1').dataset.simSourceZone, 'exile');
    assertUniqueInstances(ui, 12);
  });
}

test('Shuffle in library shuffles the complete remaining library and retains each instance once', async (t) => {
  const ui = await setup(t, orderedDeck());
  ui.libraryAction('reveal');
  revealControl(ui, 'data-sim-reveal-more').click();
  t.mock.method(Math, 'random', () => 0);
  finishReveal(ui, 'shuffle');
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.deepEqual(millAll(ui), ['61:1', '65:1', '64:1', '63:1', '62:1']);
  assertUniqueInstances(ui, 12);
});

for (const closing of ['close', 'cancel']) {
  test(`${closing} returns uncommitted revealed cards to their original order without undoing explicit moves`, async (t) => {
    const ui = await setup(t, orderedDeck());
    ui.libraryAction('reveal');
    revealControl(ui, 'data-sim-reveal-more').click();
    revealControl(ui, 'data-sim-reveal-more').click();
    ui.revealMove('64:1', 'hand');
    const dialog = ui.document.querySelector('dialog');
    if (closing === 'cancel') dialog.dispatch('cancel');
    else dialog.querySelector('.close-dialog').click();
    assert.equal(ui.document.querySelector('dialog'), null);
    assert.deepEqual(millAll(ui), ['65:1', '63:1', '62:1', '61:1']);
    assert.equal(ui.instance('64:1').dataset.simSourceZone, 'hand');
    assertUniqueInstances(ui, 12);
  });
}

test('reveal controls stop at both ends and an empty library cannot move a nonexistent card', async (t) => {
  const ui = await setup(t, orderedDeck());
  ui.libraryAction('reveal');
  for (let index = 0; index < 7; index += 1) revealControl(ui, 'data-sim-reveal-more').click();
  assert.equal(ui.revealed().length, 5);
  assert.equal(revealControl(ui, 'data-sim-reveal-more').disabled, true);
  for (let index = 0; index < 7; index += 1) revealControl(ui, 'data-sim-reveal-less').click();
  assert.equal(ui.revealed().length, 0);
  assert.equal(revealControl(ui, 'data-sim-reveal-less').disabled, true);
  finishReveal(ui, 'bottom');
  assert.deepEqual(millAll(ui), ['65:1', '64:1', '63:1', '62:1', '61:1']);
  for (const action of ['peek', 'mill', 'reveal']) {
    ui.libraryAction(action);
    assert.equal(ui.libraryCount(), 0);
    assert.equal(ui.document.querySelector('dialog'), null);
  }
  assertUniqueInstances(ui, 12);
});

test('disposing or reopening the screen closes reveal menus and makes old controls inert', async (t) => {
  const ui = await setup(t, orderedDeck());
  ui.libraryAction('reveal');
  const oldMore = revealControl(ui, 'data-sim-reveal-more');
  const oldFinish = revealControl(ui, 'data-sim-reveal-finish');
  const oldCard = ui.revealed()[0];
  oldCard.dispatch('contextmenu', { clientX: 40, clientY: 50 });
  const oldMove = ui.document.querySelector('[data-sim-reveal-target="exile"]');
  await ui.open();
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.equal(ui.document.querySelector('[data-sim-reveal-target]'), null);
  oldMore.click();
  oldFinish.click();
  oldMove.click();
  assert.equal(ui.libraryCount(), 5);
  assert.equal(ui.instances('exile').length, 0);
  assertUniqueInstances(ui, 12);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
  assert.equal(ui.storageWrites.length, 0);
});

test('exile is an independent drag target and cards can return without affecting graveyard', async (t) => {
  const ui = await setup(t);
  ui.drag(ui.instance('11:1'), 'graveyard');
  ui.drag(ui.instance('12:1'), 'exile');
  assert.deepEqual(ui.instances('graveyard').map((card) => card.dataset.simInstance), ['11:1']);
  assert.deepEqual(ui.instances('exile').map((card) => card.dataset.simInstance), ['12:1']);
  ui.instance('12:1').dispatch('keydown', { key: 'Enter' });
  const dialog = ui.document.querySelector('dialog');
  assert.match(dialog.querySelector('img').getAttribute('src'), /\/cards\/112\/image/);
  dialog.close();
  ui.drag(ui.instance('12:1'), 'hand');
  assert.equal(ui.instances('exile').length, 0);
  assert.equal(ui.instances('graveyard').length, 1);
  assertUniqueInstances(ui, 8);
});

test('library and revealed-card context menus support keyboard navigation and Escape without closing the preview', async (t) => {
  const ui = await setup(t, orderedDeck());
  const library = ui.root().querySelector('[data-sim-library-source]');
  library.dispatch('keydown', { key: 'Enter' });
  const peek = ui.document.querySelector('[data-sim-library-action="peek"]');
  assert.equal(ui.document.activeElement, peek);
  ui.document.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(ui.document.activeElement, ui.document.querySelector('[data-sim-library-action="mill"]'));
  ui.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(ui.document.querySelector('[data-sim-library-action]'), null);
  assert.equal(ui.document.activeElement, library);
  ui.libraryAction('reveal');
  const dialog = ui.document.querySelector('dialog');
  const card = ui.revealed()[0];
  card.dispatch('keydown', { key: 'F10', shiftKey: true });
  assert.ok(ui.document.querySelector('[data-sim-reveal-target="hand"]'));
  const escape = ui.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(ui.document.querySelector('[data-sim-reveal-target]'), null);
  assert.equal(ui.document.querySelector('dialog'), dialog);
  assert.equal(dialog.open, true);
  assert.equal(ui.document.activeElement, card);
  dialog.dispatch('cancel');
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.equal(ui.libraryCount(), 5);
  assertUniqueInstances(ui, 12);
});

test('scrolling within a context menu keeps it open while scrolling the surrounding viewport closes it', async (t) => {
  const ui = await setup(t, orderedDeck());
  ui.root().querySelector('[data-sim-library-source]').dispatch('contextmenu', { clientX: 30, clientY: 50 });
  const menuItem = ui.document.querySelector('[data-sim-library-action="peek"]');
  assert.ok(menuItem);
  const internalScroll = new Event('scroll');
  Object.defineProperty(internalScroll, 'target', { value: menuItem });
  window.dispatchEvent(internalScroll);
  assert.equal(ui.document.querySelector('[data-sim-library-action="peek"]'), menuItem);
  window.dispatchEvent(new Event('scroll'));
  assert.equal(ui.document.querySelector('[data-sim-library-action]'), null);
  assert.equal(ui.libraryCount(), 5);
  assertUniqueInstances(ui, 12);
});


test('battlefield areas classify front-face card types exactly once without treating subtypes as types', async (t) => {
  const definitions = [
    ['Basic Land — Forest', 'lands'],
    ['Creature — Elf Druid', 'creatures'],
    ['Enchantment — Aura', 'enchantments'],
    ['Artifact — Equipment', 'artifacts'],
    ['Artifact Creature — Golem', 'creatures'],
    ['Enchantment Creature — Dryad', 'creatures'],
    ['Artifact Land', 'lands'],
    ['Land Creature — Forest Dryad', 'lands'],
    ['Enchantment Artifact', 'artifacts'],
    ['Instant — Land', 'other'],
    ['Legendary Enchantment — Creature', 'enchantments'],
    ['Planeswalker — Nissa', 'other'],
    ['', 'other']
  ];
  const cards = definitions.map(([typeLine], index) => deckCard(201 + index, `Type ${index}`, 1, { typeLine }));
  cards.push(deckCard(220, 'Front sorcery, back land', 1, {
    typeLine: 'Sorcery // Land', cardFaces: [{ typeLine: 'Sorcery' }, { typeLine: 'Land' }]
  }));
  cards.push(deckCard(221, 'Legacy front land', 1, {
    typeLine: '', cardFaces: [{ type_line: 'Land — Forest' }, { type_line: 'Creature — Elf' }]
  }));
  const original = structuredClone(cards);
  const ui = await setup(t, cards);
  ui.allToBattlefield();
  for (const [index, [, area]] of definitions.entries()) {
    assert.equal(ui.instance(`${201 + index}:1`).closest('[data-sim-battlefield-area]').dataset.simBattlefieldArea, area);
  }
  assert.equal(ui.instance('220:1').closest('[data-sim-battlefield-area]').dataset.simBattlefieldArea, 'other');
  assert.equal(ui.instance('221:1').closest('[data-sim-battlefield-area]').dataset.simBattlefieldArea, 'lands');
  const main = ui.zone('battlefield').querySelector('.simulator-battlefield-main');
  assert.deepEqual(main.querySelectorAll('[data-sim-battlefield-area]').map((area) => area.dataset.simBattlefieldArea), ['creatures', 'other', 'lands']);
  const side = ui.zone('battlefield').querySelector('.simulator-battlefield-side');
  assert.deepEqual(side.querySelectorAll('[data-sim-battlefield-area]').map((area) => area.dataset.simBattlefieldArea), ['enchantments', 'artifacts']);
  assertUniqueInstances(ui, cards.length);
  assert.deepEqual(cards, original, 'placing cards by type changes no source metadata');
});

test('inline library visibility follows draw, shuffle and return actions, can hide an empty pile, and resets', async (t) => {
  const ui = await setup(t, orderedDeck());
  const library = () => ui.root().querySelector('[data-sim-library-source]');
  const image = () => library().querySelector('img')?.getAttribute('src');
  ui.libraryAction('peek');
  library().dispatch('dblclick');
  assert.equal(ui.libraryCount(), 4);
  assert.match(image(), /\/cards\/164\/image/);
  t.mock.method(Math, 'random', () => 0);
  ui.libraryAction('shuffle');
  assert.match(image(), /\/cards\/161\/image/);
  ui.libraryAction('reveal');
  revealControl(ui, 'data-sim-reveal-more').click();
  assert.deepEqual(revealedIds(ui), ['61:1', '64:1']);
  ui.revealMove('61:1', 'exile');
  assert.match(image(), /\/cards\/164\/image/);
  finishReveal(ui, 'bottom');
  assert.match(image(), /\/cards\/163\/image/);
  assert.equal(ui.document.querySelector('dialog'), null);
  millAll(ui);
  assert.equal(image(), undefined, 'empty library has no stale face image');
  library().dispatch('contextmenu', { clientX: 30, clientY: 40 });
  let toggle = ui.document.querySelector('[data-sim-library-action="peek"]');
  assert.equal(toggle.disabled, false, 'a visible empty library can still be hidden');
  assert.match(toggle.textContent, /Verberg bovenste kaart/);
  toggle.click();
  library().dispatch('contextmenu', { clientX: 30, clientY: 40 });
  toggle = ui.document.querySelector('[data-sim-library-action="peek"]');
  assert.equal(toggle.disabled, true, 'an empty hidden library cannot show a nonexistent card');
  ui.document.dispatch('keydown', { key: 'Escape' });
  const topGrave = ui.instances('graveyard')[0];
  ui.drag(topGrave, 'library');
  assert.equal(image(), undefined, 'hiding persists when a card returns');
  ui.libraryAction('peek');
  assert.ok(image());
  ui.document.getElementById('sim-reset').click();
  ui.document.querySelector('dialog').querySelector('form').dispatch('submit');
  await flush();
  assert.equal(image(), undefined, 'reset starts with face-down library');
  assert.equal(ui.libraryCount(), 5);
  assertUniqueInstances(ui, 12);
});

test('reveal exposes three direct return buttons and stale finished buttons cannot apply a second action', async (t) => {
  const ui = await setup(t, orderedDeck());
  ui.libraryAction('reveal');
  const buttons = ui.document.querySelectorAll('[data-sim-reveal-finish]');
  assert.deepEqual(buttons.map((button) => button.dataset.simRevealFinish), ['top', 'bottom', 'shuffle']);
  assert.deepEqual(buttons.map((button) => button.textContent), ['Bovenaan library', 'Onderop library', 'Shuffle in library']);
  assert.equal(ui.document.querySelector('select'), null);
  revealControl(ui, 'data-sim-reveal-more').click();
  buttons[1].click();
  buttons[0].click();
  buttons[2].click();
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.deepEqual(millAll(ui), ['63:1', '62:1', '61:1', '65:1', '64:1']);
  assertUniqueInstances(ui, 12);
});

test('graveyard and exile show one top card but their browser retains every buried printing and moves one selected copy', async (t) => {
  const ui = await setup(t);
  for (const id of ['11:1', '12:1', '11:2']) ui.drag(ui.instance(id), 'graveyard');
  for (const id of ['14:1', '14:2', '13:1']) ui.drag(ui.instance(id), 'exile');
  for (const [zone, topId] of [['graveyard', '11:2'], ['exile', '13:1']]) {
    assert.equal(ui.zoneCount(zone), 3);
    assert.equal(ui.instances(zone).length, 1);
    const pile = ui.zone(zone).querySelector('[data-sim-zone-pile]');
    assert.equal(pile.dataset.simInstance, topId);
    assert.equal(pile.querySelector('.library-pile-count').textContent, '3');
    assert.match(pile.getAttribute('aria-label'), /3 kaarten/);
    assert.equal(pile.getAttribute('draggable'), 'true');
  }
  ui.zone('graveyard').querySelector('[data-sim-zone-pile]').dispatch('keydown', { key: 'Enter' });
  const dialog = ui.document.querySelector('[data-sim-pile-dialog="graveyard"]');
  assert.ok(dialog);
  assert.equal(dialog.querySelector('[data-write-action]'), null);
  assert.deepEqual(dialog.querySelectorAll('[data-sim-pile-card]').map((card) => card.dataset.simPileCard), ['11:2', '12:1', '11:1']);
  const selected = dialog.querySelector('[data-sim-pile-card="12:1"]');
  assert.match(selected.querySelector('img').getAttribute('src'), /\/cards\/112\/image/);
  selected.click();
  assert.equal(selected.getAttribute('aria-pressed'), 'true');
  dialog.querySelector('[data-sim-pile-zoom]').click();
  const zoom = ui.document.querySelectorAll('dialog').at(-1);
  assert.notEqual(zoom, dialog);
  assert.match(zoom.querySelector('img').getAttribute('src'), /\/cards\/112\/image\?face=front&size=large/);
  zoom.close();
  const staleHand = dialog.querySelector('[data-sim-pile-target="hand"]');
  dialog.querySelector('[data-sim-pile-target="exile"]').click();
  staleHand.click();
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.equal(ui.zoneCount('graveyard'), 2);
  assert.equal(ui.zoneCount('exile'), 4);
  assert.equal(ui.instances('exile')[0].dataset.simInstance, '12:1');
  assert.equal(ui.instance('12:1').dataset.simSourceZone, 'exile', 'stale closed-dialog action cannot move it again');
  assertUniqueInstances(ui, 8);
  ui.zone('graveyard').querySelector('[data-sim-zone-pile]').dispatch('contextmenu');
  const remaining = ui.document.querySelector('[data-sim-pile-dialog="graveyard"]');
  assert.deepEqual(remaining.querySelectorAll('[data-sim-pile-card]').map((card) => card.dataset.simPileCard), ['11:2', '11:1']);
  remaining.close();
  assertUniqueInstances(ui, 8);
});

test('buried pile cards can be dragged to a popup destination and pile double-click zooms the actual top printing', async (t) => {
  const ui = await setup(t);
  ui.drag(ui.instance('11:1'), 'graveyard');
  ui.drag(ui.instance('12:1'), 'graveyard');
  ui.zone('graveyard').querySelector('[data-sim-zone-pile]').dispatch('dblclick');
  let dialog = ui.document.querySelector('dialog');
  assert.equal(dialog.getAttribute('data-sim-pile-dialog'), null, 'double-click zooms instead of opening the pile browser');
  assert.match(dialog.querySelector('img').getAttribute('src'), /\/cards\/112\/image\?face=front&size=large/);
  dialog.close();
  ui.zone('graveyard').querySelector('[data-sim-zone-pile]').dispatch('keydown', { key: ' ' });
  dialog = ui.document.querySelector('[data-sim-pile-dialog="graveyard"]');
  const buried = dialog.querySelector('[data-sim-pile-card="11:1"]');
  const target = dialog.querySelector('[data-sim-pile-target="library"]');
  const dataTransfer = { setData() {} };
  buried.dispatch('dragstart', { dataTransfer });
  target.dispatch('dragover', { dataTransfer });
  target.dispatch('drop', { dataTransfer });
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.equal(ui.libraryCount(), 1);
  assert.equal(ui.zoneCount('graveyard'), 1);
  assert.equal(ui.instances('graveyard')[0].dataset.simInstance, '12:1');
  ui.libraryAction('peek');
  assert.match(ui.root().querySelector('[data-sim-library-source]').querySelector('img').getAttribute('src'), /\/cards\/111\/image/);
  assertUniqueInstances(ui, 8);
});

test('empty zone piles remain inspectable without fake cards, and disposed pile actions cannot change a new game', async (t) => {
  const ui = await setup(t);
  const empty = ui.zone('exile').querySelector('[data-sim-zone-pile]');
  assert.equal(empty.getAttribute('draggable'), 'false');
  assert.equal(empty.getAttribute('data-sim-instance'), null);
  empty.dispatch('keydown', { key: 'Enter' });
  let dialog = ui.document.querySelector('[data-sim-pile-dialog="exile"]');
  assert.ok(dialog);
  assert.equal(dialog.querySelectorAll('[data-sim-pile-card]').length, 0);
  assert.ok(dialog.querySelectorAll('[data-sim-pile-target]').every((button) => button.disabled));
  dialog.querySelector('[data-sim-pile-target="hand"]').click();
  assertUniqueInstances(ui, 8);
  dialog.close();
  ui.drag(ui.instance('12:1'), 'exile');
  ui.zone('exile').querySelector('[data-sim-zone-pile]').dispatch('contextmenu');
  dialog = ui.document.querySelector('[data-sim-pile-dialog="exile"]');
  const oldMove = dialog.querySelector('[data-sim-pile-target="battlefield"]');
  const oldZoom = dialog.querySelector('[data-sim-pile-zoom]');
  await ui.open();
  assert.equal(ui.document.querySelector('dialog'), null);
  oldMove.click();
  oldZoom.click();
  assert.equal(ui.zoneCount('battlefield'), 0);
  assert.equal(ui.zoneCount('exile'), 0);
  assert.equal(ui.zoneCount('hand'), 7);
  assert.equal(ui.document.querySelector('dialog'), null);
  assertUniqueInstances(ui, 8);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
  assert.equal(ui.storageWrites.length, 0);
});

const relatedToken = (overrides = {}) => ({
  scryfallId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  name: 'Badger', typeLine: 'Token Creature — Badger', oracleText: '',
  colors: ['G'], keywords: [], power: '3', toughness: '3', available: true,
  images: { normal: 'https://cards.scryfall.io/normal/front/a/b/badger.jpg' },
  ...overrides
});

async function openCardMenu(ui, id, key = null) {
  const card = ui.instance(id);
  assert.ok(card, 'card menu opener exists');
  card.dispatch(key ? 'keydown' : 'contextmenu', key
    ? { key, shiftKey: key === 'F10' }
    : { clientX: 80, clientY: 90 });
  await flush();
}

function cardAction(ui, action) {
  const button = ui.document.querySelector(`[data-sim-card-action="${action}"]`);
  assert.ok(button, `${action} action exists`);
  button.click();
  const dialog = ui.document.querySelector(`[data-sim-card-dialog="${action}"]`);
  assert.ok(dialog, `${action} dialog exists`);
  assert.equal(dialog.querySelector('[data-write-action]'), null, 'simulator action works without the write API');
  return dialog;
}

function fillDialog(dialog, values) {
  for (const [name, value] of Object.entries(values)) {
    const input = dialog.querySelector(`[name="${name}"]`);
    assert.ok(input, `${name} field exists`);
    input.value = String(value);
  }
}

async function submitDialog(dialog, values = {}) {
  fillDialog(dialog, values);
  dialog.querySelector('form').dispatch('submit');
  await flush();
}

const generatedCards = (ui, zone = 'battlefield') => ui.instances(zone)
  .filter((card) => card.dataset.simInstance.startsWith('generated:'));

test('basic land click and keyboard actions tap one copy without zoom or a second double-click toggle', async (t) => {
  const ui = await setup(t, [
    deckCard(301, 'Wastes', 2, { typeLine: 'Basic Land' }),
    deckCard(302, 'Snow-Covered Forest', 1, { typeLine: 'Basic Snow Land — Forest' }),
    deckCard(303, 'Ordinary nonbasic land', 1, { typeLine: 'Land' })
  ]);
  ui.allToBattlefield();
  ui.tick(450);
  ui.instance('301:2').dispatch('click', { detail: 1 });
  assert.ok(ui.instance('301:2').classList.contains('tapped'), 'single click taps immediately');
  assert.ok(!ui.instance('301:1').classList.contains('tapped'));
  ui.instance('301:2').dispatch('click', { detail: 2 });
  ui.instance('301:2').dispatch('dblclick');
  ui.tick(400);
  assert.ok(ui.instance('301:2').classList.contains('tapped'), 'double-click sequence does not toggle again');
  assert.equal(ui.document.querySelector('dialog'), null);
  ui.instance('301:2').dispatch('keydown', { key: 'Enter' });
  assert.ok(!ui.instance('301:2').classList.contains('tapped'));
  ui.instance('302:1').dispatch('keydown', { key: ' ' });
  assert.ok(ui.instance('302:1').classList.contains('tapped'));
  assert.equal(ui.document.querySelector('dialog'), null);
  ui.instance('303:1').click();
  ui.tick(320);
  assert.ok(ui.document.querySelector('dialog'), 'nonbasic lands retain click-to-zoom');
  assertUniqueInstances(ui, 4);
});

test('battlefield menus expose appropriate creature and noncreature actions and support keyboard dismissal', async (t) => {
  const ui = await setup(t, [
    deckCard(311, 'Creature', 1),
    deckCard(312, 'Artifact', 1, { typeLine: 'Artifact' })
  ]);
  ui.instance('311:1').dispatch('contextmenu');
  assert.equal(ui.document.querySelector('[data-sim-card-action]'), null, 'hand cards do not expose battlefield actions');
  ui.allToBattlefield();
  await openCardMenu(ui, '311:1', 'F10');
  assert.ok(ui.document.querySelector('[data-sim-card-action="counters"]'));
  assert.ok(ui.document.querySelector('[data-sim-card-action="duplicate"]'));
  assert.equal(ui.document.querySelector('[data-sim-card-action="token"]'), null, 'no related tokens means no token action');
  ui.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(ui.document.querySelector('[data-sim-card-action]'), null);
  assert.equal(ui.document.activeElement, ui.instance('311:1'));
  await openCardMenu(ui, '312:1');
  assert.equal(ui.document.querySelector('[data-sim-card-action="duplicate"]'), null);
  const dialog = cardAction(ui, 'counters');
  assert.ok(dialog.querySelector('[name="generic"]'));
  assert.equal(dialog.querySelector('[name="power"]'), null);
  assert.equal(dialog.querySelector('[name="toughness"]'), null);
  await submitDialog(dialog, { generic: 4 });
  assert.equal(ui.instance('312:1').querySelector('.simulator-card-counters').textContent.trim(), '4');
  assert.equal(ui.instance('311:1').querySelector('.simulator-card-counters'), null);
});

test('counter totals belong to a single instance, split its stack and can be reset without mutating card metadata', async (t) => {
  const cards = [deckCard(321, 'Twin', 2, { power: '2', toughness: '2' })];
  const original = structuredClone(cards);
  const ui = await setup(t, cards);
  ui.allToBattlefield();
  await openCardMenu(ui, '321:2');
  let dialog = cardAction(ui, 'counters');
  assert.equal(dialog.querySelector('[name="generic"]'), null);
  await submitDialog(dialog, { power: 2, toughness: 3 });
  assert.equal(ui.instance('321:2').querySelector('.simulator-card-counters').textContent.trim(), '+2/+3');
  assert.equal(ui.instance('321:1').querySelector('.simulator-card-counters'), null);
  assert.equal(ui.stacks().length, 2, 'different counters cannot hide in the same stack');
  await openCardMenu(ui, '321:2');
  dialog = cardAction(ui, 'counters');
  assert.equal(dialog.querySelector('[name="power"]').value, '2');
  assert.equal(dialog.querySelector('[name="toughness"]').value, '3');
  await submitDialog(dialog, { power: 0, toughness: 0 });
  assert.equal(ui.instance('321:2').querySelector('.simulator-card-counters'), null);
  assert.equal(ui.stacks().length, 1);
  assert.deepEqual(cards, original);
  assertUniqueInstances(ui, 2);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
  assert.equal(ui.storageWrites.length, 0);
});

test('duplicate validates quantity, applies once and creates independent uncountered copies in an unlimited stack', async (t) => {
  const cards = [deckCard(331, 'Copy source', 1, { power: '4', toughness: '4' })];
  const original = structuredClone(cards);
  const ui = await setup(t, cards);
  ui.allToBattlefield();
  await openCardMenu(ui, '331:1');
  await submitDialog(cardAction(ui, 'counters'), { power: 1, toughness: 2 });
  ui.instance('331:1').dispatch('dblclick');
  await openCardMenu(ui, '331:1');
  const dialog = cardAction(ui, 'duplicate');
  for (const invalid of ['0', '-1', '1.5', '1001']) {
    await submitDialog(dialog, { quantity: invalid });
    assert.equal(dialog.open, true);
    assert.equal(ui.zoneCount('battlefield'), 1, 'invalid quantity creates nothing');
  }
  fillDialog(dialog, { quantity: 8 });
  const form = dialog.querySelector('form');
  form.dispatch('submit');
  form.dispatch('submit');
  await flush();
  assert.equal(ui.zoneCount('battlefield'), 9, 'double submission still creates exactly eight copies');
  const generated = generatedCards(ui);
  assert.equal(generated.length, 1);
  assert.equal(stackSize(generated[0]), 8);
  assert.ok(generated.every((card) => !card.classList.contains('tapped')));
  assert.ok(generated.every((card) => card.querySelector('.simulator-card-counters') === null));
  assert.equal(generated[0].closest('.simulator-card-stack').querySelectorAll('img').length, 1);
  assert.equal(ui.instance('331:1').querySelector('.simulator-card-counters').textContent.trim(), '+1/+2');
  assert.match(generated[0].querySelector('img').getAttribute('src'), /\/cards\/431\/image/);
  assertUniqueInstances(ui, 9);
  assert.deepEqual(cards, original);
  assert.equal(ui.storageWrites.length, 0);
});

test('token selection creates the chosen kind and keeps generated cards usable in every library workflow', async (t) => {
  const creature = relatedToken();
  const treasure = relatedToken({
    scryfallId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    name: 'Treasure', typeLine: 'Token Artifact — Treasure', power: null, toughness: null, colors: [],
    images: { normal: 'https://cards.scryfall.io/normal/front/b/c/treasure.jpg' }
  });
  const ui = await setup(t, [deckCard(341, 'Token maker', 1)], { tokens: () => [creature, treasure] });
  ui.allToBattlefield();
  await openCardMenu(ui, '341:1');
  let dialog = cardAction(ui, 'token');
  const choices = dialog.querySelector('[name="tokenIndex"]');
  assert.equal(choices.options.length, 2);
  await submitDialog(dialog, { tokenIndex: 1, quantity: 3 });
  assert.equal(generatedCards(ui).length, 1);
  assert.equal(stackSize(generatedCards(ui)[0]), 3);
  assert.ok(generatedCards(ui).every((card) => card.closest('[data-sim-battlefield-area]').dataset.simBattlefieldArea === 'artifacts'));
  const id = generatedCards(ui)[0].dataset.simInstance;
  const image = ui.instance(id).querySelector('img').getAttribute('src');
  assert.match(image, /\/cards\/image-cache\?url=/);
  assert.ok(decodeURIComponent(image).includes('treasure.jpg'));
  await openCardMenu(ui, id);
  assert.equal(ui.document.querySelector('[data-sim-card-action="duplicate"]'), null);
  assert.equal(ui.document.querySelector('[data-sim-card-action="token"]'), null);
  ui.document.dispatch('keydown', { key: 'Escape' });
  ui.drag(ui.instance(id), 'library');
  assert.equal(ui.libraryCount(), 1);
  ui.libraryAction('peek');
  assert.equal(ui.root().querySelector('[data-sim-library-source]').querySelector('img').getAttribute('src'), image);
  ui.libraryAction('reveal');
  assert.equal(ui.revealed().length, 1);
  assert.equal(ui.revealed()[0].querySelector('img').getAttribute('src'), image);
  ui.revealed()[0].click();
  const zoom = ui.document.querySelectorAll('dialog').at(-1);
  assert.match(zoom.querySelector('img').getAttribute('src'), /\/cards\/image-cache\?url=/);
  assert.ok(!zoom.querySelector('img').getAttribute('src').includes('undefined'));
  zoom.close();
  ui.revealMove(id, 'hand');
  finishReveal(ui, 'top');
  assert.equal(ui.instance(id).dataset.simSourceZone, 'hand');
  ui.drag(ui.instance(id), 'battlefield');
  assertUniqueInstances(ui, 4);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
});

test('identical tokens from different makers form one stack and individual counters do not alter their siblings', async (t) => {
  const ui = await setup(t, [deckCard(351, 'Maker A', 1), deckCard(352, 'Maker B', 1)], {
    tokens: () => [relatedToken()]
  });
  ui.allToBattlefield();
  for (const id of ['351:1', '352:1']) {
    await openCardMenu(ui, id);
    await submitDialog(cardAction(ui, 'token'), { quantity: 4 });
  }
  const generated = generatedCards(ui);
  assert.equal(generated.length, 1);
  assert.equal(stackSize(generated[0]), 8);
  assert.equal(generated[0].closest('.simulator-card-stack').querySelectorAll('img').length, 1);
  const id = generated[0].dataset.simInstance;
  await openCardMenu(ui, id);
  await submitDialog(cardAction(ui, 'counters'), { power: 5, toughness: 5 });
  assert.equal(ui.instance(id).querySelector('.simulator-card-counters').textContent.trim(), '+5/+5');
  assert.ok(generatedCards(ui).filter((card) => card.dataset.simInstance !== id)
    .every((card) => card.querySelector('.simulator-card-counters') === null));
  assertUniqueInstances(ui, 10);
});

test('thousands of tokens keep one image per stack while menus, tapping and moving affect only one copy', async (t) => {
  const ui = await setup(t, [deckCard(353, 'Large token maker', 1)], { tokens: () => [relatedToken()] });
  ui.allToBattlefield();
  for (let batch = 0; batch < 2; batch++) {
    await openCardMenu(ui, '353:1');
    await submitDialog(cardAction(ui, 'token'), { quantity: 1000 });
  }
  assert.equal(ui.zoneCount('battlefield'), 2001);
  assert.equal(generatedCards(ui).length, 1, 'no per-token DOM or layered images');
  let representative = generatedCards(ui)[0];
  assert.equal(stackSize(representative), 2000);
  assert.equal(representative.closest('.simulator-card-stack').querySelectorAll('img').length, 1);
  const counterId = representative.dataset.simInstance;
  await openCardMenu(ui, counterId);
  await submitDialog(cardAction(ui, 'counters'), { power: 2, toughness: 3 });
  assert.equal(ui.instance(counterId).querySelector('.simulator-card-counters').textContent, '+2/+3');
  assert.equal(stackSize(ui.instance(counterId)), 1);
  representative = generatedCards(ui).find((card) => card.dataset.simInstance !== counterId);
  assert.equal(stackSize(representative), 1999);
  const tappedId = representative.dataset.simInstance;
  representative.dispatch('keydown', { key: ' ' });
  assert.ok(ui.instance(tappedId).classList.contains('tapped'));
  assert.equal(stackSize(ui.instance(tappedId)), 1);
  assert.ok(generatedCards(ui).some((card) => stackSize(card) === 1998));
  ui.drag(ui.instance(tappedId), 'hand');
  assert.equal(ui.instance(tappedId).dataset.simSourceZone, 'hand');
  assert.equal(ui.zoneCount('battlefield'), 2000);
  assert.ok(!ui.instance(tappedId).classList.contains('tapped'));
  ui.drag(ui.instance(tappedId), 'battlefield');
  assert.ok(generatedCards(ui).some((card) => stackSize(card) === 1999));
  await openCardMenu(ui, counterId);
  await submitDialog(cardAction(ui, 'counters'), { power: 0, toughness: 0 });
  assert.equal(generatedCards(ui).length, 1);
  assert.equal(stackSize(generatedCards(ui)[0]), 2000);
  assertUniqueInstances(ui, 2001);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
});

test('token lookup errors offer retry and do not claim missing token capability', async (t) => {
  let calls = 0;
  const ui = await setup(t, [deckCard(361, 'Maker', 1)], { tokens: () => {
    calls++;
    if (calls === 1) return Response.json({ error: { message: 'Tijdelijk niet beschikbaar' } }, { status: 503 });
    return [relatedToken()];
  } });
  ui.allToBattlefield();
  await openCardMenu(ui, '361:1');
  assert.equal(ui.document.querySelector('[data-sim-card-action="token"]'), null);
  assert.ok(ui.document.querySelector('[data-sim-token-status]').textContent.length > 0);
  const retry = ui.document.querySelector('[data-sim-card-action="retry"]');
  assert.ok(retry);
  retry.click();
  await flush();
  assert.ok(ui.document.querySelector('[data-sim-card-action="token"]'));
  assert.equal(calls, 2);
  assertUniqueInstances(ui, 1);
});

test('late token lookup responses cannot reopen menus or alter a restarted simulator', async (t) => {
  let resolveTokens;
  let requestSignal;
  const ui = await setup(t, [deckCard(371, 'Slow maker', 1)], { tokens: (_id, options) => {
    requestSignal = options.signal;
    return new Promise((resolve) => { resolveTokens = resolve; });
  } });
  ui.allToBattlefield();
  ui.instance('371:1').dispatch('contextmenu');
  await flush();
  assert.equal(typeof resolveTokens, 'function');
  await ui.open();
  assert.ok(requestSignal.aborted);
  resolveTokens([relatedToken()]);
  await flush();
  assert.equal(ui.document.querySelector('[data-sim-card-action]'), null);
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.equal(ui.zoneCount('battlefield'), 0);
  assert.equal(ui.zoneCount('hand'), 1);
  assertUniqueInstances(ui, 1);
});

test('stale menus and dialogs cannot duplicate a moved source or affect a reset game', async (t) => {
  const ui = await setup(t, [deckCard(381, 'Source', 1)]);
  ui.allToBattlefield();
  await openCardMenu(ui, '381:1');
  const oldAction = ui.document.querySelector('[data-sim-card-action="duplicate"]');
  ui.drag(ui.instance('381:1'), 'graveyard');
  oldAction.click();
  assert.equal(ui.document.querySelector('dialog'), null);
  ui.drag(ui.instance('381:1'), 'battlefield');
  await openCardMenu(ui, '381:1');
  let dialog = cardAction(ui, 'duplicate');
  ui.drag(ui.instance('381:1'), 'graveyard');
  await submitDialog(dialog, { quantity: 3 });
  assert.equal(ui.zoneCount('battlefield'), 0, 'moving the source invalidates its dialog');
  assertUniqueInstances(ui, 1);
  dialog.close();
  ui.drag(ui.instance('381:1'), 'battlefield');
  await openCardMenu(ui, '381:1');
  dialog = cardAction(ui, 'duplicate');
  const oldForm = dialog.querySelector('form');
  ui.document.getElementById('sim-reset').click();
  const reset = ui.document.querySelectorAll('dialog').at(-1);
  await submitDialog(reset);
  oldForm.dispatch('submit');
  await flush();
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.equal(ui.zoneCount('battlefield'), 0);
  assert.equal(ui.zoneCount('hand'), 1);
  assertUniqueInstances(ui, 1);
});


function typeIntoSelection(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.dispatch('input');
}

test('counter inputs select existing totals on keyboard and first mouse focus while later caret editing still works', async (t) => {
  const ui = await setup(t, [deckCard(401, 'Counter creature', 1)]);
  ui.allToBattlefield();
  await openCardMenu(ui, '401:1');
  await submitDialog(cardAction(ui, 'counters'), { power: 12, toughness: 34 });
  await openCardMenu(ui, '401:1');
  const dialog = cardAction(ui, 'counters');
  const power = dialog.querySelector('[name="power"]');
  const toughness = dialog.querySelector('[name="toughness"]');
  ui.tick(0);
  assert.equal(power.type, 'text', 'text inputs provide actual selection support');
  assert.equal(power.getAttribute('inputmode'), 'numeric');
  assert.equal(power.value, '12', 'focusing preserves the stored value until typing');
  assert.deepEqual([power.selectionStart, power.selectionEnd], [0, 2]);
  typeIntoSelection(power, '5');
  assert.equal(power.value, '5', 'typing replaces the selected total');

  toughness.dispatch('pointerdown', { button: 0, pointerId: 1 });
  toughness.focus();
  // Native mouse focus can collapse the focus-handler selection at mouseup.
  toughness.selectionStart = toughness.selectionEnd = 1;
  toughness.dispatch('pointerup', { button: 0, pointerId: 1 });
  toughness.dispatch('click', { detail: 1 });
  assert.deepEqual([toughness.selectionStart, toughness.selectionEnd], [0, 2]);
  typeIntoSelection(toughness, '7');
  assert.equal(toughness.value, '7');

  toughness.dispatch('pointerdown', { button: 0, pointerId: 1 });
  toughness.selectionStart = toughness.selectionEnd = 0;
  toughness.dispatch('click', { detail: 1 });
  assert.deepEqual([toughness.selectionStart, toughness.selectionEnd], [0, 0], 'later clicks retain a chosen caret');
  typeIntoSelection(toughness, '1');
  assert.equal(toughness.value, '17');
  power.focus();
  assert.deepEqual([power.selectionStart, power.selectionEnd], [0, 1], 'returning via keyboard selects the whole value again');
  typeIntoSelection(power, '-2');
  await submitDialog(dialog);
  assert.equal(ui.instance('401:1').querySelector('.simulator-card-counters').textContent, '-2/+17');
  assertUniqueInstances(ui, 1);
});

test('token and generic-counter fields select even when the browser focused them before popup listeners were attached', async (t) => {
  const ui = await setup(t, [deckCard(411, 'Token source', 1), deckCard(412, 'Artifact', 1, { typeLine: 'Artifact' })], {
    tokens: () => [relatedToken()], nativeDialogFocus: true
  });
  ui.allToBattlefield();
  await openCardMenu(ui, '411:1');
  let dialog = cardAction(ui, 'token');
  const quantity = dialog.querySelector('[name="quantity"]');
  assert.equal(quantity.value, '1');
  assert.deepEqual([quantity.selectionStart, quantity.selectionEnd], [0, 1]);
  // Clicking the initially auto-focused field still replaces its default.
  quantity.dispatch('pointerdown', { button: 0, pointerId: 1 });
  quantity.selectionStart = quantity.selectionEnd = 1;
  quantity.dispatch('click', { detail: 1 });
  typeIntoSelection(quantity, '8');
  await submitDialog(dialog);
  assert.equal(generatedCards(ui).length, 1);
  assert.equal(stackSize(generatedCards(ui)[0]), 8);
  assert.equal(generatedCards(ui)[0].closest('.simulator-card-stack').querySelector('.simulator-stack-count').textContent, '8');

  await openCardMenu(ui, '412:1');
  dialog = cardAction(ui, 'counters');
  const generic = dialog.querySelector('[name="generic"]');
  assert.deepEqual([generic.selectionStart, generic.selectionEnd], [0, 1]);
  typeIntoSelection(generic, '6');
  await submitDialog(dialog);
  assert.equal(ui.instance('412:1').querySelector('.simulator-card-counters').textContent, '6');
  assertUniqueInstances(ui, 10);
});
