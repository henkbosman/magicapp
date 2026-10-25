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

async function setup(t, cards = sampleDeck()) {
  const keys = ['document', 'window', 'Element', 'FormData', 'HTMLButtonElement',
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
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  Element.prototype.focus = function () { this.focused = true; };
  const append = function (child) { child.parentElement = this; this.children.push(child); };
  const remove = function () {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
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
    element.showModal = () => { element.open = true; };
    element.close = () => { element.open = false; element.dispatch('close'); };
    return element;
  };
  globalThis.document = document;
  const storageWrites = [];
  const storage = { getItem: () => null, setItem: (...args) => storageWrites.push(args), removeItem() {} };
  globalThis.window = Object.assign(new EventTarget(), {
    location: { hash: '#/decks/7/simulate' }, sessionStorage: storage, localStorage: storage,
    setTimeout: (...args) => setTimeout(...args)
  });
  globalThis.FormData = class {};
  for (const key of keys.filter((key) => key.includes('Element'))) globalThis[key] = Element;
  setWriteAvailability(false);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET' });
    if (String(url) === '/api/read/decks/7') return Response.json({ data: { id: 7, name: 'Forest test', format: 'Commander' } });
    if (String(url) === '/api/read/decks/7/cards') return Response.json({ data: cards });
    throw new Error(`Unexpected request: ${url}`);
  });
  const app = document.getElementById('app');
  async function open() {
    const view = await renderDeckSimulator({ params: { id: '7' }, query: new URLSearchParams() });
    // The small test parser treats every literal '<' as a tag opener; browsers
    // correctly render the existing '<-' back label as text.
    app.innerHTML = view.html.replace('<- ', '&lt;- ');
    view.mount();
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
  const libraryCount = () => Number(zone('library').querySelector('header').querySelector('span').textContent);
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
    libraryCount, allToBattlefield, open, cloneForTouch,
    stacks: () => zone('battlefield').querySelectorAll('.simulator-card-stack'),
    tick: (milliseconds) => t.mock.timers.tick(milliseconds)
  };
}

function assertUniqueInstances(ui, expected) {
  const ids = ui.instances().map((card) => card.dataset.simInstance);
  assert.equal(new Set(ids).size, ids.length, 'every visible physical copy occurs only once');
  assert.equal(ids.length + ui.libraryCount(), expected, 'no copies lost or created across all zones');
}

test('goldfishing opens without the sidebar or its API dependency and retains the play controls', async (t) => {
  const ui = await setup(t);
  assert.match(ui.app.innerHTML, /<h1>[^<]*Goldfishing[^<]*<\/h1>/i);
  assert.equal(ui.root().querySelector('.simulator-information'), null);
  for (const label of ['Huidige beurt', 'Beschikbare mana op tafel', 'Deckzoekfuncties', "Combo's en synergieen", 'Acties deze beurt']) {
    assert.ok(!ui.root().textContent.includes(label), `${label} sidebar removed`);
  }
  assert.ok(ui.root().querySelector('[data-sim-end-turn]'));
  assert.ok(ui.document.getElementById('sim-search-library'));
  assert.equal(ui.instances('hand').length, 7);
  assert.equal(ui.instances('command').length, 1);
  assert.equal(ui.instances().some((card) => card.dataset.simInstance === '16:1'), false, 'sideboard excluded');
  assert.deepEqual(ui.requests, [
    { url: '/api/read/decks/7', method: 'GET' },
    { url: '/api/read/decks/7/cards', method: 'GET' }
  ]);
});

test('same battlefield cards stack across printings while images and every physical copy remain distinct', async (t) => {
  const cards = sampleDeck();
  const original = structuredClone(cards);
  const ui = await setup(t, cards);
  assert.equal(ui.zone('hand').querySelector('.simulator-card-stack'), null);
  ui.allToBattlefield();
  assert.equal(ui.stacks().length, 3, 'Forest, Snow-Covered Forest and Llanowar Elves have separate groups');
  const forest = ui.instance('11:1').closest('.simulator-card-stack');
  assert.equal(forest.querySelectorAll('[data-sim-instance]').length, 4);
  assert.equal(ui.instance('12:2').closest('.simulator-card-stack'), forest);
  assert.notEqual(ui.instance('13:1').closest('.simulator-card-stack'), forest);
  assert.match(forest.querySelector('.simulator-stack-count').textContent, /4/);
  assert.match(ui.instance('11:1').querySelector('img').getAttribute('src'), /\/cards\/111\/image/);
  assert.match(ui.instance('12:2').querySelector('img').getAttribute('src'), /\/cards\/112\/image/);
  assert.ok(ui.instances('battlefield').every((card) => card.getAttribute('draggable') === 'true' && card.getAttribute('tabindex') === '0'));
  assert.equal(ui.zone('command').querySelector('.simulator-card-stack'), null);
  assertUniqueInstances(ui, 8);
  assert.deepEqual(cards, original, 'rendering and moving cannot change fetched deck/card records');
});

test('tapping one stacked copy separates only that copy and next turn reunites untapped copies', async (t) => {
  const ui = await setup(t);
  ui.allToBattlefield();
  ui.instance('12:2').dispatch('dblclick');
  assert.ok(ui.instance('12:2').classList.contains('tapped'));
  assert.ok(!ui.instance('11:1').classList.contains('tapped'));
  assert.equal(ui.instance('12:2').closest('.simulator-card-stack').querySelectorAll('[data-sim-instance]').length, 1);
  assert.equal(ui.instance('11:1').closest('.simulator-card-stack').querySelectorAll('[data-sim-instance]').length, 3);
  ui.instance('11:1').dispatch('keydown', { key: ' ' });
  assert.equal(ui.instance('11:1').focused, true, 'focus follows the same copy after regrouping');
  assert.equal(ui.instance('12:2').closest('.simulator-card-stack'), ui.instance('11:1').closest('.simulator-card-stack'));
  ui.instance('12:2').dispatch('keydown', { key: ' ' });
  assert.ok(!ui.instance('12:2').classList.contains('tapped'));
  assert.ok(ui.instance('11:1').classList.contains('tapped'));
  ui.root().querySelector('[data-sim-end-turn]').click();
  assert.ok(ui.instances('battlefield').every((card) => !card.classList.contains('tapped')));
  assert.equal(ui.instance('11:1').closest('.simulator-card-stack'), ui.instance('12:2').closest('.simulator-card-stack'));
  assert.equal(ui.document.querySelector('.simulator-metrics').querySelector('strong').textContent, '2');
  assertUniqueInstances(ui, 8);
});

test('stack identity handles older printing IDs and missing IDs without mixing different Oracle cards', async (t) => {
  const ui = await setup(t, [
    deckCard(41, 'Forest', 1, { cardKey: 'old-print-a', scryfallId: 'old-print-a' }),
    deckCard(42, ' Forest ', 1, { cardKey: 'old-print-b', scryfallId: 'old-print-b' }),
    deckCard(43, 'forest', 1, { cardKey: null, scryfallId: null }),
    deckCard(44, 'Identical display name', 1, { cardKey: 'printing-a', oracleId: 'oracle-one' }),
    deckCard(45, 'Identical display name', 1, { cardKey: 'printing-b', oracleId: 'oracle-one' }),
    deckCard(46, 'Identical display name', 1, { cardKey: 'printing-c', oracleId: 'oracle-two' })
  ]);
  ui.allToBattlefield();
  assert.equal(ui.stacks().length, 3);
  assert.equal(ui.instance('41:1').closest('.simulator-card-stack'), ui.instance('42:1').closest('.simulator-card-stack'));
  assert.equal(ui.instance('41:1').closest('.simulator-card-stack'), ui.instance('43:1').closest('.simulator-card-stack'));
  assert.equal(ui.instance('44:1').closest('.simulator-card-stack'), ui.instance('45:1').closest('.simulator-card-stack'));
  assert.notEqual(ui.instance('44:1').closest('.simulator-card-stack'), ui.instance('46:1').closest('.simulator-card-stack'));
  assertUniqueInstances(ui, 6);
});

test('dragging a stacked copy changes exactly one zone entry and returning it preserves its printing', async (t) => {
  const ui = await setup(t);
  ui.allToBattlefield();
  ui.instance('12:2').dispatch('dblclick');
  ui.drag(ui.instance('12:2'), 'graveyard');
  assert.equal(ui.instances('battlefield').length, 6);
  assert.equal(ui.instances('graveyard').length, 1);
  assert.equal(ui.instance('12:2').dataset.simSourceZone, 'graveyard');
  assert.equal(ui.zone('graveyard').querySelector('.simulator-card-stack'), null);
  assert.ok(!ui.instance('12:2').classList.contains('tapped'));
  ui.drag(ui.instance('12:2'), 'library');
  assert.equal(ui.libraryCount(), 1);
  assert.equal(ui.instance('12:2'), null);
  ui.root().querySelector('[data-sim-library-source]').dispatch('dblclick');
  assert.equal(ui.instance('12:2').dataset.simSourceZone, 'hand');
  ui.drag(ui.instance('12:2'), 'battlefield');
  assert.match(ui.instance('12:2').querySelector('img').getAttribute('src'), /\/cards\/112\/image/);
  assert.equal(ui.instance('12:2').closest('.simulator-card-stack').querySelectorAll('[data-sim-instance]').length, 4);
  assertUniqueInstances(ui, 8);
});

test('large land groups use bounded stacks without dropping copies when tapping or moving them', async (t) => {
  const ui = await setup(t, [deckCard(21, 'Forest', 13)]);
  ui.allToBattlefield();
  assert.deepEqual(ui.stacks().map((stack) => stack.querySelectorAll('[data-sim-instance]').length), [5, 5, 3]);
  ui.instance('21:6').dispatch('dblclick');
  ui.drag(ui.instance('21:9'), 'graveyard');
  assert.ok(ui.stacks().every((stack) => stack.querySelectorAll('[data-sim-instance]').length <= 5));
  assert.ok(ui.instance('21:6').classList.contains('tapped'));
  ui.document.getElementById('sim-end-turn').click();
  ui.drag(ui.instance('21:9'), 'battlefield');
  assertUniqueInstances(ui, 13);
  assert.deepEqual(ui.stacks().map((stack) => stack.querySelectorAll('[data-sim-instance]').length), [5, 5, 3]);
});

test('zoom on a stacked copy uses its actual printing and drag does not open an accidental zoom', async (t) => {
  const ui = await setup(t);
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
  ui.instance('11:1').dispatch('keydown', { key: 'Enter' });
  dialog = ui.document.querySelector('dialog');
  assert.match(dialog.querySelector('img').getAttribute('src'), /\/cards\/111\/image\?face=front&size=large/);
  assertUniqueInstances(ui, 8);
});

test('touch dragging a stacked copy moves only the selected instance', async (t) => {
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
  assert.equal(ui.instances('graveyard').length, 1);
  assert.equal(ui.document.body.classList.contains('simulator-touch-dragging'), false);
  assertUniqueInstances(ui, 8);
});

test('the library search still moves an exact printing into a stack after sidebar removal', async (t) => {
  const ui = await setup(t, [deckCard(51, 'Forest', 8), deckCard(52, 'Llanowar Elves', 8)]);
  ui.document.getElementById('sim-search-library').click();
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
  ui.instance('31:1').dispatch('dblclick');
  ui.document.getElementById('sim-end-turn').click();
  ui.document.getElementById('sim-reset').click();
  const dialog = ui.document.querySelector('dialog');
  assert.equal(dialog.querySelector('[data-write-action]'), null);
  dialog.querySelector('form').dispatch('submit');
  await flush();
  assert.equal(ui.instances('battlefield').length, 0);
  assert.equal(ui.instances('hand').length, 7);
  assert.equal(ui.libraryCount(), 3);
  assert.equal(ui.document.querySelector('.simulator-metrics').querySelector('strong').textContent, '1');
  ui.allToBattlefield();
  await ui.open();
  assert.equal(ui.instances('battlefield').length, 0, 'reopening starts a fresh game');
  assert.equal(ui.instances('hand').length, 7);
  assert.equal(ui.libraryCount(), 3);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
  assert.equal(ui.storageWrites.length, 0);
  assertUniqueInstances(ui, 10);
});
