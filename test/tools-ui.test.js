import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderTools } from '../public/js/views/tools.js';
import { applyWriteAvailability, setWriteAvailability } from '../public/js/write-access.js';
import { Element, parseHtml } from './support/dom.js';

function mount(t, { readOnly = false } = {}) {
  const names = ['document', 'fetch', 'Element', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement'];
  const originals = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error('Tools must not use a network API.'); };
  const view = renderTools();
  const document = parseHtml(view.html);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.documentElement = document;
  for (const form of document.querySelectorAll('form')) {
    form.removeEventListener = (type, handler) => {
      form.listeners.set(type, (form.listeners.get(type) || []).filter((listener) => listener !== handler));
    };
  }
  globalThis.document = document;
  for (const name of names.filter((name) => name.includes('Element'))) globalThis[name] = Element;
  setWriteAvailability(!readOnly);
  const dispose = view.mount();
  applyWriteAvailability(document);
  t.after(() => {
    dispose();
    setWriteAvailability(true);
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    }
  });
  const form = (id) => document.getElementById(`draw-odds-${id}`);
  const input = (id, name) => form(id).querySelector(`[name="${name}"]`);
  return {
    document, form, input, dispose, requests: () => requests,
    result: (id, name) => form(id).querySelector(`[data-odds-result="${name}"]`)?.textContent ?? null,
    error: (id) => form(id).querySelector('.draw-odds-error'),
    change(id, values, event = 'input') {
      for (const [name, value] of Object.entries(values)) input(id, name).value = value;
      input(id, Object.keys(values).at(-1)).dispatch(event);
    }
  };
}

test('Tools renders both calculators with computed defaults and six hypergeometric results', (t) => {
  const ui = mount(t);
  assert.match(ui.document.querySelector('.page-header').textContent, /Tools/);
  assert.equal(ui.form('hypergeometric').querySelectorAll('[data-odds-result]').length, 6);
  assert.equal(ui.result('hypergeometric', 'atLeast'), '39,95%');
  assert.equal(ui.result('hypergeometric', 'exact'), '33,63%');
  assert.equal(ui.result('hypergeometric', 'expected'), '0,4667');
  assert.equal(ui.result('multivariate', 'intersect'), '14,54%');
  assert.match(ui.document.textContent, /zonder terugleggen en zonder mulligans/);
  assert.match(ui.document.textContent, /command zone of sideboard/);
  assert.match(ui.document.textContent, /groepen zonder overlap/);
  assert.equal(ui.requests(), 0);
});

test('hypergeometric results update while typing and preserve exact small-deck outcomes', (t) => {
  const ui = mount(t);
  ui.change('hypergeometric', { deckSize: 4, copies: 2, draws: 2, target: 1 });
  assert.equal(ui.result('hypergeometric', 'lessThan'), '16,67%');
  assert.equal(ui.result('hypergeometric', 'atMost'), '83,33%');
  assert.equal(ui.result('hypergeometric', 'exact'), '66,67%');
  assert.equal(ui.result('hypergeometric', 'atLeast'), '83,33%');
  assert.equal(ui.result('hypergeometric', 'greaterThan'), '16,67%');
  assert.equal(ui.result('hypergeometric', 'expected'), '1');
  ui.change('hypergeometric', { target: 3 }, 'change');
  assert.equal(ui.result('hypergeometric', 'exact'), '0,00%');
  assert.equal(ui.result('hypergeometric', 'atLeast'), '0,00%');
  assert.equal(ui.result('hypergeometric', 'lessThan'), '100,00%');
});

test('multivariate calculator uses both groups jointly rather than multiplying independent odds', (t) => {
  const ui = mount(t);
  ui.change('multivariate', { deckSize: 4, copiesA: 1, copiesB: 1, draws: 2 });
  // Of six two-card hands exactly one contains the only A and the only B.
  assert.equal(ui.result('multivariate', 'intersect'), '16,67%');
  ui.change('multivariate', { copiesB: 2 });
  assert.equal(ui.result('multivariate', 'intersect'), '33,33%');
  ui.change('multivariate', { draws: 4 });
  assert.equal(ui.result('multivariate', 'intersect'), '100,00%');
  ui.change('multivariate', { copiesA: 0 });
  assert.equal(ui.result('multivariate', 'intersect'), '0,00%');
});

test('empty, malformed and out-of-range input clears stale results and recovers immediately', (t) => {
  const ui = mount(t);
  for (const value of ['', ' ', '-1', '1.2', '1e2', 'Infinity', '10001']) {
    ui.change('hypergeometric', { copies: value });
    assert.equal(ui.input('hypergeometric', 'copies').getAttribute('aria-invalid'), 'true', value);
    assert.equal(ui.error('hypergeometric').hidden, false, value);
    assert.match(ui.error('hypergeometric').textContent, /heel getal/);
    assert.equal(ui.result('hypergeometric', 'atLeast'), null, value);
    assert.equal(ui.form('hypergeometric').querySelector('[data-odds-results]').hidden, true);
    assert.equal(ui.result('multivariate', 'intersect'), '14,54%');
  }
  ui.change('hypergeometric', { copies: 0 });
  assert.equal(ui.input('hypergeometric', 'copies').getAttribute('aria-invalid'), 'false');
  assert.equal(ui.error('hypergeometric').hidden, true);
  assert.equal(ui.error('hypergeometric').textContent, '');
  assert.equal(ui.result('hypergeometric', 'atLeast'), '0,00%');
});

test('cross-field constraints reject impossible decks; valid zero draws remain valid', (t) => {
  const ui = mount(t);
  ui.change('hypergeometric', { copies: 61 });
  assert.equal(ui.error('hypergeometric').hidden, false);
  assert.equal(ui.result('hypergeometric', 'exact'), null);
  ui.change('hypergeometric', { copies: 4, draws: 61 });
  assert.equal(ui.error('hypergeometric').hidden, false);
  ui.change('multivariate', { copiesA: 31, copiesB: 30 });
  assert.equal(ui.error('multivariate').hidden, false);
  assert.equal(ui.result('multivariate', 'intersect'), null);
  ui.change('hypergeometric', { deckSize: 1, copies: 0, draws: 0, target: 0 });
  assert.equal(ui.error('hypergeometric').hidden, true);
  assert.equal(ui.result('hypergeometric', 'exact'), '100,00%');
  assert.equal(ui.result('hypergeometric', 'expected'), '0');
  ui.change('multivariate', { deckSize: 1, copiesA: 1, copiesB: 0, draws: 0 });
  assert.equal(ui.error('multivariate').hidden, true);
  assert.equal(ui.result('multivariate', 'intersect'), '0,00%');
});

test('calculators remain usable in read-only mode and expose labels and live feedback', (t) => {
  const ui = mount(t, { readOnly: true });
  for (const field of ui.document.querySelectorAll('input')) {
    assert.equal(field.disabled, false);
    assert.ok(ui.document.querySelector(`label[for="${field.getAttribute('id')}"]`));
    assert.ok(ui.document.getElementById(field.getAttribute('aria-describedby')));
  }
  assert.equal(ui.document.querySelectorAll('[aria-live="polite"]').length, 2);
  assert.equal(ui.document.querySelectorAll('[data-write-action]').length, 0);
  ui.change('hypergeometric', { copies: 60 });
  assert.equal(ui.result('hypergeometric', 'atLeast'), '100,00%');
  assert.equal(ui.requests(), 0);
});

test('Enter does not navigate and disposing the view removes all form listeners', (t) => {
  const ui = mount(t);
  let prevented = false;
  ui.form('hypergeometric').dispatch('submit', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  ui.dispose();
  for (const form of ui.document.querySelectorAll('form')) {
    assert.ok([...form.listeners.values()].every((listeners) => listeners.length === 0));
  }
  const previous = ui.result('hypergeometric', 'atLeast');
  ui.change('hypergeometric', { copies: 60 });
  assert.equal(ui.result('hypergeometric', 'atLeast'), previous);
});

test('tiny probabilities are not presented as impossible or certain', (t) => {
  const ui = mount(t);
  ui.change('hypergeometric', { deckSize: 10000, copies: 2, draws: 2, target: 2 });
  assert.equal(ui.result('hypergeometric', 'exact'), '< 0,01%');
  assert.equal(ui.result('hypergeometric', 'lessThan'), '> 99,99%');
});
