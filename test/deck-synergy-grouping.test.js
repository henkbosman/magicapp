import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Element, parseHtml } from './support/dom.js';
import { deckDetailQueryString, groupDeckCards, normalizeDeckCardGroup, renderDeckDetail } from '../public/js/views/deck-detail.js';

const synergy = (id, name) => ({ id, name, type: 'synergy', memberCount: 1, members: [], note: '' });
function card(id, name, { quantity = 1, manaValue = 1, relations = [], basic = false, role = 'main' } = {}) {
  return {
    id, quantity, role, relations, tags: [], note: '',
    coverage: { assumedAvailable: basic, wantedGap: 0, missingFromCollection: 0, globalShortage: 0 },
    card: { id, name, typeLine: basic ? 'Basic Land — Forest' : 'Creature',
      cardTypes: [basic ? 'Land' : 'Creature'], supertypes: basic ? ['Basic'] : [],
      keywords: [], manaValue, manaCost: basic ? '' : '{1}', oracleText: '',
      images: {}, setCode: 'tst', setName: 'Test', collectorNumber: String(id), language: 'en',
      usage: { owned: quantity, needed: quantity } }
  };
}

async function mountDeck(t, cards, query = '') {
  const globalKeys = ['document', 'window', 'history', 'sessionStorage', 'Element',
    'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement'];
  const originals = globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const originalQuerySelectorAll = Element.prototype.querySelectorAll;
  t.after(() => {
    Element.prototype.querySelectorAll = originalQuerySelectorAll;
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // The shared tiny DOM adapter only supports simple selectors. Deck mounting
  // also uses descendant selectors, so implement that browser behavior locally.
  Element.prototype.querySelectorAll = function (selector) {
    const descendants = (node) => node.children.filter((child) => child instanceof Element)
      .flatMap((child) => [child, ...descendants(child)]);
    const matches = (element, part) => /^h[1-6]$/.test(part)
      ? element.tagName === part.toUpperCase() : element.matches(part);
    const chains = selector.split(',').map((part) => part.trim().split(/\s+/));
    return descendants(this).filter((candidate) => chains.some((chain) => {
      if (!matches(candidate, chain.at(-1))) return false;
      let parent = candidate.parentElement;
      for (let index = chain.length - 2; index >= 0; index--) {
        while (parent && !matches(parent, chain[index])) parent = parent.parentElement;
        if (!parent) return false;
        parent = parent.parentElement;
      }
      return true;
    }));
  };
  const deck = { id: 7, name: 'Testdeck', format: 'commander', description: '', notes: '', commander: null, secondCommander: null };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    return Response.json({ data: String(url).endsWith('/cards') ? cards : deck });
  });
  const storage = new Map();
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  const location = { pathname: '/', search: '', hash: `#/decks/7${query ? `?${query}` : ''}` };
  let refreshes = 0;
  globalThis.window = {
    location, sessionStorage, scrollY: 175,
    dispatchEvent(event) { if (event.type === 'app:refresh') refreshes++; },
    addEventListener() {}, removeEventListener() {}
  };
  globalThis.sessionStorage = sessionStorage;
  globalThis.history = {
    state: null,
    replaceState(state, title, url) { location.hash = url.slice(url.indexOf('#')); }
  };
  for (const key of globalKeys.filter((key) => key.includes('Element'))) globalThis[key] = Element;
  const append = function (child) { child.parentElement = this; this.children.push(child); };
  const render = async () => {
    const view = await renderDeckDetail({ params: { id: '7' }, query: new URLSearchParams(location.hash.split('?')[1] || '') });
    const document = parseHtml(view.html);
    document.body = document;
    document.documentElement = document;
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
    view.mount();
    return document;
  };
  const document = await render();
  return { document, location, render, requests, refreshes: () => refreshes,
    query: () => new URLSearchParams(location.hash.split('?')[1] || '') };
}

test('synergiegroepering gebruikt stabiele IDs, meerdere lidmaatschappen en de gekozen sortering', () => {
  const ramp = synergy(1, 'Ramp');
  const draw = synergy(2, 'Draw');
  const cards = [
    card(11, 'Zeta', { manaValue: 1, relations: [ramp, draw, ramp] }),
    card(12, 'Alpha', { manaValue: 4, relations: [draw] }),
    card(13, 'Combo only', { relations: [{ id: 3, name: 'Combo', type: 'combo' }] }),
    card(14, 'None'),
    card(15, 'Named fallback', { relations: [synergy(4, 'Geen synergie')] }),
    card(16, 'Other Ramp', { relations: [synergy(5, 'Ramp')] })
  ];
  const original = structuredClone(cards);
  const groups = groupDeckCards(cards, { groupBy: 'synergies' });
  assert.deepEqual(groups.map((group) => group.label), ['Draw', 'Geen synergie', 'Ramp', 'Ramp', 'Geen synergie']);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.id)), [[11, 12], [15], [11], [16], [13, 14]]);
  assert.equal(new Set(groups.map((group) => group.key)).size, 5);
  assert.deepEqual(groupDeckCards(cards, { groupBy: 'synergies', sortBy: 'name' })[0].items.map((item) => item.id), [12, 11]);
  assert.equal(normalizeDeckCardGroup('synergies'), 'synergies');
  assert.equal(deckDetailQueryString({ cardGroup: 'synergies', view: 'list' }), 'view=list&cardGroup=synergies');
  assert.deepEqual(groupDeckCards([], { groupBy: 'synergies' }), []);
  assert.deepEqual(cards, original);
});

test('samengevoegde basic lands krijgen alleen lidmaatschappen van hun eigen printings en rol', () => {
  const ramp = synergy(1, 'Ramp');
  const draw = synergy(2, 'Draw');
  const members = [
    card(21, 'Forest', { basic: true, quantity: 2, relations: [ramp, draw] }),
    card(22, 'Forest', { basic: true, quantity: 3, relations: [ramp] }),
    card(23, 'Forest', { basic: true, quantity: 4, relations: [draw] }),
    card(24, 'Forest', { basic: true, quantity: 5 }),
    card(25, 'Forest', { basic: true, quantity: 1, role: 'sideboard', relations: [ramp] })
  ];
  const combined = [{ ...members[0], quantity: 14, relations: [ramp, draw], displayMembers: members.slice(0, 4) }, members[4]];
  const original = structuredClone(combined);
  const groups = groupDeckCards(combined, { groupBy: 'synergies' });
  assert.deepEqual(groups.map((group) => group.label), ['Draw', 'Ramp', 'Geen synergie']);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.quantity)), [[6], [5, 1], [5]]);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.displayMembers.map((member) => member.id))), [[[21, 23]], [[21, 22], [25]], [[24]]]);
  assert.deepEqual(combined, original);
});

test('synergieën werken in beide deckviews en tellen overlappende kaarten eenmalig tijdens filteren', async (t) => {
  const cards = [
    card(31, 'Alpha', { quantity: 2, relations: [synergy(1, 'Ramp'), synergy(2, 'Draw')] }),
    card(32, 'Beta', { quantity: 3 }),
    card(33, 'Gamma', { quantity: 1, role: 'sideboard', relations: [synergy(1, 'Ramp')] })
  ];
  const ui = await mountDeck(t, cards, 'cardGroup=synergies');
  const document = ui.document;
  assert.equal(document.querySelector('#deck-card-group').value, 'synergies');
  assert.equal(document.querySelector('#deck-card-group').options.find((option) => option.value === 'synergies').textContent, 'Synergieën');
  assert.equal(document.querySelector('#deck-filter-summary').textContent, '6 van 6 kaarten zichtbaar');
  for (const id of ['#deck-card-list', '#deck-card-visual']) {
    const groups = document.querySelector(id).querySelectorAll('[data-deck-card-group]');
    assert.deepEqual(groups.map((group) => group.querySelector('h3').textContent), ['Draw', 'Ramp', 'Geen synergie']);
    assert.deepEqual(groups.map((group) => group.querySelector('[data-deck-group-count]').textContent), ['2', '3', '3']);
  }
  document.querySelector('[data-deck-view="list"]').click();
  const search = document.querySelector('#deck-card-search');
  search.value = 'Alpha';
  search.dispatch('input');
  assert.equal(document.querySelector('#deck-filter-summary').textContent, '2 van 6 kaarten zichtbaar');
  assert.equal(ui.query().get('cardGroup'), 'synergies');
  assert.equal(ui.query().get('view'), 'list');
  for (const id of ['#deck-card-list', '#deck-card-visual']) {
    const groups = document.querySelector(id).querySelectorAll('[data-deck-card-group]');
    assert.deepEqual(groups.filter((group) => !group.hidden).map((group) => group.querySelector('[data-deck-group-count]').textContent), ['2', '2']);
    assert.equal(groups.at(-1).hidden, true);
  }
  search.value = '';
  search.dispatch('input');
  document.querySelector('#deck-tabs').querySelector('[data-filter="sideboard"]').click();
  assert.equal(document.querySelector('#deck-filter-summary').textContent, '1 van 6 kaarten zichtbaar');
  assert.equal(ui.query().get('role'), 'sideboard');
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
});
