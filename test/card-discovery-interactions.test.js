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
  [Symbol.iterator]() { return this.entries(); }
}

const entries = (...values) => values.map((value) => ({ value, label: value, count: 2 }));
const allOptions = {
  abilities: entries('Landfall', 'Magecraft'), keywords: entries('Flying', 'Trample'),
  types: entries('Creature', 'Instant'), subtypes: entries('Elf', 'Arcane'),
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

async function mount(t, query = 'type=Creature', initialCards = result('Initial card', 60)) {
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
  assert.match(ui.get('discovery-mana-hint').textContent, /2–2/);
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

test('lege opening, sorteren en reset tonen geen kaarten; een horizontaal filter start wel zoeken', async (t) => {
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
  assert.equal(ui.pair().search.params.get('legality'), 'modern');
  await ui.finish(ui.pair(), instantOptions, result('Legal card'));
  assert.match(ui.get('discovery-results').textContent, /Legal card/);
  ui.get('discovery-filter-reset').dispatch('click');
  ui.requests.at(-1).resolve(allOptions);
  await flush();
  assert.deepEqual(ui.requests.map((request) => request.kind), ['options', 'options', 'options', 'search', 'options']);
  assert.match(ui.get('discovery-results').textContent, /Zoek kaarten voor je deck/);
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
