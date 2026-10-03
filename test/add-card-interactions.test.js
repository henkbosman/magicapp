import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderAddCard } from '../public/js/views/add-card.js';
import { consumePendingScroll, prepareDiscoveryLookupNavigation } from '../public/js/navigation-state.js';
import { Element, parseHtml } from './support/dom.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const printing = (name = 'Llanowar Elves', id = 'elves') => ({
  name, scryfallId: id, printingKey: `tst|${id}`, collectorNumber: '1',
  setCode: 'tst', setName: 'Test set', rarity: 'common'
});
const card = (name = 'Llanowar Elves', id = 'elves') => ({
  id: 1, name, scryfallId: id, typeLine: 'Creature — Elf Druid', manaCost: '{G}'
});

async function mount(t, query = '') {
  const keys = ['fetch', 'document', 'window', 'Element', 'HTMLButtonElement', 'HTMLInputElement',
    'HTMLSelectElement', 'HTMLTextAreaElement'];
  const original = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  globalThis.fetch = (url) => new Promise((resolve) => {
    const parsed = new URL(url, 'http://localhost');
    requests.push({
      path: parsed.pathname, params: parsed.searchParams,
      resolve: (data) => resolve(new Response(JSON.stringify({ data }), {
        headers: { 'content-type': 'application/json' }
      }))
    });
  });
  const storage = new Map();
  const routes = [];
  globalThis.window = {
    location: { hash: `#/add${query ? `?${query}` : ''}` }, scrollY: 0,
    history: { replaceState: (_state, _title, hash) => { routes.push(hash); window.location.hash = hash; } },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key) }
  };
  for (const key of keys.filter((key) => key.includes('Element'))) globalThis[key] = Element;
  const view = await renderAddCard({ query: new URLSearchParams(query) });
  const document = parseHtml(view.html);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.documentElement = document;
  document.body = document;
  globalThis.document = document;
  const mounted = view.mount();
  return {
    requests, routes, document, mounted, html: view.html,
    get: (id) => document.getElementById(id),
    async type(value) {
      const search = document.getElementById('add-card-search');
      search.value = value;
      search.dispatch('input');
    },
    async tick() { t.mock.timers.tick(220); await flush(); },
    async respond(request, data) { request.resolve(data); await flush(); }
  };
}

test('één actuele naamsuggestie toont automatisch printings en houdt de getypte invoer intact', async (t) => {
  const ui = await mount(t);
  await ui.type('Llanow');
  await ui.tick();
  assert.equal(ui.requests[0].params.get('q'), 'Llanow');
  await ui.respond(ui.requests[0], ['Llanowar Elves']);
  assert.equal(ui.requests[1].params.get('name'), 'Llanowar Elves');
  assert.equal(ui.get('add-card-search').value, 'Llanow');
  assert.equal(ui.get('add-suggestions').hidden, true);
  await ui.respond(ui.requests[1], [printing()]);
  assert.match(ui.get('printing-list').textContent, /Test set/);
  assert.equal(ui.requests[2].path, '/api/read/cards/preview/elves');
  await ui.respond(ui.requests[2], card());
  assert.match(ui.get('selected-card-panel').textContent, /Llanowar Elves/);
  assert.match(window.location.hash, /name=Llanowar\+Elves/);
  assert.match(window.location.hash, /printing=elves/);
});

test('meerdere of nul suggesties starten geen printingverzoek', async (t) => {
  const ui = await mount(t);
  await ui.type('Forest');
  await ui.tick();
  await ui.respond(ui.requests[0], ['Forest', 'Snow-Covered Forest']);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.get('add-suggestions').querySelectorAll('button').length, 2);
  assert.equal(ui.get('add-suggestions').hidden, false);
  await ui.type('No such card');
  await ui.tick();
  await ui.respond(ui.requests[1], []);
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.get('add-suggestions').hidden, true);
  assert.equal(ui.get('printing-list').innerHTML, '');
});

test('een oude enkele suggestie kan nieuwere invoer niet selecteren', async (t) => {
  const ui = await mount(t);
  await ui.type('Llanow');
  await ui.tick();
  const stale = ui.requests[0];
  await ui.type('Sol');
  await ui.respond(stale, ['Llanowar Elves']);
  assert.equal(ui.get('add-card-search').value, 'Sol');
  assert.equal(ui.requests.length, 1);
  await ui.tick();
  await ui.respond(ui.requests[1], ['Sol Ring', 'Sol Talisman']);
  assert.equal(ui.requests.length, 2);
  assert.doesNotMatch(ui.get('add-suggestions').textContent, /Llanowar/);
});

test('verder typen met dezelfde enige kandidaat hergebruikt het printingverzoek', async (t) => {
  const ui = await mount(t);
  await ui.type('Llanow');
  await ui.tick();
  await ui.respond(ui.requests[0], ['Llanowar Elves']);
  const load = ui.requests[1];
  ui.get('add-card-search').dispatch('keydown', { key: 'Enter' });
  assert.equal(ui.requests.length, 2, 'Enter mag dezelfde lopende keuze niet dubbel laden');
  await ui.type('Llanowa');
  await ui.tick();
  await ui.respond(ui.requests[2], ['Llanowar Elves']);
  assert.equal(ui.requests.filter((request) => request.path.endsWith('/printings')).length, 1);
  await ui.respond(load, [printing()]);
  assert.equal(ui.requests.filter((request) => request.path.includes('/preview/')).length, 1);
  assert.equal(ui.get('add-card-search').value, 'Llanowa');
  await ui.respond(ui.requests[3], card());
  assert.match(ui.get('selected-card-panel').textContent, /Llanowar Elves/);
});

test('oude printings en previews kunnen een nieuw getypte zoekterm niet overschrijven', async (t) => {
  const ui = await mount(t);
  await ui.type('Llanow');
  await ui.tick();
  await ui.respond(ui.requests[0], ['Llanowar Elves']);
  await ui.type('Sol');
  await ui.respond(ui.requests[1], [printing()]);
  assert.equal(ui.requests.length, 2, 'verouderde printings mogen geen preview laden');
  assert.equal(ui.get('printing-list').innerHTML, '');
  await ui.tick();
  await ui.respond(ui.requests[2], ['Sol Ring']);
  await ui.respond(ui.requests[3], [printing('Sol Ring', 'sol')]);
  const preview = ui.requests[4];
  await ui.type('Forest');
  await ui.respond(preview, card('Sol Ring', 'sol'));
  assert.equal(ui.get('add-card-search').value, 'Forest');
  assert.doesNotMatch(ui.get('selected-card-panel').textContent, /Sol Ring/);
  assert.equal(window.location.hash, '#/add');
});

test('de Terug-knop behoudt filters en scroll na wijzigingen aan naam, printing en kaartnummer', async (t) => {
  const ui = await mount(t);
  const source = '#/discover?type=Instant&text=draw&colorIdentity=G&page=2&sort=name';
  window.location.hash = source;
  window.scrollY = 1842;
  const href = prepareDiscoveryLookupNavigation('#/add?name=Llanowar+Elves');
  window.location.hash = href;
  const view = await renderAddCard({ query: new URLSearchParams(href.split('?')[1]) });
  ui.document.innerHTML = view.html;
  const mounted = view.mount();
  await ui.respond(ui.requests[0], [printing()]);
  await ui.respond(ui.requests[1], card());
  await mounted;
  const returnToken = new URLSearchParams(href.split('?')[1]).get('discoveryReturn');
  assert.ok(returnToken);
  assert.equal(ui.get('return-to-discovery').textContent, 'Terug');
  ui.get('add-card-collector-number').value = '1';
  ui.get('add-card-collector-number').dispatch('change');
  assert.equal(new URLSearchParams(window.location.hash.split('?')[1]).get('discoveryReturn'), returnToken);
  await ui.type('Another card');
  assert.equal(new URLSearchParams(window.location.hash.split('?')[1]).get('discoveryReturn'), returnToken);
  ui.get('return-to-discovery').click();
  assert.equal(window.location.hash, source);
  assert.equal(consumePendingScroll(source), 1842);
  assert.equal(consumePendingScroll(source), null);
  await ui.tick();
  assert.equal(ui.requests.length, 2, 'de vertrokken pagina mag geen suggesties meer opvragen');
});

test('een initiële printingload kan na Terug de ontdekkingspagina niet overschrijven', async (t) => {
  const ui = await mount(t, 'name=Llanowar+Elves&discoveryReturn=missing');
  ui.get('return-to-discovery').click();
  assert.equal(window.location.hash, '#/discover');
  await ui.respond(ui.requests[0], [printing()]);
  await ui.mounted;
  assert.equal(window.location.hash, '#/discover');
  assert.equal(ui.requests.length, 1);
});

test('rechtstreeks geopende kaartzoekpagina toont geen ontdekkings-Terug-knop', async (t) => {
  const ui = await mount(t);
  assert.equal(ui.get('return-to-discovery'), null);
});
