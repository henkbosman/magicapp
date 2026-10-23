import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Element, parseHtml } from './support/dom.js';
import { applyWriteAvailability } from '../public/js/write-access.js';

import {
  compareDeckCards,
  deckCardActionDescriptors,
  deckCardListActionDescriptors,
  deckDetailQueryString,
  groupDeckCards,
  normalizeDeckCardGroup,
  normalizeDeckCardSort,
  normalizeDeckVisualColumns,
  primaryDeckCardAbility,
  renderDeckDetail
} from '../public/js/views/deck-detail.js';

function deckCard({ deckCardId, cardId, name, cardTypes, typeLine, oracleText = '', printedText = '', quantity = 1, role = 'main', wantedGap = 0, supertypes = [], manaValue = 1, keywords = [], insights, tags = [] }) {
  return {
    id: deckCardId,
    role,
    quantity,
    tags,
    note: '',
    relations: [],
    coverage: {
      globalShortage: 0,
      assumedAvailable: false,
      missingFromCollection: 0,
      wantedGap,
      onWanted: false
    },
    card: {
      id: cardId,
      name,
      printedName: '',
      typeLine,
      setName: 'Test Set',
      setCode: 'tst',
      collectorNumber: String(cardId),
      language: 'en',
      cardTypes,
      supertypes,
      keywords,
      insights,
      manaCost: '{1}',
      manaValue,
      oracleText,
      printedText,
      images: { small: 'https://example.invalid/small.jpg', normal: 'https://example.invalid/normal.jpg' },
      usage: { owned: quantity, needed: quantity }
    }
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

test('deckkaartweergave groepeert hoofdtypes en opent in de gekozen view', async () => {
  const deck = {
    id: 7,
    name: 'Testdeck',
    format: 'commander',
    description: '',
    notes: '',
    commander: null,
    secondCommander: null
  };
  const cards = [
    deckCard({ deckCardId: 51, cardId: 11, name: 'Artifact Creature', cardTypes: ['Artifact', 'Creature'], typeLine: 'Artifact Creature', oracleText: 'Flying\n{T}: Add {G}.', keywords: ['Trample', 'Flying'], quantity: 2 }),
    deckCard({ deckCardId: 52, cardId: 12, name: 'Test Instant', cardTypes: ['Instant'], typeLine: 'Instant' }),
    deckCard({ deckCardId: 53, cardId: 11, name: 'Artifact Creature', cardTypes: ['Artifact', 'Creature'], typeLine: 'Artifact Creature', role: 'sideboard' })
  ];
  cards[0].coverage.globalShortage = 4;
  cards[1].coverage.missingFromCollection = 1;
  cards[1].coverage.onWanted = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify({
    data: String(url).endsWith('/cards') ? cards : deck
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const view = await renderDeckDetail({
      params: { id: '7' },
      query: new URLSearchParams('view=cards&cardColumns=5')
    });

    assert.match(view.html, /data-deck-view="cards"[^>]+aria-pressed="true"/);
    assert.match(view.html, /id="deck-card-list" class="card-list" hidden/);
    assert.match(view.html, /data-deck-type-group="Creature"[\s\S]*?<h3>Creatures<\/h3>/);
    assert.match(view.html, /data-deck-type-group="Instant"[\s\S]*?<h3>Instants<\/h3>/);
    assert.match(view.html, /<div class="deck-filter-controls">[\s\S]*?id="deck-filter-toggle"[\s\S]*?<label id="deck-cards-per-row-control"[\s\S]*?<select id="deck-cards-per-row"[\s\S]*?<\/label>\s*<\/div>\s*<span id="deck-filter-summary"/);
    assert.match(view.html, /id="deck-filter-toggle"[\s\S]*?<label class="deck-list-order-control" for="deck-card-sort">[\s\S]*?<select id="deck-card-sort">[\s\S]*?<option value="mana" selected>Mana kosten<\/option>/);
    assert.match(view.html, /<label class="deck-list-order-control" for="deck-card-group">[\s\S]*?<select id="deck-card-group">[\s\S]*?<option value="type" selected>Type<\/option>/);
    assert.match(view.html, /id="deck-card-list"[\s\S]*?data-deck-card-group[\s\S]*?data-deck-type-group="Creature"/);
    assert.match(view.html, /id="deck-cards-per-row"[\s\S]*?<option value="5" selected>5<\/option>/);
    assert.doesNotMatch(view.html, /<option value="auto"|>Automatisch<\/option>/);
    assert.match(view.html, /id="deck-card-visual" class="deck-visual-groups" data-columns="5"/);
    assert.doesNotMatch(view.html, /deck-visual-toolbar/);
    assert.match(view.html, /data-card-preview-id="11"/);
    assert.doesNotMatch(view.html, /data-deck-card-context-actions/);
    assert.doesNotMatch(view.html, /•••/);
    assert.match(view.html, /aria-keyshortcuts="Shift\+F10"/);
    assert.match(view.html, /aria-label="Toon grotere versie van Artifact Creature, 2 exemplaren"/);
    assert.match(view.html, /class="deck-visual-card-quantity" aria-hidden="true">2&times;<\/span>/);
    const visualCards = parseHtml(view.html).querySelector('#deck-card-visual').querySelectorAll('.deck-visual-card');
    assert.equal(visualCards.length, 3);
    for (const card of visualCards) {
      assert.equal(Boolean(card.querySelector('.deck-visual-card-quantity')), Number(card.dataset.quantity) > 1);
    }
    assert.match(view.html, /class="button secondary small open-deck-card-actions"/);
    assert.match(view.html, /aria-label="Acties voor Artifact Creature">Acties<\/button>/);
    assert.match(view.html, /class="deck-card-rules-text oracle-text">[\s\S]*?aria-label="Tappen"[\s\S]*?aria-label="Groen mana"/);
    assert.match(view.html, /class="deck-card-name-mana">[\s\S]*?class="deck-card-name-slot">[\s\S]*?Artifact Creature[\s\S]*?class="deck-card-mana-slot">[\s\S]*?aria-label="Manakosten \{1\}"/);
    assert.match(view.html, /class="deck-card-name-slot"><strong>2× Artifact Creature<\/strong><\/span>/);
    assert.doesNotMatch(view.html, /class="deck-card-name-preview"/);
    assert.match(view.html, /<button type="button" class="card-thumb-link deck-card-preview-trigger"[^>]+data-card-preview-id="11"/);
    assert.doesNotMatch(view.html, /class="[^\"]*manage-deck-relations/);
    assert.doesNotMatch(view.html, /class="[^\"]*remove-deck-card/);
    assert.doesNotMatch(view.html, />Meer<\/button>/);
    assert.doesNotMatch(view.html, /class="[^"]*deck-card-to-wanted/);
    assert.doesNotMatch(view.html, /class="[^"]*edit-deck-card-insights/);
    assert.doesNotMatch(view.html, /class="[^"]*edit-deck-card(?:\s|")/);

    const listView = await renderDeckDetail({
      params: { id: '7' },
      query: new URLSearchParams('view=list')
    });
    assert.match(listView.html, /id="deck-cards-per-row-control"[^>]*\shidden(?:\s|>)/);
    const listRows = parseHtml(listView.html).querySelector('#deck-card-list');
    assert.doesNotMatch(listRows.textContent, /Missende kaarten|Alle decks/);
    assert.match(listRows.textContent, /Totaal bezit 2/);
    assert.match(listRows.textContent, /In bezit/);
    assert.match(listRows.textContent, /Mist 1/);
    assert.match(listRows.textContent, /Wanted/);

    const abilityView = await renderDeckDetail({
      params: { id: '7' },
      query: new URLSearchParams('cardSort=name&cardGroup=ability')
    });
    assert.match(abilityView.html, /id="deck-card-sort">[\s\S]*?<option value="name" selected>Naam kaart<\/option>/);
    assert.match(abilityView.html, /id="deck-card-group">[\s\S]*?<option value="ability" selected>Ability<\/option>/);
    assert.equal((abilityView.html.match(/data-deck-ability-group="Flying"/g) || []).length, 2);
    assert.equal((abilityView.html.match(/data-deck-ability-group="Geen ability"/g) || []).length, 2);
    assert.doesNotMatch(abilityView.html, /data-deck-type-group=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('kaarten-per-rij-keuze staat compact naast de filterknop en kan responsief omslaan', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.deck-filter-controls\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
  assert.match(styles, /\.deck-list-order-control\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
  assert.match(styles, /\.deck-list-order-control select\s*\{[^}]*min-width:\s*128px;[^}]*height:\s*42px;/s);
  assert.match(styles, /\.deck-cards-per-row-control\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
  assert.match(styles, /\.deck-cards-per-row-control select\s*\{[^}]*width:\s*76px;[^}]*height:\s*42px;/s);
});

test('decklijst geeft de naam flexibele ruimte en lijnt mana aan de rechterrand uit', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.deck-card-title-row > div\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  assert.match(styles, /\.deck-card-name-mana\s*\{[^}]*width:\s*100%;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) max-content;/s);
  assert.match(styles, /\.deck-card-mana-slot\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/s);
  assert.match(styles, /\.deck-card-mana-slot \.mana-cost\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*justify-content:\s*flex-end;/s);
  assert.match(styles, /@media \(min-width:\s*641px\) and \(max-width:\s*1279px\)[\s\S]*?#deck-card-list \.deck-card-row/);
  assert.doesNotMatch(styles, /#deck-card-list\s*>\s*\.deck-card-row/);
  assert.match(styles, /\.oracle-text \.mana-symbol\s*\{[^}]*vertical-align:\s*-\.2em;/s);
  assert.doesNotMatch(styles, /\.oracle-text \.mana-symbol\.mana-bg-(?:C|generic)\s*\{/);
});

test('deckkolommen gebruiken standaard vijf en accepteren één tot en met acht', () => {
  assert.equal(normalizeDeckVisualColumns(), '5');
  assert.equal(normalizeDeckVisualColumns(null), '5');
  assert.equal(normalizeDeckVisualColumns('auto'), '5');
  assert.equal(normalizeDeckVisualColumns('1'), '1');
  assert.equal(normalizeDeckVisualColumns('5'), '5');
  assert.equal(normalizeDeckVisualColumns('8'), '8');
  assert.equal(normalizeDeckVisualColumns('0'), '5');
  assert.equal(normalizeDeckVisualColumns('9'), '5');
  assert.equal(normalizeDeckVisualColumns('vier'), '5');
});

test('decksortering en -groepering normaliseren naar veilige standaardwaarden', () => {
  assert.equal(normalizeDeckCardSort(), 'mana');
  assert.equal(normalizeDeckCardSort('mana'), 'mana');
  assert.equal(normalizeDeckCardSort('name'), 'name');
  assert.equal(normalizeDeckCardSort('onbekend'), 'mana');
  assert.equal(normalizeDeckCardGroup(), 'type');
  assert.equal(normalizeDeckCardGroup('type'), 'type');
  assert.equal(normalizeDeckCardGroup('ability'), 'ability');
  assert.equal(normalizeDeckCardGroup('tags'), 'tags');
  assert.equal(normalizeDeckCardGroup('none'), 'none');
  assert.equal(normalizeDeckCardGroup('onbekend'), 'type');
});

test('deckquery bewaart filters, kaartview en kolomkeuze samen', () => {
  assert.equal(deckDetailQueryString({
    cardSearch: '  Llanowar Elves  ',
    role: 'sideboard',
    cardType: 'Creature',
    view: 'cards',
    cardColumns: '7',
    cardSort: 'name',
    cardGroup: 'ability'
  }), 'cardSearch=Llanowar+Elves&role=sideboard&cardType=Creature&cardColumns=7&cardSort=name&cardGroup=ability');
  assert.equal(deckDetailQueryString({ view: 'cards' }), '');
  assert.equal(deckDetailQueryString({ view: 'list', cardGroup: 'tags' }), 'view=list&cardGroup=tags');
  assert.equal(deckDetailQueryString({ cardGroup: 'none', cardSort: 'name', cardSearch: 'Forest', view: 'cards' }), 'cardSearch=Forest&cardSort=name&cardGroup=none');
  assert.equal(deckDetailQueryString({ cardColumns: '5', cardSort: 'mana', cardGroup: 'type' }), '');
  assert.equal(deckDetailQueryString({ cardColumns: '9', cardSort: 'anders', cardGroup: 'anders' }), '');
});

test('deckkaarten sorteren deterministisch op mana of Nederlandse kaartnaam', () => {
  const zebra = deckCard({ deckCardId: 83, cardId: 43, name: 'Zebra 10', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 0 });
  const beta = deckCard({ deckCardId: 82, cardId: 42, name: 'Bèta', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 2 });
  const alpha = deckCard({ deckCardId: 81, cardId: 41, name: 'Alpha', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 4 });
  const cards = [alpha, zebra, beta];

  assert.deepEqual([...cards].sort((left, right) => compareDeckCards(left, right, 'mana')).map((item) => item.card.name), ['Zebra 10', 'Bèta', 'Alpha']);
  assert.deepEqual([...cards].sort((left, right) => compareDeckCards(left, right, 'name')).map((item) => item.card.name), ['Alpha', 'Bèta', 'Zebra 10']);
  assert.deepEqual(cards.map((item) => item.card.name), ['Alpha', 'Zebra 10', 'Bèta']);

  const sameMana = [
    deckCard({ deckCardId: 92, cardId: 52, name: 'Kaart 10', cardTypes: ['Instant'], typeLine: 'Instant', manaValue: 3 }),
    deckCard({ deckCardId: 91, cardId: 51, name: 'Kaart 2', cardTypes: ['Instant'], typeLine: 'Instant', manaValue: 3 })
  ];
  assert.deepEqual([...sameMana].sort((left, right) => compareDeckCards(left, right, 'mana')).map((item) => item.card.name), ['Kaart 2', 'Kaart 10']);

  const tieBreakers = [
    deckCard({ deckCardId: 113, cardId: 73, name: 'Gelijk', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 2, role: 'sideboard' }),
    deckCard({ deckCardId: 112, cardId: 72, name: 'Gelijk', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 2, role: 'main' }),
    deckCard({ deckCardId: 111, cardId: 71, name: 'Gelijk', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 2, role: 'main' })
  ];
  assert.deepEqual([...tieBreakers].sort((left, right) => compareDeckCards(left, right, 'mana')).map((item) => item.id), [111, 112, 113]);
});

test('typegroepering behoudt de vaste typevolgorde en sorteert binnen iedere groep', () => {
  const input = [
    deckCard({ deckCardId: 123, cardId: 83, name: 'Zeta Instant', cardTypes: ['Instant'], typeLine: 'Instant', manaValue: 4 }),
    deckCard({ deckCardId: 124, cardId: 84, name: 'Mysterie', cardTypes: [], typeLine: 'Card', manaValue: 0 }),
    deckCard({ deckCardId: 122, cardId: 82, name: 'Beta Land', cardTypes: ['Land'], typeLine: 'Land', manaValue: 0 }),
    deckCard({ deckCardId: 121, cardId: 81, name: 'Alpha Creature', cardTypes: ['Artifact', 'Creature'], typeLine: 'Artifact Creature', manaValue: 3 })
  ];
  const groups = groupDeckCards(input, { groupBy: 'type', sortBy: 'name' });
  assert.deepEqual(groups.map((group) => group.value), ['Creature', 'Land', 'Instant', 'Overig']);
  assert.deepEqual(input.map((item) => item.id), [123, 124, 122, 121]);
});

test('functionele tags plaatsen een kaart in elke eigen taggroep zonder dubbele labels of afgeleide abilities', () => {
  const cards = [
    deckCard({ deckCardId: 201, cardId: 201, name: 'Zeta', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 1, tags: [' Ramp ', 'Draw', 'ramp', '', '  '] }),
    deckCard({ deckCardId: 202, cardId: 202, name: 'Alpha', cardTypes: ['Instant'], typeLine: 'Instant', manaValue: 4, tags: ['draw', 'Protection'] }),
    deckCard({ deckCardId: 203, cardId: 203, name: 'Geen handmatige tag', cardTypes: ['Creature'], typeLine: 'Creature', keywords: ['Flying'], insights: { manaProduction: { entries: [{}] } } })
  ];
  const original = structuredClone(cards);
  const groups = groupDeckCards(cards, { groupBy: 'tags', sortBy: 'mana' });
  assert.deepEqual(groups.map((group) => group.label), ['Draw', 'Protection', 'Ramp', 'Geen functionele tags']);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.id)), [[201, 202], [202], [201], [203]]);
  assert.deepEqual(groupDeckCards(cards, { groupBy: 'tags', sortBy: 'name' })[0].items.map((item) => item.id), [202, 201]);
  assert.deepEqual(groupDeckCards([], { groupBy: 'tags' }), []);
  assert.deepEqual(cards, original);

  const namedFallback = deckCard({ deckCardId: 204, cardId: 204, name: 'Eigen label', cardTypes: ['Instant'], typeLine: 'Instant', tags: ['Geen functionele tags'] });
  const fallbackGroups = groupDeckCards([cards[2], namedFallback], { groupBy: 'tags' });
  assert.equal(fallbackGroups.length, 2, 'an actual tag with the fallback label stays distinct from untagged cards');
  assert.deepEqual(fallbackGroups.map((group) => group.items.map((item) => item.id)), [[204], [203]]);
});

test('deckpagina opent standaard in kaarten en behoudt expliciete lijstweergave bij filters, sorteren en herladen', async (t) => {
  const cards = [
    deckCard({ deckCardId: 211, cardId: 211, name: 'Alpha', cardTypes: ['Creature'], typeLine: 'Creature', tags: ['Ramp', 'Draw'], quantity: 2 }),
    deckCard({ deckCardId: 212, cardId: 212, name: 'Beta', cardTypes: ['Instant'], typeLine: 'Instant' })
  ];
  const ui = await mountDeck(t, cards, 'cardGroup=tags');
  let document = ui.document;
  assert.equal(document.querySelector('#deck-card-list').hidden, true);
  assert.equal(document.querySelector('#deck-card-visual-container').hidden, false);
  assert.equal(document.querySelector('#deck-cards-per-row-control').hidden, false);
  assert.equal(document.querySelector('[data-deck-view="cards"]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('#deck-card-group').value, 'tags');
  assert.equal(document.querySelector('#deck-card-group').options.find((option) => option.value === 'tags').textContent, 'Functionele tags');
  assert.equal(document.querySelector('#deck-filter-summary').textContent, '3 van 3 kaarten zichtbaar');

  document.querySelector('[data-deck-view="list"]').click();
  assert.equal(ui.query().get('view'), 'list');
  assert.equal(document.querySelector('#deck-card-list').hidden, false);
  assert.equal(document.querySelector('#deck-cards-per-row-control').hidden, true);
  const search = document.querySelector('#deck-card-search');
  search.value = 'Alpha';
  search.dispatch('input');
  assert.equal(document.querySelector('#deck-filter-summary').textContent, '2 van 3 kaarten zichtbaar');
  for (const viewId of ['#deck-card-list', '#deck-card-visual']) {
    const groups = document.querySelector(viewId).querySelectorAll('[data-deck-card-group]');
    assert.deepEqual(groups.filter((group) => !group.hidden).map((group) => group.querySelector('[data-deck-group-count]').textContent), ['2', '2']);
    assert.equal(groups.at(-1).hidden, true);
  }
  document.querySelector('#deck-card-sort').value = 'name';
  document.querySelector('#deck-card-sort').dispatch('change');
  assert.equal(ui.refreshes(), 1);
  assert.equal(ui.query().get('view'), 'list');
  assert.equal(ui.query().get('cardGroup'), 'tags');
  assert.equal(ui.query().get('cardSort'), 'name');
  assert.equal(ui.query().get('cardSearch'), 'Alpha');
  document = await ui.render();
  assert.equal(document.querySelector('#deck-card-list').hidden, false);
  assert.equal(document.querySelector('#deck-filter-summary').textContent, '2 van 3 kaarten zichtbaar');
  document.querySelector('[data-deck-view="cards"]').click();
  assert.equal(ui.query().has('view'), false);
  assert.equal(ui.query().get('cardGroup'), 'tags');
  document = await ui.render();
  assert.equal(document.querySelector('#deck-card-visual-container').hidden, false);
  assert.equal(document.querySelector('#deck-card-list').hidden, true);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
});

test('taggroepen tellen en bedienen alleen hun eigen basic-landprintings, ook bij overlappende groepen', async (t) => {
  const forest = (id, quantity, tags, role = 'main') => deckCard({ deckCardId: id, cardId: id, name: 'Forest', cardTypes: ['Land'], supertypes: ['Basic'], typeLine: 'Basic Land — Forest', manaValue: 0, quantity, tags, role });
  const cards = [forest(221, 2, ['Ramp', 'Draw']), forest(222, 3, ['Ramp']), forest(223, 4, ['Draw']), forest(224, 5, []), forest(225, 1, ['Ramp'], 'sideboard')];
  const original = structuredClone(cards);
  const ui = await mountDeck(t, cards, 'cardGroup=tags&view=list');
  const document = ui.document;
  assert.equal(document.querySelector('#deck-filter-summary').textContent, '15 van 15 kaarten zichtbaar');
  for (const viewId of ['#deck-card-list', '#deck-card-visual']) {
    const groups = document.querySelector(viewId).querySelectorAll('[data-deck-card-group]');
    assert.deepEqual(groups.map((group) => group.querySelector('h3').textContent), ['Draw', 'Ramp', 'Geen functionele tags']);
    assert.deepEqual(groups.map((group) => group.querySelector('[data-deck-group-count]').textContent), ['6', '6', '5']);
    assert.deepEqual(groups.map((group) => group.querySelectorAll('[data-deck-filter-card]').map((row) => row.dataset.quantity)), [['6'], ['5', '1'], ['5']]);
  }
  const ramp = document.querySelector('#deck-card-list').querySelector('[data-deck-tag-group="Ramp"]');
  ramp.querySelector('.open-deck-card-actions').click();
  const actions = document.querySelector('dialog');
  const printings = actions.querySelector('[data-deck-card-action="printings"]');
  assert.equal(printings.disabled, false, 'printing inspection remains available in read-only mode');
  printings.click();
  const details = document.querySelector('dialog');
  applyWriteAvailability(details);
  assert.deepEqual(details.querySelectorAll('.edit-basic-land-printing').map((button) => button.dataset.id), ['221', '222']);
  assert.ok(details.querySelectorAll('[data-write-action]').every((button) => button.disabled));
  assert.equal(details.querySelector('h2').textContent, '5× Forest');
  details.close();

  document.querySelector('#deck-tabs').querySelector('[data-filter="sideboard"]').click();
  assert.equal(document.querySelector('#deck-filter-summary').textContent, '1 van 15 kaarten zichtbaar');
  assert.equal(ramp.querySelector('[data-deck-group-count]').textContent, '1');
  assert.equal(ui.query().get('role'), 'sideboard');
  assert.equal(ui.query().get('view'), 'list');
  assert.deepEqual(cards, original);
  assert.ok(ui.requests.every((request) => request.method === 'GET'));
});

test('zonder groepering sorteren kaarten over alle types en abilities heen zonder de invoer te wijzigen', () => {
  const cards = [
    deckCard({ deckCardId: 131, cardId: 91, name: 'Alpha Creature', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 5, keywords: ['Flying'] }),
    deckCard({ deckCardId: 132, cardId: 92, name: 'Zeta Land', cardTypes: ['Land'], typeLine: 'Land', manaValue: 0 }),
    deckCard({ deckCardId: 133, cardId: 93, name: 'Beta Instant', cardTypes: ['Instant'], typeLine: 'Instant', manaValue: 2 })
  ];
  const original = structuredClone(cards);
  const manaGroups = groupDeckCards(cards, { groupBy: 'none', sortBy: 'mana' });
  assert.equal(manaGroups.length, 1);
  assert.equal(manaGroups[0].kind, 'none');
  assert.deepEqual(manaGroups[0].items.map((card) => card.id), [132, 133, 131]);
  assert.deepEqual(groupDeckCards(cards, { groupBy: 'none', sortBy: 'name' })[0].items.map((card) => card.id), [131, 133, 132]);
  assert.deepEqual(groupDeckCards([], { groupBy: 'none' }), []);
  assert.deepEqual(cards, original);
});

test('Geen toont één lijst en één kaartgrid zonder groepskoppen en behoudt gecombineerde basic lands', async () => {
  const deck = { id: 7, name: 'Testdeck', format: 'commander', description: '', notes: '', commander: null, secondCommander: null };
  const cards = [
    deckCard({ deckCardId: 141, cardId: 101, name: 'Alpha Creature', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 5 }),
    deckCard({ deckCardId: 142, cardId: 102, name: 'Forest', cardTypes: ['Land'], supertypes: ['Basic'], typeLine: 'Basic Land — Forest', manaValue: 0, quantity: 2 }),
    deckCard({ deckCardId: 143, cardId: 103, name: 'Beta Instant', cardTypes: ['Instant'], typeLine: 'Instant', manaValue: 2 }),
    deckCard({ deckCardId: 144, cardId: 104, name: 'Forest', cardTypes: ['Land'], supertypes: ['Basic'], typeLine: 'Basic Land — Forest', manaValue: 0, quantity: 3 }),
    deckCard({ deckCardId: 145, cardId: 105, name: 'Forest', cardTypes: ['Land'], supertypes: ['Basic'], typeLine: 'Basic Land — Forest', manaValue: 0, quantity: 1, role: 'sideboard' })
  ];
  const original = structuredClone(cards);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify({ data: String(url).endsWith('/cards') ? cards : deck }), {
    headers: { 'content-type': 'application/json' }
  });
  try {
    for (const viewName of ['list', 'cards']) {
      const view = await renderDeckDetail({ params: { id: '7' }, query: new URLSearchParams(`cardGroup=none&view=${viewName}&cardColumns=6`) });
      const document = parseHtml(view.html);
      assert.equal(document.querySelector('#deck-card-group').value, 'none');
      assert.equal(document.querySelectorAll('.deck-list-group').length, 1);
      assert.equal(document.querySelectorAll('.deck-visual-group').length, 1);
      assert.equal(document.querySelectorAll('.deck-list-group-header, .deck-visual-group-header').length, 0);
      assert.equal(document.querySelectorAll('[data-deck-type-group], [data-deck-ability-group]').length, 0);
      assert.equal(document.querySelector('#deck-card-visual').dataset.columns, '6');
      assert.equal(document.querySelector('#deck-card-list').hidden, viewName !== 'list');
      assert.equal(document.querySelector('#deck-card-visual-container').hidden, viewName !== 'cards');
      for (const viewId of ['#deck-card-list', '#deck-card-visual']) {
        const rows = document.querySelector(viewId).querySelectorAll('[data-deck-filter-card]');
        assert.deepEqual(rows.map((row) => row.dataset.displayId), ['142', '145', '143', '141']);
        assert.deepEqual(rows.map((row) => row.dataset.quantity), ['5', '1', '1', '1']);
        assert.deepEqual(rows.map((row) => row.dataset.role), ['main', 'sideboard', 'main', 'main']);
        assert.ok(rows.every((row) => row.dataset.search && row.dataset.types));
      }
      const header = document.querySelector('.page-actions');
      assert.match(header.textContent, /Meer…/);
      assert.doesNotMatch(header.textContent, /Bewerken|Importeren/);
      const exportButton = document.querySelector('#export-deck');
      assert.equal(exportButton.tagName, 'BUTTON');
      assert.equal(exportButton.getAttribute('data-write-action'), null);
    }
    assert.deepEqual(cards, original);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('abilitygroepering kiest per kaart één primaire keyword en zet kaarten zonder ability als laatste', () => {
  const flyingFirst = deckCard({
    deckCardId: 101,
    cardId: 61,
    name: 'Flying First',
    cardTypes: ['Creature'],
    typeLine: 'Creature',
    oracleText: 'FLYING\nThis creature has trample while attacking.',
    keywords: ['Trample', 'Flying'],
    manaValue: 3
  });
  const alphabeticalFallback = deckCard({
    deckCardId: 102,
    cardId: 62,
    name: 'Fallback',
    cardTypes: ['Creature'],
    typeLine: 'Creature',
    oracleText: 'Geen van de keywords staat letterlijk in deze tekst.',
    keywords: ['Ward', 'Deathtouch'],
    manaValue: 2
  });
  const none = deckCard({ deckCardId: 103, cardId: 63, name: 'Vanilla', cardTypes: ['Creature'], typeLine: 'Creature', keywords: [], manaValue: 1 });

  assert.equal(primaryDeckCardAbility(flyingFirst.card), 'Flying');
  assert.equal(primaryDeckCardAbility(alphabeticalFallback.card), 'Deathtouch');
  assert.equal(primaryDeckCardAbility(none.card), 'Geen ability');

  const groups = groupDeckCards([none, flyingFirst, alphabeticalFallback], { groupBy: 'ability', sortBy: 'mana' });
  assert.deepEqual(groups.map((group) => group.label), ['Deathtouch', 'Flying', 'Geen ability']);
  assert.deepEqual(groups.flatMap((group) => group.items.map((item) => item.id)), [102, 101, 103]);
  assert.equal(new Set(groups.flatMap((group) => group.items.map((item) => item.id))).size, 3);
});

test('abilitygroepering gebruikt bestaande functionele inzichten als vaste fallback zonder duplicaten', () => {
  const manaProducer = deckCard({
    deckCardId: 104,
    cardId: 64,
    name: 'Elf Mana Producer',
    cardTypes: ['Creature'],
    typeLine: 'Creature — Elf Druid',
    oracleText: '{T}: Add {G}.',
    insights: {
      manaProduction: { entries: [{ mana: 'G', amount: 1, variable: false }] },
      librarySearch: { targets: ['land', 'creature'] }
    }
  });
  const basicLandTutor = deckCard({
    deckCardId: 105,
    cardId: 65,
    name: 'Basic Land Tutor',
    cardTypes: ['Sorcery'],
    typeLine: 'Sorcery',
    insights: {
      manaProduction: { entries: [] },
      librarySearch: { targets: ['basic_land', 'creature'] }
    }
  });
  const creatureTutor = deckCard({
    deckCardId: 106,
    cardId: 66,
    name: 'Creature Tutor',
    cardTypes: ['Sorcery'],
    typeLine: 'Sorcery',
    insights: {
      manaProduction: { entries: [] },
      librarySearch: { targets: ['creature'] }
    }
  });
  const keywordFirst = deckCard({
    deckCardId: 107,
    cardId: 67,
    name: 'Keyword Producer',
    cardTypes: ['Creature'],
    typeLine: 'Creature',
    oracleText: 'Flying\n{T}: Add {G}.',
    keywords: ['Flying'],
    insights: {
      manaProduction: { entries: [{ mana: 'G', amount: 1, variable: false }] },
      librarySearch: { targets: ['land'] }
    }
  });
  const manualEmpty = deckCard({
    deckCardId: 108,
    cardId: 68,
    name: 'Handmatig Leeg',
    cardTypes: ['Creature'],
    typeLine: 'Creature',
    oracleText: '{T}: Add {G}. Search your library for a creature card.',
    insights: {
      manaProduction: { source: 'manual', entries: [] },
      librarySearch: { source: 'manual', targets: [] }
    }
  });

  assert.equal(primaryDeckCardAbility(manaProducer.card), 'Mana produceren');
  assert.equal(primaryDeckCardAbility(basicLandTutor.card), 'Tutor land');
  assert.equal(primaryDeckCardAbility(creatureTutor.card), 'Tutor creature');
  assert.equal(primaryDeckCardAbility(keywordFirst.card), 'Flying');
  assert.equal(primaryDeckCardAbility(manualEmpty.card), 'Geen ability');

  const cards = [manualEmpty, creatureTutor, keywordFirst, basicLandTutor, manaProducer];
  const groups = groupDeckCards(cards, { groupBy: 'ability', sortBy: 'name' });
  assert.deepEqual(groups.map((group) => group.label), [
    'Flying',
    'Mana produceren',
    'Tutor creature',
    'Tutor land',
    'Geen ability'
  ]);
  assert.deepEqual(
    [...groups.flatMap((group) => group.items.map((item) => item.id))].sort((left, right) => left - right),
    [104, 105, 106, 107, 108]
  );
});

test('deckfilters doorzoeken geneste lijstgroepen en werken groepsaantallen in beide views bij', () => {
  const source = readFileSync(new URL('../public/js/views/deck-detail.js', import.meta.url), 'utf8');
  assert.match(source, /querySelectorAll\('#deck-card-list \[data-deck-filter-card\]'\)/);
  assert.doesNotMatch(source, /querySelectorAll\('#deck-card-list > \[data-deck-filter-card\]'\)/);
  assert.match(source, /querySelectorAll\('#deck-card-list \[data-deck-card-group\], #deck-card-visual \[data-deck-card-group\]'\)/);
});

test('kaartacties verschillen correct voor Wanted en gegroepeerde basic lands', () => {
  const regular = deckCard({
    deckCardId: 61,
    cardId: 21,
    name: 'Wanted Creature',
    cardTypes: ['Creature'],
    typeLine: 'Creature',
    wantedGap: 2
  });
  assert.deepEqual(deckCardActionDescriptors(regular).map((action) => action.key), [
    'wanted', 'edit', 'insights', 'relations', 'remove'
  ]);
  assert.equal(deckCardActionDescriptors(regular)[0].label, '2 naar Wanted');
  assert.equal(deckCardActionDescriptors(regular).at(-1).destructive, true);
  assert.deepEqual(deckCardListActionDescriptors(regular).map((action) => action.key), [
    'wanted', 'edit', 'insights', 'relations', 'remove'
  ]);

  const forestA = deckCard({
    deckCardId: 71,
    cardId: 31,
    name: 'Forest',
    cardTypes: ['Land'],
    supertypes: ['Basic'],
    typeLine: 'Basic Land — Forest'
  });
  const forestB = deckCard({
    deckCardId: 72,
    cardId: 32,
    name: 'Forest',
    cardTypes: ['Land'],
    supertypes: ['Basic'],
    typeLine: 'Basic Land — Forest'
  });
  const groupedForest = {
    ...forestA,
    groupedBasicLand: true,
    displayMembers: [forestA, forestB]
  };
  assert.deepEqual(deckCardActionDescriptors(groupedForest).map((action) => action.key), ['printings', 'insights']);
  assert.equal(deckCardActionDescriptors(groupedForest)[0].write, false);
  assert.deepEqual(deckCardListActionDescriptors(groupedForest).map((action) => action.key), ['printings', 'insights']);

  const singleForest = { ...forestA, groupedBasicLand: true, displayMembers: [forestA] };
  assert.deepEqual(deckCardActionDescriptors(singleForest).map((action) => action.key), [
    'edit', 'insights', 'relations', 'remove'
  ]);
});
