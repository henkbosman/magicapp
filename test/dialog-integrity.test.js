import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openDialog } from '../public/js/utils.js';
import { applyWriteAvailability, setWriteAvailability } from '../public/js/write-access.js';
import { Element, parseHtml } from './support/dom.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

class FormValues {
  constructor(form) {
    this.values = form.elements.filter((control) => control.name && !control.disabled
      && (!['checkbox', 'radio'].includes(control.type) || control.checked))
      .map((control) => [control.name, control.value]);
  }
  get(name) { return this.values.find(([key]) => key === name)?.[1] ?? null; }
}

function mount(t, available = true) {
  const keys = ['document', 'FormData', 'requestAnimationFrame', 'Element',
    'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement'];
  const original = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const append = function (child) { child.parentElement = this; this.children.push(child); };
  const document = parseHtml('<div id="toast-region"></div>');
  document.documentElement = document;
  document.body = document;
  document.append = append;
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.getElementById('toast-region').append = append;
  document.createElement = (tag) => {
    const element = new Element(tag);
    element.append = append;
    element.remove = () => {
      if (element.parentElement) {
        element.parentElement.children = element.parentElement.children.filter((child) => child !== element);
        element.parentElement = null;
      }
    };
    element.showModal = () => { element.open = true; };
    element.close = () => { element.open = false; element.dispatch('close'); };
    return element;
  };
  globalThis.document = document;
  globalThis.FormData = FormValues;
  globalThis.requestAnimationFrame = (callback) => callback();
  for (const key of keys.filter((key) => key.includes('Element'))) globalThis[key] = Element;
  setWriteAvailability(available);
  return {
    open(options) {
      const dialog = openDialog({ title: 'Kaart opslaan', content: '<input name="quantity" value="2">', ...options });
      applyWriteAvailability(dialog);
      return dialog;
    },
    messages: () => document.getElementById('toast-region').textContent,
    async submit(dialog) { dialog.querySelector('form').dispatch('submit'); await flush(); }
  };
}

test('a pending dialog write runs once even after write access refresh; pending user close is blocked', async (t) => {
  const ui = mount(t);
  const pending = deferred();
  const submitted = [];
  const dialog = ui.open({ onSubmit: async (data) => {
    submitted.push(data.get('quantity'));
    return pending.promise;
  } });
  const form = dialog.querySelector('form');
  const button = form.querySelector('[type="submit"]');
  await ui.submit(dialog);
  assert.equal(button.disabled, true);
  assert.equal(form.getAttribute('aria-busy'), 'true');
  await ui.submit(dialog);
  setWriteAvailability(true); // api() does this before its caller finishes.
  assert.equal(button.disabled, false);
  dialog.querySelector('[name="quantity"]').value = '8';
  await ui.submit(dialog);
  assert.deepEqual(submitted, ['2']);

  for (const closeButton of dialog.querySelectorAll('.close-dialog')) closeButton.click();
  dialog.dispatch('click'); // Modal backdrop.
  let cancelPrevented = false;
  dialog.dispatch('cancel', { preventDefault() { cancelPrevented = true; } });
  assert.equal(cancelPrevented, true);
  assert.equal(dialog.open, true);

  pending.resolve(true);
  await flush();
  assert.equal(dialog.open, false);
  await ui.submit(dialog);
  assert.deepEqual(submitted, ['2']);
});

test('a multi-step dialog can submit again without losing its caller-owned close lock', async (t) => {
  const ui = mount(t);
  let calls = 0;
  const dialog = ui.open({ onSubmit: async () => { calls++; return false; } });
  dialog.dataset.preventClose = 'true';
  await ui.submit(dialog);
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, false);
  assert.equal(dialog.querySelector('form').getAttribute('aria-busy'), null);
  assert.equal(dialog.dataset.preventClose, 'true');
  dialog.querySelector('.close-dialog').click();
  assert.equal(dialog.open, true);
  await ui.submit(dialog);
  assert.equal(calls, 2);
  delete dialog.dataset.preventClose;
  dialog.querySelector('.close-dialog').click();
  assert.equal(dialog.open, false);
});

test('failed writes retain unavailable write access and can retry only after access returns', async (t) => {
  const ui = mount(t);
  const pending = deferred();
  let calls = 0;
  const dialog = ui.open({ onSubmit: async () => {
    calls++;
    if (calls === 1) return pending.promise;
    return true;
  } });
  await ui.submit(dialog);
  setWriteAvailability(false);
  pending.reject(new Error('Schrijf-API niet bereikbaar'));
  await flush();
  const button = dialog.querySelector('[type="submit"]');
  assert.equal(dialog.open, true);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Opslaan');
  assert.match(ui.messages(), /Schrijf-API niet bereikbaar/);
  await ui.submit(dialog);
  button.disabled = false; // A visual reset must not bypass the access flag.
  await ui.submit(dialog);
  assert.equal(calls, 1);
  setWriteAvailability(true);
  await ui.submit(dialog);
  assert.equal(calls, 2);
  assert.equal(dialog.open, false);
});

test('validation failure stays correctable and a read-only dialog works without write access', async (t) => {
  const ui = mount(t, false);
  let calls = 0;
  const dialog = ui.open({ writeAction: false, onSubmit: async (data) => {
    calls++;
    if (data.get('quantity') === '2') throw new Error('Kies een ander aantal');
    return true;
  } });
  await ui.submit(dialog);
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('[type="submit"]').disabled, false);
  assert.match(ui.messages(), /Kies een ander aantal/);
  dialog.querySelector('[name="quantity"]').value = '3';
  await ui.submit(dialog);
  assert.equal(calls, 2);
  assert.equal(dialog.open, false);
});
