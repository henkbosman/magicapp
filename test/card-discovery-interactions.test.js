import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderCardDiscovery } from '../public/js/views/card-discovery.js';
import { setWriteAvailability } from '../public/js/write-access.js';

// A deliberately small DOM adapter: mount the real markup and exercise its event
// handlers without adding a browser dependency to the application's test suite.
const decode = (value) => String(value).replace(/&quot;/g, '"').replace(/&#039;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const voidTags = new Set(['INPUT', 'BR', 'HR', 'IMG', 'META', 'LINK', 'WBR']);

class Element {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.children = [];
    this.listeners = new Map();
    this.dataset = new Proxy(Object.fromEntries(Object.entries(attributes)
      .filter(([name]) => name.startsWith('data-'))
      .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])), {
      set(target, key, value) {
        target[key] = String(value);
        attributes[`data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`] = String(value);
        return true;
      }
    });
    for (const name of ['checked', 'disabled', 'hidden', 'selected', 'open']) this[name] = Object.hasOwn(attributes, name);
    this.scrollTop = 0;
    this.classList = {
      add: (name) => { attributes.class = [...new Set([...(attributes.class || '').split(' '), name])].join(' '); },
      remove: (name) => { attributes.class = (attributes.class || '').split(' ').filter((value) => value !== name).join(' '); },
      contains: (name) => (attributes.class || '').split(' ').includes(name),
      toggle: (name, force) => {
        const present = force ?? !this.classList.contains(name);
        this.classList[present ? 'add' : 'remove'](name);
        return present;
      }
    };
  }

  get name() { return this.attributes.name || ''; }
  get type() { return this.attributes.type || (this.tagName === 'INPUT' ? 'text' : ''); }
  get elements() { return this.querySelectorAll('input, select, button, textarea'); }
  get options() { return this.querySelectorAll('option'); }
  get value() {
    if (this.tagName === 'SELECT') return this.options.find((option) => option.selected)?.value ?? this.options[0]?.value ?? '';
    return this.attributes.value ?? '';
  }
  set value(value) {
    if (this.tagName === 'SELECT') {
      this.options.forEach((option) => { option.selected = option.value === String(value); });
    } else this.attributes.value = String(value);
  }
  get textContent() { return this._text ?? this.children.map((child) => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(html) {
    this._html = String(html);
    this._text = undefined;
    this.children = [];
    parseHtml(this._html, this);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  matches(selector) {
    return selector.split(',').some((part) => {
      let value = part.trim();
      const not = value.match(/:not\(([^)]+)\)/);
      if (not && this.matches(not[1])) return false;
      value = value.replace(/:not\([^)]+\)/g, '');
      const tag = value.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const id = value.match(/#([\w-]+)/)?.[1];
      if (id && this.attributes.id !== id) return false;
      const className = value.match(/\.([\w-]+)/)?.[1];
      if (className && !this.classList.contains(className)) return false;
      for (const [, name, expected] of value.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!Object.hasOwn(this.attributes, name)) return false;
        if (expected !== undefined && this.attributes[name] !== expected) return false;
      }
      return true;
    });
  }
  querySelectorAll(selector) {
    return this.children.filter((child) => child instanceof Element).flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  append(child) { child.parentElement = this; this.children.push(child); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  focus() {}
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type) {
    const event = { type, target: this, preventDefault() {} };
    for (let node = this; node; node = node.parentElement) {
      for (const listener of node.listeners.get(type) || []) listener(event);
    }
  }
  scrollIntoView() {}
}

function parseHtml(html, root = new Element('document')) {
  const stack = [root];
  for (const [token] of html.matchAll(/<[^>]+>|[^<]+/g)) {
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (token.startsWith('<!')) continue;
    const parent = stack.at(-1);
    if (!token.startsWith('<')) { parent.children.push(decode(token)); continue; }
    const tagName = token.match(/^<([\w-]+)/)?.[1];
    if (!tagName) continue;
    const attributes = {};
    const attributeText = token.slice(tagName.length + 1, token.endsWith('/>') ? -2 : -1);
    for (const [, name, doubleQuoted, singleQuoted, unquoted] of attributeText.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)) {
      attributes[name] = decode(doubleQuoted ?? singleQuoted ?? unquoted ?? '');
    }
    const element = new Element(tagName, attributes);
    element.parentElement = parent;
    parent.children.push(element);
    if (!voidTags.has(element.tagName) && !token.endsWith('/>')) stack.push(element);
  }
  return root;
}

class FormValues {
  constructor(form) {
    this.values = form.elements.filter((control) => control.name && !control.disabled
      && (!['checkbox', 'radio'].includes(control.type) || control.checked))
      .map((control) => [control.name, control.value]);
  }
  entries() { return this.values.values(); }
  get(name) { return this.values.find(([key]) => key === name)?.[1] ?? null; }
  has(name) { return this.values.some(([key]) => key === name); }
  [Symbol.iterator]() { return this.entries(); }
}

const entries = (...values) => values.map((value) => ({ value, label: value, count: 2 }));
const allOptions = {
  abilities: entries('Landfall', 'Magecraft'), keywords: entries('Flying', 'Trample'),
  types: entries('Creature', 'Instant'), subtypes: entries('Elf', 'Arcane', 'Legendary'),
  effects: entries('token', 'tutor', 'draw'), legalities: entries('commander', 'modern'),
  colors: entries('W', 'U', 'B', 'R', 'G', 'C'), manaValues: entries('1', '2', '3'), manaRange: { min: 1, max: 3 },
  tokenPowers: entries('1', '2'), tokenToughnesses: entries('1', '2'), tokenTypes: entries('Elf', 'Soldier'),
  tutorTargets: entries('creature', 'land')
};
const instantOptions = { ...allOptions, types: entries('Creature', 'Instant'), subtypes: entries('Arcane'),
  keywords: [], abilities: entries('Magecraft'), colors: entries('U'), effects: entries('draw'),
  legalities: entries('modern'), manaValues: entries('2'), manaRange: { min: 2, max: 2 },
  tokenPowers: entries('1'), tokenToughnesses: entries('1'), tokenTypes: entries('Soldier'), tutorTargets: entries('land') };
const result = (name, total = 1, page = 1) => ({
  items: total === 0 ? [] : [{ id: name, name, typeLine: 'Instant', oracleText: 'Draw a card.' }],
  total, page, limit: 24, totalPages: Math.max(1, Math.ceil(total / 24))
});
const response = (data) => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deckList = [{ id: 1, name: 'Yedora' }, { id: 2, name: 'Second deck' }];

async function mount(t, query = 'type=Creature', initialCards = result('Initial card', 60), decks = deckList) {
  const keys = ['fetch', 'document', 'window', 'history', 'FormData', 'Element', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement'];
  const original = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  let initial = true;
  globalThis.fetch = (url, options) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname.endsWith('/status')) return Promise.resolve(response({ available: true, cardCount: 100 }));
    if (initial && parsed.pathname === '/api/read/decks') return Promise.resolve(response(decks));
    const request = {
      kind: parsed.pathname.split('/').at(-1), path: parsed.pathname,
      params: parsed.searchParams, signal: options.signal, method: options.method,
      body: options.body ? JSON.parse(options.body) : undefined
    };
    requests.push(request);
    if (initial) return Promise.resolve(response(request.kind === 'options' ? allOptions : initialCards));
    return new Promise((resolve) => {
      request.resolve = (data) => resolve(response(data));
      request.fail = (status = 500) => resolve(new Response(JSON.stringify({ error: { message: 'Test failure' } }), {
        status, headers: { 'content-type': 'application/json' }
      }));
    });
  };
  const session = new Map();
  globalThis.window = {
    location: { pathname: '/', search: '', hash: `#/discover${query ? `?${query}` : ''}` }, scrollY: 640,
    sessionStorage: { getItem: (key) => session.get(key) ?? null, setItem: (key, value) => session.set(key, value), removeItem: (key) => session.delete(key) }
  };
  const routes = [];
  globalThis.history = { replaceState: (_state, _title, path) => {
    routes.push(path);
    globalThis.window.location.hash = path.slice(path.indexOf('#'));
  } };
  const view = await renderCardDiscovery({ query: new URLSearchParams(query) });
  const document = parseHtml(view.html);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.documentElement = document;
  document.body = document;
  document.createElement = (tagName) => new Element(tagName);
  globalThis.document = document;
  globalThis.FormData = FormValues;
  for (const name of ['Element', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement']) globalThis[name] = Element;
  setWriteAvailability(true);
  initial = false;
  view.mount();
  const form = document.getElementById('discovery-filters');
  return {
    document, requests, routes, form, session,
    control: (name) => form.querySelector(`[name="${name}"]`),
    get: (id) => document.getElementById(id),
    edit(name, value, event = 'change') {
      const control = form.querySelector(`[name="${name}"]`);
      control.value = value;
      control.dispatch(event);
    },
    pair() {
      const pair = requests.slice(-2);
      assert.deepEqual(pair.map((request) => request.kind).sort(), ['options', 'search']);
      assert.equal(pair[0].params.toString(), pair[1].params.toString(), 'facets and results must use the same filter snapshot');
      return Object.fromEntries(pair.map((request) => [request.kind, request]));
    },
    async finish(pair, facets, cards) {
      pair.options.resolve(facets);
      pair.search.resolve(cards);
      await flush();
    },
    async tick() { t.mock.timers.tick(220); await flush(); }
  };
}

test('Legendary verschijnt als subtype, activeert aanvullende filters en combineert met Creature', async (t) => {
  const ui = await mount(t, 'deckId=2&colorIdentity=G');
  const subtype = ui.control('subtype');
  assert.ok(subtype.options.some((option) => option.value === 'Legendary' && option.textContent === 'Legendary (2)'));
  assert.equal(ui.requests.some((request) => request.kind === 'search'), false);

  ui.edit('subtype', 'Legendary');
  const legendary = ui.pair();
  assert.equal(legendary.search.params.get('subtype'), 'Legendary');
  assert.equal(legendary.search.params.has('type'), false);
  assert.equal(legendary.search.params.get('deckId'), '2', 'Legendary is a primary filter that activates the preselected deck');
  assert.equal(legendary.search.params.get('colorIdentity'), 'G');
  await ui.finish(legendary, allOptions, result('Legendary match'));

  ui.edit('type', 'Creature');
  const creatures = ui.pair();
  assert.equal(creatures.search.params.get('type'), 'Creature');
  assert.equal(creatures.search.params.get('subtype'), 'Legendary');
  await ui.finish(creatures, { ...allOptions, subtypes: entries('Elf', 'Legendary') }, result('Legendary creature'));
  assert.equal(ui.control('subtype'), subtype, 'reactive updates preserve the selected control');
  assert.equal(subtype.value, 'Legendary');
  assert.match(ui.get('discovery-results').textContent, /Legendary creature/);

  ui.get('discovery-results').querySelector('[data-discovery-lookup]').dispatch('click');
  const saved = [...ui.session.values()].map((value) => JSON.parse(value)).find((value) => value.hash?.startsWith('#/discover'));
  const query = new URLSearchParams(saved.hash.split('?')[1]);
  assert.equal(query.get('type'), 'Creature');
  assert.equal(query.get('subtype'), 'Legendary', 'returning from card lookup preserves the combination');
});

test('reactieve filters en resultaten worden samen toegepast zonder de invoervelden te vervangen', async (t) => {
  const ui = await mount(t);
  ui.pair();
  const subtype = ui.control('subtype');
  const keyword = ui.control('keyword');
  ui.edit('type', 'Instant');
  const next = ui.pair();
  assert.equal(next.options.params.get('type'), 'Instant');
  next.options.resolve(instantOptions);
  await flush();
  assert.ok(keyword.options.some((option) => option.value === 'Flying'), 'a partial response cannot update facets');
  assert.match(ui.get('discovery-results').textContent, /Initial card/);
  next.search.resolve(result('Instant match'));
  await flush();
  assert.equal(ui.control('subtype'), subtype);
  assert.equal(ui.control('keyword'), keyword);
  assert.deepEqual(subtype.options.map((option) => option.value), ['', 'Arcane']);
  assert.deepEqual(keyword.options.map((option) => option.value), ['']);
  for (const [name, expected] of Object.entries({
    ability: ['Magecraft'], type: ['Creature', 'Instant'], effect: ['draw'], legality: ['modern'],
    tokenPower: ['1'], tokenToughness: ['1'], tokenType: ['Soldier'], tutorTarget: ['land']
  })) {
    assert.deepEqual(ui.control(name).options.map((option) => option.value), ['', ...expected], `${name} must update with the other facets`);
  }
  assert.match(ui.get('discovery-results').textContent, /Instant match/);
  assert.equal(ui.get('discovery-result-count').textContent, '1 kaart gevonden');
  const colors = ui.form.querySelectorAll('input[name="colorIdentity"]');
  assert.equal(colors.find((control) => control.value === 'U').disabled, false);
  const green = colors.find((control) => control.value === 'G');
  assert.equal(green.disabled, true);
  assert.equal(green.closest('label').querySelector('[data-color-count]').textContent, '0');
  assert.equal(green.getAttribute('aria-label'), 'Groen (0 matches)');
  assert.equal(colors.find((control) => control.value === 'U').closest('label').querySelector('[data-color-count]').textContent, '2');
  assert.match(ui.get('discovery-mana-values').innerHTML, /value="2"/);
  assert.equal(ui.get('discovery-mana-values').options.length, 1);
  assert.equal(ui.get('discovery-mana-hint'), null);
  assert.deepEqual(ui.control('deckId').options.map((option) => option.value), ['', '1', '2']);
});

test('typen maakt lopende antwoorden direct ongeldig, ook voordat de debounce afloopt', async (t) => {
  const ui = await mount(t);
  ui.edit('type', 'Instant');
  const obsolete = ui.pair();
  ui.edit('name', 'L', 'input');
  assert.equal(obsolete.options.signal.aborted, true);
  await ui.finish(obsolete, instantOptions, result('Obsolete response'));
  assert.doesNotMatch(ui.get('discovery-results').textContent, /Obsolete response/);
  assert.ok(ui.control('keyword').options.some((option) => option.value === 'Flying'));
  ui.edit('name', 'Lightning', 'input');
  assert.equal(ui.requests.length, 4, 'text input waits until the debounce completes');
  await ui.tick();
  assert.equal(ui.requests.length, 6, 'rapid typing starts exactly one response pair');
  const latest = ui.pair();
  assert.equal(latest.options.params.get('name'), 'Lightning');
  await ui.finish(latest, instantOptions, result('Lightning Bolt'));
  assert.match(ui.get('discovery-results').textContent, /Lightning Bolt/);
  assert.equal(ui.control('name').value, 'Lightning');
  assert.equal(ui.form.getAttribute('aria-busy'), null);
});

test('effect wisselen sluit verborgen velden uit en reset herstelt de beschikbare opties', async (t) => {
  const ui = await mount(t, 'effect=token&tokenPower=2&tokenType=Elf');
  assert.equal(ui.control('tokenPower').disabled, false);
  ui.edit('effect', 'tutor');
  const tutor = ui.pair();
  assert.equal(ui.get('discovery-token-fields').hidden, true);
  assert.equal(ui.get('discovery-tutor-fields').hidden, false);
  assert.equal(ui.control('tokenPower').disabled, true);
  for (const request of Object.values(tutor)) {
    assert.equal(request.params.get('effect'), 'tutor');
    assert.equal(request.params.has('tokenPower'), false);
    assert.equal(request.params.has('tokenType'), false);
  }
  await ui.finish(tutor, { ...instantOptions, effects: entries('tutor') }, result('Tutor match'));
  assert.equal(ui.control('keyword').options.length, 1);
  ui.get('discovery-filter-reset').dispatch('click');
  const reset = ui.requests.at(-1);
  assert.equal(reset.kind, 'options');
  assert.equal(reset.params.has('effect'), false);
  assert.equal(reset.params.has('tokenPower'), false);
  assert.equal(reset.params.get('page'), '1');
  assert.match(ui.get('discovery-results').textContent, /Zoek kaarten voor je deck/);
  assert.doesNotMatch(ui.get('discovery-results').textContent, /Tutor match/);
  reset.resolve(allOptions);
  await flush();
  assert.ok(ui.control('keyword').options.some((option) => option.value === 'Flying'));
  assert.equal(ui.control('effect').value, '');
  assert.equal(ui.get('discovery-sort').value, 'relevance');
  assert.equal(ui.get('discovery-token-fields').hidden, true);
  assert.equal(ui.get('discovery-tutor-fields').hidden, true);
  assert.equal(ui.get('discovery-result-count').textContent, 'Nog geen zoekopdracht');
  assert.equal(ui.get('discovery-pagination-wrap').textContent, '');
});

test('lege opening, sorteren en een horizontaal filter tonen geen kaarten tot een tekstfilter wordt gekozen', async (t) => {
  const ui = await mount(t, '');
  assert.deepEqual(ui.requests.map((request) => request.kind), ['options']);
  assert.match(ui.get('discovery-results').textContent, /Zoek kaarten voor je deck/);
  assert.equal(ui.form.querySelector('.discovery-secondary-filters').getAttribute('open'), null);
  const sort = ui.get('discovery-sort');
  sort.value = 'mana';
  sort.dispatch('change');
  assert.deepEqual(ui.requests.map((request) => request.kind), ['options', 'options']);
  ui.requests.at(-1).resolve(allOptions);
  await flush();
  assert.match(ui.get('discovery-results').textContent, /Zoek kaarten voor je deck/);
  ui.edit('legality', 'modern');
  assert.equal(ui.requests.length, 2, 'pending legality does not request options or results');
  assert.equal(ui.control('legality').value, 'modern');
  assert.match(ui.routes.at(-1), /legality=modern/);
  assert.equal(ui.get('discovery-secondary-hint').hidden, false);
  ui.edit('type', 'Instant');
  assert.equal(ui.pair().search.params.get('legality'), 'modern');
  assert.equal(ui.get('discovery-secondary-hint').hidden, true);
  await ui.finish(ui.pair(), instantOptions, result('Legal card'));
  assert.match(ui.get('discovery-results').textContent, /Legal card/);
  ui.get('discovery-filter-reset').dispatch('click');
  ui.requests.at(-1).resolve(allOptions);
  await flush();
  assert.deepEqual(ui.requests.map((request) => request.kind), ['options', 'options', 'options', 'search', 'options']);
  assert.match(ui.get('discovery-results').textContent, /Zoek kaarten voor je deck/);
});

test('alle horizontale keuzes blijven klaarstaan zonder verzoek en worden samen actief na tekstinvoer', async (t) => {
  const ui = await mount(t, 'colorsOpen=1');
  const green = ui.form.querySelector('input[name="colorIdentity"][value="G"]');
  green.checked = true;
  green.dispatch('change');
  ui.edit('colorMode', 'exact');
  ui.edit('manaMin', '0', 'input');
  ui.edit('manaMax', '5', 'input');
  ui.edit('legality', 'modern');
  ui.edit('deckId', '2');
  await ui.tick();
  assert.equal(ui.requests.length, 1, 'pending choices do not fetch options or cards');
  const saved = new URLSearchParams(ui.routes.at(-1).split('?')[1]);
  for (const [name, value] of Object.entries({ colorIdentity: 'G', colorMode: 'exact', manaMin: '0', manaMax: '5', legality: 'modern', deckId: '2' })) {
    assert.equal(saved.get(name), value);
  }
  assert.equal(ui.get('discovery-secondary-hint').hidden, false);
  assert.equal(ui.get('discovery-result-count').textContent, 'Nog geen zoekopdracht');
  assert.equal(ui.form.getAttribute('aria-busy'), null);
  ui.edit('text', 'draw', 'input');
  assert.equal(ui.requests.length, 1);
  await ui.tick();
  const activated = ui.pair();
  for (const [name, value] of saved) assert.equal(activated.search.params.get(name), value);
  assert.equal(activated.search.params.get('text'), 'draw');
  assert.equal(ui.get('discovery-secondary-hint').hidden, true);
  await ui.finish(activated, instantOptions, result('Active filtered card'));
  assert.equal(green.checked, true, 'a zero-match selected color survives reactive updates');
  assert.equal(green.disabled, false);
  assert.equal(ui.control('legality').value, 'modern');
  assert.equal(ui.control('deckId').value, '2');
});

test('laatste tekstfilter wissen maakt resultaten direct leeg en oude antwoorden blijven ongeldig', async (t) => {
  const ui = await mount(t, 'text=draw&deckId=2&colorIdentity=G&manaMin=0&legality=modern');
  ui.edit('text', 'draw more', 'input');
  await ui.tick();
  const obsolete = ui.pair();
  ui.edit('text', '  ', 'input');
  assert.equal(obsolete.search.signal.aborted, true);
  assert.equal(ui.get('discovery-result-count').textContent, 'Nog geen zoekopdracht');
  assert.match(ui.get('discovery-results').textContent, /Zoek kaarten voor je deck/);
  assert.equal(ui.get('discovery-pagination-wrap').textContent, '');
  assert.equal(ui.get('discovery-secondary-hint').hidden, false);
  const resetOptions = ui.requests.at(-1);
  assert.equal(resetOptions.kind, 'options');
  for (const key of ['deckId', 'colorIdentity', 'colorMode', 'manaMin', 'legality']) assert.equal(resetOptions.params.has(key), false);
  const requestCount = ui.requests.length;
  ui.edit('deckId', '1');
  ui.edit('manaMin', '2', 'input');
  assert.equal(ui.requests.length, requestCount);
  assert.equal(resetOptions.signal.aborted, false, 'passive pending edits do not cancel equivalent options');
  await ui.finish(obsolete, instantOptions, result('Obsolete draw card'));
  assert.doesNotMatch(ui.get('discovery-results').textContent, /Obsolete draw card/);
  resetOptions.resolve(allOptions);
  await flush();
  assert.equal(ui.form.querySelector('input[name="colorIdentity"][value="G"]').checked, true);
  assert.equal(ui.control('deckId').value, '1');
  assert.equal(ui.control('manaMin').value, '2');
  assert.equal(ui.form.getAttribute('aria-busy'), null);
  await ui.tick();
  assert.equal(ui.requests.length, requestCount);
});

test('een zelfstandig effect negeert horizontale wijzigingen ook terwijl de zoekopdracht nog loopt', async (t) => {
  const ui = await mount(t, 'effect=draw&deckId=1&colorIdentity=G&manaMin=0');
  const initial = ui.pair();
  assert.equal(initial.search.params.get('effect'), 'draw');
  assert.equal(initial.search.params.has('deckId'), false);
  assert.equal(initial.search.params.has('colorIdentity'), false);
  ui.edit('effect', 'tutor');
  const next = ui.pair();
  const requestCount = ui.requests.length;
  ui.edit('deckId', '2');
  ui.edit('manaMin', '4', 'input');
  ui.edit('colorMode', 'exact');
  assert.equal(ui.requests.length, requestCount);
  assert.equal(next.search.signal.aborted, false);
  await ui.finish(next, { ...instantOptions, effects: entries('tutor'), colors: [] }, result('Tutor card'));
  assert.match(ui.get('discovery-results').textContent, /Tutor card/);
  assert.equal(ui.control('deckId').value, '2');
  const green = ui.form.querySelector('input[name="colorIdentity"][value="G"]');
  assert.equal(green.checked, true);
  assert.equal(green.disabled, false);
  assert.ok(ui.form.querySelectorAll('input[name="colorIdentity"]').every((control) => !control.disabled), 'inactive colors remain selectable');
  assert.equal(ui.control('manaMin').value, '4');
  assert.match(ui.routes.at(-1), /deckId=2/);
  ui.edit('type', 'Instant');
  const activated = ui.pair();
  assert.equal(activated.search.params.get('effect'), 'tutor');
  assert.equal(activated.search.params.get('deckId'), '2');
  assert.equal(activated.search.params.get('colorIdentity'), 'G');
  assert.equal(activated.search.params.get('manaMin'), '4');
});

test('een ongeldig wachtend deck blokkeert Gemarkeerd niet en wordt pas na kaartsoortselectie toegepast', async (t) => {
  const ui = await mount(t, 'marked=1&excludeDeckId=99&colorIdentity=G&legality=modern');
  assert.equal(ui.pair().search.params.get('marked'), '1');
  assert.equal(ui.pair().search.params.has('deckId'), false);
  assert.equal(ui.pair().options.params.has('legality'), false);
  assert.equal(ui.control('deckId').value, '99');
  assert.match(ui.control('deckId').textContent, /niet beschikbaar/);
  assert.match(ui.get('discovery-results').textContent, /Initial card/);
  assert.doesNotMatch(ui.get('discovery-results').textContent, /Deckvergelijking niet beschikbaar/);
  ui.edit('type', 'Instant');
  const active = ui.pair();
  assert.equal(active.search.params.get('deckId'), '99');
  active.search.fail(404);
  active.options.fail(404);
  await flush();
  assert.match(ui.get('discovery-results').textContent, /Deckvergelijking niet beschikbaar/);
  ui.edit('type', '');
  const restored = ui.pair();
  assert.equal(restored.search.params.get('marked'), '1');
  assert.equal(restored.search.params.has('deckId'), false);
  await ui.finish(restored, allOptions, result('Saved card'));
  assert.match(ui.get('discovery-results').textContent, /Saved card/);
  assert.equal(ui.control('deckId').value, '99');
});

test('opzoeken bewaart filters en scroll voordat nog geplande zoekinvoer kan navigatie overschrijven', async (t) => {
  const ui = await mount(t, 'type=Instant&page=3');
  ui.form.querySelector('.discovery-secondary-filters').open = true;
  ui.get('discovery-filter-panel').hidden = true;
  ui.edit('text', 'draw', 'input');
  const requestCount = ui.requests.length;
  ui.get('discovery-results').querySelector('[data-discovery-lookup]').dispatch('click');
  assert.match(globalThis.window.location.hash, /^#\/add\?name=Initial\+card&discoveryReturn=/);
  const lookupHash = globalThis.window.location.hash;
  const saved = [...ui.session.values()].map((value) => JSON.parse(value)).find((value) => value.hash?.startsWith('#/discover'));
  assert.ok(saved);
  assert.equal(new URLSearchParams(saved.hash.split('?')[1]).get('text'), 'draw');
  assert.equal(new URLSearchParams(saved.hash.split('?')[1]).get('type'), 'Instant');
  assert.equal(new URLSearchParams(saved.hash.split('?')[1]).has('page'), false);
  assert.equal(new URLSearchParams(saved.hash.split('?')[1]).get('colorsOpen'), '1');
  assert.equal(new URLSearchParams(saved.hash.split('?')[1]).get('filterPanelOpen'), '0');
  assert.equal(saved.scrollY, 640);
  await ui.tick();
  assert.equal(ui.requests.length, requestCount);
  assert.equal(globalThis.window.location.hash, lookupHash);
});

test('terugkeer herstelt filterpanelen terwijl een nieuw bezoek ingeklapt blijft', async (t) => {
  const ui = await mount(t, 'type=Instant&colorsOpen=1&filterPanelOpen=0');
  assert.equal(ui.form.querySelector('.discovery-secondary-filters').getAttribute('open'), '');
  assert.equal(ui.get('discovery-filter-panel').hidden, true);
  assert.equal(ui.get('discovery-filter-toggle').getAttribute('aria-expanded'), 'false');
  assert.match(ui.get('discovery-results').textContent, /Initial card/);
  assert.equal(ui.pair().search.params.has('colorsOpen'), false);
  assert.equal(ui.pair().search.params.has('filterPanelOpen'), false);
});

test('sorteren en pagineren mogen nieuwe invoer niet overschrijven', async (t) => {
  const ui = await mount(t);
  const sort = ui.get('discovery-sort');
  sort.value = 'mana';
  sort.dispatch('change');
  const sorted = ui.pair();
  assert.equal(sorted.options.params.get('sort'), 'mana');
  ui.edit('text', 'draw', 'input');
  await ui.finish(sorted, instantOptions, result('Stale sorted card'));
  assert.doesNotMatch(ui.get('discovery-results').textContent, /Stale sorted card/);
  await ui.tick();
  const textResults = ui.pair();
  assert.equal(textResults.search.params.get('text'), 'draw');
  await ui.finish(textResults, allOptions, result('Current draw card', 60));
  ui.get('discovery-pagination-wrap').querySelector('[data-discovery-page="2"]').dispatch('click');
  const paged = ui.pair();
  assert.equal(paged.options.params.get('page'), '2');
  ui.edit('manaMin', '2', 'input');
  await ui.finish(paged, instantOptions, result('Stale page card', 60, 2));
  assert.match(ui.get('discovery-results').textContent, /Current draw card/);
  await ui.tick();
  const latest = ui.pair();
  assert.equal(latest.options.params.get('page'), '1');
  assert.equal(latest.options.params.get('manaMin'), '2');
  assert.equal(latest.options.params.get('sort'), 'mana');
  await ui.finish(latest, instantOptions, result('Current mana card'));
  assert.match(ui.get('discovery-results').textContent, /Current mana card/);
  assert.equal(ui.control('manaMin').value, '2');
});

test('een selectie zonder matches blijft zichtbaar en geselecteerde kleuren blijven uitzetbaar', async (t) => {
  const ui = await mount(t, 'keyword=Flying&colorIdentity=G');
  ui.edit('type', 'Instant');
  await ui.finish(ui.pair(), instantOptions, result('No flying cards', 0));
  assert.equal(ui.control('keyword').value, 'Flying');
  assert.match(ui.control('keyword').textContent, /Flying \(0 matches\)/);
  const green = ui.form.querySelector('input[name="colorIdentity"][value="G"]');
  assert.equal(green.checked, true);
  assert.equal(green.disabled, false);
  assert.equal(green.closest('label').classList.contains('discovery-color-unavailable'), true);
  assert.equal(green.closest('label').querySelector('[data-color-count]').textContent, '0');
  green.checked = false;
  green.dispatch('change');
  assert.equal(green.disabled, true, 'an unavailable color becomes disabled as soon as it is unchecked');
  assert.equal(green.closest('label').classList.contains('discovery-color-unavailable'), false);
  assert.equal(ui.pair().options.params.has('colorIdentity'), false);
  await ui.finish(ui.pair(), allOptions, result('Without green'));
  const colorless = ui.form.querySelector('input[name="colorIdentity"][value="C"]');
  colorless.checked = true;
  colorless.dispatch('change');
  await ui.finish(ui.pair(), allOptions, result('Colorless cards'));
  green.checked = true;
  green.dispatch('change');
  assert.equal(colorless.checked, false);
  assert.equal(ui.pair().options.params.get('colorIdentity'), 'G');
  await ui.finish(ui.pair(), allOptions, result('Green cards'));
});

test('als één verzoek faalt blijven de vorige opties en resultaten als één geheel staan', async (t) => {
  const ui = await mount(t);
  ui.edit('type', 'Instant');
  const next = ui.pair();
  next.options.resolve(instantOptions);
  next.search.fail();
  await flush();
  assert.match(ui.get('discovery-results').textContent, /Initial card/);
  assert.ok(ui.control('keyword').options.some((option) => option.value === 'Flying'));
  assert.equal(next.options.signal.aborted, true);
  assert.equal(ui.form.getAttribute('aria-busy'), null);
  assert.equal(ui.get('discovery-results').getAttribute('aria-busy'), null);
});

test('Filters verbergen verbergt ook kleur, mana en legaliteit zonder de gekozen filters te wissen', async (t) => {
  const ui = await mount(t, 'type=Instant&colorsOpen=1');
  const secondary = ui.form.querySelector('.discovery-secondary-filters');
  const requestCount = ui.requests.length;
  assert.equal(secondary.hidden, false);
  ui.get('discovery-filter-toggle').dispatch('click');
  assert.equal(ui.get('discovery-filter-panel').hidden, true);
  assert.equal(secondary.hidden, true);
  assert.equal(secondary.open, true, 'the separate collapsed state must be preserved');
  assert.equal(ui.control('type').value, 'Instant');
  assert.equal(ui.requests.length, requestCount);
  ui.get('discovery-filter-toggle').dispatch('click');
  assert.equal(ui.get('discovery-filter-panel').hidden, false);
  assert.equal(secondary.hidden, false);
  assert.equal(secondary.open, true);
});

test('terugkeer bewaart de ingeklapte secties en de eigen scrollpositie van de filters', async (t) => {
  const ui = await mount(t, 'type=Instant&textOpen=0&effectOpen=0&filterScroll=175&filterPanelOpen=0');
  assert.equal(ui.get('discovery-text-filters').open, false);
  assert.equal(ui.get('discovery-effect-filters').open, false);
  assert.equal(ui.form.querySelector('.discovery-secondary-filters').hidden, true);
  assert.equal(ui.get('discovery-filter-panel').scrollTop, 175);
  ui.get('discovery-effect-filters').open = true;
  ui.get('discovery-filter-panel').scrollTop = 93;
  ui.get('discovery-results').querySelector('[data-discovery-lookup]').dispatch('click');
  const saved = [...ui.session.values()].map((value) => JSON.parse(value)).find((value) => value.hash?.startsWith('#/discover'));
  const query = new URLSearchParams(saved.hash.split('?')[1]);
  assert.equal(query.get('textOpen'), '0');
  assert.equal(query.get('effectOpen'), '1');
  assert.equal(query.get('filterScroll'), '93');
  assert.equal(query.get('filterPanelOpen'), '0');
  for (const field of ['textOpen', 'effectOpen', 'filterScroll', 'filterPanelOpen']) assert.equal(ui.pair().search.params.has(field), false);
});

test('Gemarkeerd start zelfstandig zoeken en reset wist ook deze selectie', async (t) => {
  const ui = await mount(t, '');
  const marked = ui.control('marked');
  marked.checked = true;
  marked.dispatch('change');
  const next = ui.pair();
  assert.equal(next.search.params.get('marked'), '1');
  await ui.finish(next, allOptions, { ...result('Saved card'), items: [{ ...result('Saved card').items[0], marked: true }] });
  assert.match(ui.get('discovery-results').textContent, /Saved card/);
  assert.equal(ui.get('discovery-results').querySelector('[data-discovery-mark]').getAttribute('aria-pressed'), 'true');
  ui.get('discovery-filter-reset').dispatch('click');
  assert.equal(marked.checked, false);
  assert.equal(ui.requests.at(-1).kind, 'options');
  assert.equal(ui.requests.at(-1).params.has('marked'), false);
  ui.requests.at(-1).resolve(allOptions);
  await flush();
  assert.match(ui.get('discovery-results').textContent, /Zoek kaarten voor je deck/);
});

test('deck vergelijken wacht op een tekstfilter, stuurt daarna gelijke queries en reset de selectie', async (t) => {
  const ui = await mount(t, '');
  const select = ui.control('deckId');
  assert.equal(select.disabled, false);
  ui.edit('deckId', '2');
  assert.equal(ui.requests.length, 1);
  assert.match(ui.routes.at(-1), /deckId=2/);
  assert.doesNotMatch(ui.get('discovery-filter-toggle').textContent, /1 actief/);
  ui.edit('type', 'Instant');
  const next = ui.pair();
  assert.equal(next.search.params.get('deckId'), '2');
  assert.match(ui.routes.at(-1), /deckId=2/);
  await ui.finish(next, allOptions, result('Card to compare'));
  assert.equal(ui.control('deckId'), select, 'reactive updates keep the deck dropdown mounted');
  assert.deepEqual(select.options.map((option) => option.value), ['', '1', '2'], 'all decks remain selectable');
  assert.equal(select.value, '2');
  assert.match(ui.get('discovery-filter-toggle').textContent, /2/);
  ui.get('discovery-filter-reset').dispatch('click');
  assert.equal(select.value, '');
  assert.equal(ui.requests.at(-1).kind, 'options');
  assert.equal(ui.requests.at(-1).params.has('deckId'), false);
  ui.requests.at(-1).resolve(allOptions);
  await flush();
  assert.match(ui.get('discovery-results').textContent, /Zoek kaarten voor je deck/);
});

test('oude deckselectie blijft behouden bij opzoeken en terugkeer, ook zonder schrijftoegang', async (t) => {
  const cards = result('Already in deck');
  cards.items[0].inDeck = true;
  const ui = await mount(t, 'excludeDeckId=2&type=Instant&colorsOpen=1&textOpen=0&filterScroll=75', cards);
  assert.equal(ui.pair().search.params.get('deckId'), '2');
  assert.equal(ui.pair().search.params.has('excludeDeckId'), false);
  setWriteAvailability(false);
  assert.equal(ui.control('deckId').value, '2');
  assert.equal(ui.control('deckId').disabled, false);
  assert.match(ui.get('discovery-results').textContent, /Already in deck/);
  assert.match(ui.get('discovery-results').textContent, /Al in deck/);
  const addButton = ui.get('discovery-results').querySelector('[data-discovery-deck]');
  assert.equal(addButton.disabled, true);
  const before = ui.requests.length;
  addButton.dispatch('click');
  assert.equal(ui.requests.length, before);
  assert.equal(ui.document.querySelector('dialog'), null);
  ui.get('discovery-results').querySelector('[data-discovery-lookup]').dispatch('click');
  const saved = [...ui.session.values()].map((value) => JSON.parse(value)).find((value) => value.hash?.startsWith('#/discover'));
  const query = new URLSearchParams(saved.hash.split('?')[1]);
  assert.equal(query.get('deckId'), '2');
  assert.equal(query.has('excludeDeckId'), false);
  assert.equal(query.get('type'), 'Instant');
  assert.equal(query.get('colorsOpen'), '1');
  assert.equal(query.get('textOpen'), '0');
  assert.equal(query.get('filterScroll'), '75');
});

test('wisselen en wissen van het deck vernieuwt badges met behoud van resultaten en persoonlijke markeringen', async (t) => {
  const cards = { ...result('First card', 2), items: [
    { ...result('First card').items[0], inDeck: true, marked: true },
    { ...result('Second card').items[0], inDeck: false, marked: false }
  ] };
  const ui = await mount(t, 'deckId=1&type=Instant', cards);
  const articles = () => ui.get('discovery-results').querySelectorAll('article');
  assert.ok(articles()[0].classList.contains('discovery-card-in-deck'));
  assert.equal(articles()[1].querySelector('.discovery-deck-badge'), null);
  ui.edit('deckId', '2');
  const next = ui.pair();
  assert.equal(next.search.params.get('deckId'), '2');
  await ui.finish(next, allOptions, { ...cards, items: cards.items.map((card) => ({ ...card, inDeck: !card.inDeck })) });
  assert.equal(articles().length, 2);
  assert.equal(articles()[0].querySelector('.discovery-deck-badge'), null);
  assert.ok(articles()[1].classList.contains('discovery-card-in-deck'));
  assert.equal(articles()[0].querySelector('[data-discovery-mark]').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.get('discovery-result-count').textContent, '2 kaarten gevonden');
  assert.deepEqual(ui.control('type').options.map((option) => option.value), ['', 'Creature', 'Instant']);
  ui.edit('deckId', '');
  const cleared = ui.pair();
  assert.equal(cleared.search.params.has('deckId'), false);
  await ui.finish(cleared, allOptions, { ...cards, items: cards.items.map((card) => ({ ...card, inDeck: false })) });
  assert.equal(articles().length, 2);
  assert.equal(ui.get('discovery-results').querySelector('.discovery-deck-badge'), null);
  assert.equal(ui.get('discovery-result-count').textContent, '2 kaarten gevonden');
});

test('een verwijderd vergelijkingsdeck blijft zichtbaar en kan worden gewist', async (t) => {
  const ui = await mount(t, 'deckId=99&type=Instant');
  assert.equal(ui.control('deckId').value, '99');
  assert.match(ui.control('deckId').textContent, /Deck #99 \(niet beschikbaar\)/);
  assert.match(ui.get('discovery-results').textContent, /Deckvergelijking niet beschikbaar/);
  assert.match(ui.get('discovery-results').textContent, /Geen deck geselecteerd/);
  assert.doesNotMatch(ui.get('discovery-results').textContent, /uitsluiten|verbergen/);
  assert.equal(ui.requests.length, 0);
  ui.edit('deckId', '');
  const next = ui.pair();
  assert.equal(next.search.params.has('deckId'), false);
  assert.equal(next.search.params.get('type'), 'Instant');
  await ui.finish(next, instantOptions, result('Restored search'));
  assert.match(ui.get('discovery-results').textContent, /Restored search/);
});

test('een deck dat tijdens het zoeken verdwijnt toont geen verouderde resultaten en blijft uitzetbaar', async (t) => {
  const ui = await mount(t, 'deckId=2&type=Instant');
  ui.edit('type', 'Creature');
  const next = ui.pair();
  next.options.fail(404);
  next.search.fail(404);
  await flush();
  assert.equal(ui.control('deckId').value, '2');
  assert.equal(ui.control('type').value, 'Creature');
  assert.match(ui.get('discovery-results').textContent, /Deckvergelijking niet beschikbaar/);
  assert.doesNotMatch(ui.get('discovery-results').textContent, /Initial card/);
  assert.equal(ui.get('discovery-pagination-wrap').textContent, '');
  ui.edit('deckId', '');
  await ui.finish(ui.pair(), allOptions, result('Recovered search'));
  assert.match(ui.get('discovery-results').textContent, /Recovered search/);
});

for (const nextDeck of ['2', '']) {
  test(`een mislukte deckwissel naar '${nextDeck}' toont geen badges van het vorige deck`, async (t) => {
    const cards = result('Old deck card');
    cards.items[0].inDeck = true;
    const ui = await mount(t, 'deckId=1&type=Instant', cards);
    ui.edit('deckId', nextDeck);
    const next = ui.pair();
    next.options.fail(500);
    next.search.fail(500);
    await flush();
    assert.equal(ui.control('deckId').value, nextDeck);
    assert.match(ui.get('discovery-results').textContent, /Deckvergelijking niet beschikbaar/);
    assert.doesNotMatch(ui.get('discovery-results').textContent, /Old deck card|Al in deck/);
    assert.equal(ui.get('discovery-pagination-wrap').textContent, '');
  });
}

test('Naar deck opent één popup met het filterdeck en annuleren verandert geen resultaten', async (t) => {
  const ui = await mount(t, 'deckId=2&type=Instant');
  const button = ui.get('discovery-results').querySelector('[data-discovery-deck]');
  const before = ui.requests.length;
  button.dispatch('click');
  const request = ui.requests.at(-1);
  assert.equal(request.path, '/api/read/decks');
  assert.equal(button.disabled, true);
  button.dispatch('click');
  assert.equal(ui.requests.length, before + 1);
  request.resolve(deckList);
  await flush();
  const dialog = ui.document.querySelector('dialog');
  assert.ok(dialog?.open);
  assert.equal(dialog.querySelector('[name="deckId"]').value, '2');
  assert.equal(dialog.querySelector('[name="addMissingWanted"]').checked, false);
  assert.equal(button.disabled, true);
  button.dispatch('click');
  assert.equal(ui.requests.length, before + 1);
  dialog.querySelector('.close-dialog').dispatch('click');
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.equal(button.disabled, false);
  assert.equal(ui.requests.length, before + 1, 'cancelling does not refresh facets or cards');
  assert.match(ui.get('discovery-results').textContent, /Initial card/);
});

test('een late deckpopup wordt gesloten als de ontdekpagina intussen verlaten is', async (t) => {
  const ui = await mount(t);
  ui.get('discovery-results').querySelector('[data-discovery-deck]').dispatch('click');
  ui.form.isConnected = false;
  ui.requests.at(-1).resolve(deckList);
  await flush();
  assert.equal(ui.document.querySelector('dialog'), null);
});

test('toevoegen vanuit ontdekken houdt de kaart zichtbaar en vernieuwt de deckstatus zonder navigatie', async (t) => {
  const cards = result('Discovery card');
  cards.items[0].catalogId = 'atomic-17';
  cards.items[0].scryfallOracleId = '00000000-0000-0000-0000-000000000017';
  const ui = await mount(t, 'deckId=2&type=Instant&colorsOpen=1&textOpen=0&filterScroll=75', cards);
  ui.get('discovery-results').querySelector('[data-discovery-deck]').dispatch('click');
  ui.requests.at(-1).resolve(deckList);
  await flush();
  const dialog = ui.document.querySelector('dialog');
  dialog.querySelector('form').dispatch('submit');
  const write = ui.requests.at(-1);
  assert.equal(write.path, '/api/write/decks/2/cards');
  assert.equal(write.method, 'POST');
  assert.equal(write.body.name, 'Discovery card');
  assert.equal(write.body.expectedOracleId, cards.items[0].scryfallOracleId);
  assert.equal(Object.hasOwn(write.body, 'cardId'), false);
  ui.edit('text', 'draw', 'input');
  write.resolve({ card: { id: 801, usage: { shortage: 1, wanted: 0 } } });
  await flush();
  const refresh = ui.pair();
  assert.equal(refresh.search.params.get('deckId'), '2');
  assert.equal(refresh.search.params.get('type'), 'Instant');
  assert.equal(refresh.search.params.get('text'), 'draw', 'confirmation uses controls as they are now');
  const beforeTick = ui.requests.length;
  await ui.tick();
  assert.equal(ui.requests.length, beforeTick, 'mutation refresh consumes the pending text debounce');
  await ui.finish(refresh, allOptions, { ...cards, items: [{ ...cards.items[0], inDeck: true }] });
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.match(ui.get('discovery-results').textContent, /Discovery card/);
  assert.match(ui.get('discovery-results').textContent, /Al in deck/);
  assert.equal(ui.get('discovery-result-count').textContent, '1 kaart gevonden');
  assert.ok(ui.get('discovery-results').querySelector('.discovery-card-in-deck'));
  assert.equal(ui.control('deckId').value, '2');
  assert.equal(ui.control('text').value, 'draw');
  assert.equal(ui.get('discovery-secondary-filters').open, true);
  assert.equal(ui.get('discovery-text-filters').open, false);
  assert.equal(ui.get('discovery-filter-panel').scrollTop, 75);
  assert.equal(window.scrollY, 640);
  assert.equal(ui.get('discovery-results').querySelector('[data-discovery-deck]').disabled, false);
  assert.equal(ui.requests.filter((request) => request.method === 'POST').length, 1, 'Wanted stays opt-in');
});

test('toevoegen aan het vergelijkingsdeck behoudt de resultatenpagina en het totale aantal kaarten', async (t) => {
  const cards = result('Last card on page', 25, 2);
  cards.items[0].catalogId = 'atomic-last';
  const ui = await mount(t, 'deckId=2&type=Instant&page=2', cards);
  ui.get('discovery-results').querySelector('[data-discovery-deck]').dispatch('click');
  ui.requests.at(-1).resolve(deckList);
  await flush();
  ui.document.querySelector('dialog').querySelector('form').dispatch('submit');
  ui.requests.at(-1).resolve({ card: { id: 802, usage: {} } });
  await flush();
  const refresh = ui.pair();
  assert.equal(refresh.search.params.get('page'), '2');
  assert.equal(refresh.search.params.get('deckId'), '2');
  const requestCount = ui.requests.length;
  await ui.finish(refresh, allOptions, { ...cards, items: [{ ...cards.items[0], inDeck: true }] });
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.match(ui.get('discovery-results').textContent, /Last card on page/);
  assert.match(ui.get('discovery-results').textContent, /Al in deck/);
  assert.match(ui.get('discovery-result-count').textContent, /25 kaarten gevonden/);
  assert.match(ui.get('discovery-pagination-wrap').textContent, /Pagina 2 van 2/);
  assert.equal(ui.requests.length, requestCount, 'membership does not cause page clamping');
});

test('een mislukte verversing na toevoegen toont geen verouderde deckstatus', async (t) => {
  const ui = await mount(t, 'deckId=2&type=Instant', result('Just added card'));
  ui.get('discovery-results').querySelector('[data-discovery-deck]').dispatch('click');
  ui.requests.at(-1).resolve(deckList);
  await flush();
  ui.document.querySelector('dialog').querySelector('form').dispatch('submit');
  ui.requests.at(-1).resolve({ card: { id: 802, usage: {} } });
  await flush();
  const refresh = ui.pair();
  refresh.options.fail(500);
  refresh.search.fail(500);
  await flush();
  assert.equal(ui.document.querySelector('dialog'), null);
  assert.match(ui.get('discovery-results').textContent, /Deckvergelijking niet beschikbaar/);
  assert.doesNotMatch(ui.get('discovery-results').textContent, /Just added card/);
  assert.equal(ui.control('deckId').value, '2');
});

test('markeren wordt pas bevestigd door de API en dubbele klikken sturen maar één mutatie', async (t) => {
  const cards = result('Interesting card');
  cards.items[0].scryfallOracleId = 'abc-123';
  const ui = await mount(t, 'type=Instant', cards);
  const button = ui.get('discovery-results').querySelector('[data-discovery-mark]');
  const requestCount = ui.requests.length;
  button.dispatch('click');
  const write = ui.requests.at(-1);
  assert.equal(write.path, '/api/write/discovery-marks');
  assert.equal(write.method, 'POST');
  assert.deepEqual(write.body, { name: 'Interesting card', scryfallOracleId: 'abc-123', marked: true });
  assert.equal(button.disabled, true);
  assert.equal(button.dataset.writeInitiallyDisabled, 'true');
  assert.equal(button.getAttribute('aria-pressed'), 'false', 'do not claim the change is saved while its request is pending');
  assert.match(button.textContent, /Opslaan/);
  button.dispatch('click');
  assert.equal(ui.requests.length, requestCount + 1);
  write.resolve({ marked: true, markKey: 'oracle:abc-123' });
  await flush();
  const confirmed = ui.get('discovery-results').querySelector('[data-discovery-mark]');
  assert.equal(confirmed.getAttribute('aria-pressed'), 'true');
  assert.equal(confirmed.disabled, false);
  assert.match(confirmed.textContent, /Gemarkeerd/);
  const next = ui.pair();
  await ui.finish(next, allOptions, { ...cards, items: [{ ...cards.items[0], marked: true, markKey: 'oracle:abc-123' }] });
  ui.get('discovery-results').querySelector('[data-discovery-mark]').dispatch('click');
  assert.equal(ui.requests.at(-1).body.marked, false, 'the confirmed button can remove the mark');
});

for (const status of [500, 403]) {
  test(`een mislukte markering (${status}) houdt de bevestigde toestand en respecteert schrijftoegang`, async (t) => {
    const ui = await mount(t);
    const button = ui.get('discovery-results').querySelector('[data-discovery-mark]');
    const count = ui.requests.length;
    button.dispatch('click');
    ui.requests.at(-1).fail(status);
    await flush();
    assert.equal(ui.requests.length, count + 1, 'a failed write does not restart search');
    const restored = ui.get('discovery-results').querySelector('[data-discovery-mark]');
    assert.equal(restored.getAttribute('aria-pressed'), 'false');
    assert.match(restored.textContent, /Markeren/);
    assert.equal(restored.dataset.writeInitiallyDisabled, 'false');
    assert.equal(restored.disabled, status === 403);
    assert.equal(restored.getAttribute('aria-disabled'), status === 403 ? 'true' : 'false');
    assert.equal(ui.control('type').value, 'Creature');
  });
}

test('markeerbevestiging gebruikt de huidige filters en annuleert nog geplande typinvoer', async (t) => {
  const ui = await mount(t);
  ui.get('discovery-results').querySelector('[data-discovery-mark]').dispatch('click');
  const write = ui.requests.at(-1);
  ui.edit('text', 'create', 'input');
  write.resolve({ marked: true, markKey: 'name:initial card' });
  await flush();
  const next = ui.pair();
  assert.equal(next.search.params.get('text'), 'create');
  assert.equal(next.search.params.get('type'), 'Creature');
  const count = ui.requests.length;
  await ui.tick();
  assert.equal(ui.requests.length, count, 'the pending debounce was replaced by the confirmed mutation refresh');
  await ui.finish(next, allOptions, { ...result('Current create match'), items: [{ ...result('Current create match').items[0], marked: true }] });
  assert.equal(ui.control('text').value, 'create');
  assert.match(ui.get('discovery-results').textContent, /Current create match/);
});

test('een oud zoekantwoord kan een bevestigde markering niet overschrijven', async (t) => {
  const ui = await mount(t);
  ui.get('discovery-results').querySelector('[data-discovery-mark]').dispatch('click');
  const write = ui.requests.at(-1);
  ui.edit('type', 'Instant');
  const old = ui.pair();
  write.resolve({ marked: true, markKey: 'name:initial card' });
  await flush();
  assert.equal(old.search.signal.aborted, true);
  const fresh = ui.pair();
  await ui.finish(old, instantOptions, result('Stale mark result'));
  assert.doesNotMatch(ui.get('discovery-results').textContent, /Stale mark result/);
  await ui.finish(fresh, instantOptions, { ...result('Initial card'), items: [{ ...result('Initial card').items[0], marked: true }] });
  assert.equal(ui.get('discovery-results').querySelector('[data-discovery-mark]').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.control('type').value, 'Instant');
});

test('opnieuw weergegeven kaart blijft geblokkeerd zolang haar markering wordt opgeslagen', async (t) => {
  const ui = await mount(t);
  ui.get('discovery-results').querySelector('[data-discovery-mark]').dispatch('click');
  const write = ui.requests.at(-1);
  ui.edit('type', 'Instant');
  await ui.finish(ui.pair(), instantOptions, result('Initial card'));
  const replacement = ui.get('discovery-results').querySelector('[data-discovery-mark]');
  assert.equal(replacement.disabled, true);
  assert.equal(replacement.dataset.writeInitiallyDisabled, 'true');
  assert.match(replacement.textContent, /Opslaan/);
  const count = ui.requests.length;
  replacement.dispatch('click');
  assert.equal(ui.requests.length, count);
  write.fail();
  await flush();
  const restored = ui.get('discovery-results').querySelector('[data-discovery-mark]');
  assert.equal(restored.disabled, false);
  assert.equal(restored.getAttribute('aria-pressed'), 'false');
});

test('laatste markering op een vervolgpagina verwijderen keert terug naar de laatste geldige pagina', async (t) => {
  const cards = result('Last marked card', 25, 2);
  cards.items[0].marked = true;
  const ui = await mount(t, 'marked=1&page=2', cards);
  ui.get('discovery-results').querySelector('[data-discovery-mark]').dispatch('click');
  const write = ui.requests.at(-1);
  assert.equal(write.body.marked, false);
  write.resolve({ marked: false, markKey: 'name:last marked card' });
  await flush();
  const refresh = ui.pair();
  assert.equal(refresh.search.params.get('marked'), '1');
  assert.equal(refresh.search.params.get('page'), '2');
  await ui.finish(refresh, allOptions, { items: [], total: 24, page: 2, limit: 24, totalPages: 1 });
  const clamped = ui.pair();
  assert.notEqual(clamped.search, refresh.search, 'clamping must issue a new search');
  assert.equal(clamped.search.params.get('page'), '1');
  await ui.finish(clamped, allOptions, { ...result('Remaining marked card', 24), items: [{ ...result('Remaining marked card').items[0], marked: true }] });
  assert.match(ui.get('discovery-results').textContent, /Remaining marked card/);
  assert.doesNotMatch(ui.get('discovery-results').textContent, /Last marked card/);
  assert.match(ui.get('discovery-result-count').textContent, /24 kaarten gevonden/);
  assert.equal(ui.get('discovery-pagination-wrap').textContent, '');
});
