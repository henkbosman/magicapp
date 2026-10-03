import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderCardDiscovery } from '../public/js/views/card-discovery.js';

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
    this.dataset = Object.fromEntries(Object.entries(attributes)
      .filter(([name]) => name.startsWith('data-'))
      .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
    for (const name of ['checked', 'disabled', 'hidden', 'selected']) this[name] = Object.hasOwn(attributes, name);
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
  setAttribute(name, value) { this.attributes[name] = String(value); }
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

async function mount(t, query = '') {
  const keys = ['fetch', 'document', 'window', 'history', 'FormData'];
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
    const request = { kind: parsed.pathname.split('/').at(-1), params: parsed.searchParams, signal: options.signal };
    requests.push(request);
    if (initial) return Promise.resolve(response(request.kind === 'options' ? allOptions : result('Initial card', 60)));
    return new Promise((resolve) => {
      request.resolve = (data) => resolve(response(data));
      request.fail = () => resolve(new Response(JSON.stringify({ error: { message: 'Test failure' } }), {
        status: 500, headers: { 'content-type': 'application/json' }
      }));
    });
  };
  globalThis.window = { location: { pathname: '/', search: '' } };
  const routes = [];
  globalThis.history = { replaceState: (_state, _title, path) => routes.push(path) };
  const view = await renderCardDiscovery({ query: new URLSearchParams(query) });
  const document = parseHtml(view.html);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  globalThis.document = document;
  globalThis.FormData = FormValues;
  initial = false;
  view.mount();
  const form = document.getElementById('discovery-filters');
  return {
    document, requests, routes, form,
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
  const reset = ui.pair();
  assert.equal(reset.options.params.has('effect'), false);
  assert.equal(reset.options.params.has('tokenPower'), false);
  assert.equal(reset.options.params.get('page'), '1');
  await ui.finish(reset, allOptions, result('Restored cards', 60));
  assert.ok(ui.control('keyword').options.some((option) => option.value === 'Flying'));
  assert.equal(ui.control('effect').value, '');
  assert.equal(ui.get('discovery-sort').value, 'relevance');
  assert.equal(ui.get('discovery-token-fields').hidden, true);
  assert.equal(ui.get('discovery-tutor-fields').hidden, true);
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
