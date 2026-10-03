import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { catalogPreviewFromScryfall, createCatalogPreviewService } from '../src/card-catalog/preview.js';
import { discoveryPreviewErrorMessage, discoveryPreviewHtml, openDiscoveryCardPreview } from '../public/js/discovery-preview.js';

const image = 'https://cards.scryfall.io/large/front/a/b/example.jpg';
const backImage = 'https://cards.scryfall.io/large/back/a/b/example.jpg';
const card = { name: 'Forest', image_uris: { large: image } };
const json = (data, options = {}) => new Response(JSON.stringify(data), { ...options, headers: { 'content-type': 'application/json', ...options.headers } });

test('discovery preview distinguishes an unavailable server route from a missing card image', () => {
  const unavailable = discoveryPreviewErrorMessage({ status: 404, message: 'Endpoint niet gevonden.' });
  assert.match(unavailable, /herstart de Node\.js-\/systemd-service/);
  assert.equal(discoveryPreviewErrorMessage({ status: 404, message: 'Voor deze kaart is geen afbeelding beschikbaar.' }), 'Voor deze kaart is geen afbeelding beschikbaar.');
  assert.equal(discoveryPreviewErrorMessage({ status: 503, message: 'De server is niet bereikbaar.' }), 'De server is niet bereikbaar.');
});

test('discovery preview resolves a single image or both transform faces without treating split faces as separate images', () => {
  assert.deepEqual(catalogPreviewFromScryfall(card), { name: 'Forest', faces: [{ name: 'Forest', image }] });
  const transformed = catalogPreviewFromScryfall({
    name: 'Front // Back',
    card_faces: [{ name: 'Front', image_uris: { large: image } }, { name: 'Back', image_uris: { normal: backImage } }]
  });
  assert.deepEqual(transformed.faces, [{ name: 'Front', image }, { name: 'Back', image: backImage }]);
  assert.equal(catalogPreviewFromScryfall({ ...card, card_faces: [{ image_uris: { large: backImage } }] }).faces.length, 1);
  const html = discoveryPreviewHtml(transformed);
  assert.equal((html.match(/<img /g) || []).length, 2);
  assert.match(html, /has-back/);
});

test('discovery preview rejects untrusted image locations and escapes card names', () => {
  for (const url of ['http://cards.scryfall.io/image.jpg', 'https://evil.test/image.jpg', 'https://cards.scryfall.io.evil.test/image.jpg', 'https://user:pass@cards.scryfall.io/image.jpg', 'https://cards.scryfall.io:8443/image.jpg', 'javascript:alert(1)']) {
    assert.throws(() => catalogPreviewFromScryfall({ name: 'Unsafe', image_uris: { large: url } }), { status: 404 });
    assert.doesNotMatch(discoveryPreviewHtml({ name: 'Unsafe', faces: [{ name: 'Unsafe', image: url }] }), /<img/);
  }
  const html = discoveryPreviewHtml({ faces: [{ name: '<script>"bad"</script>', image }] });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('discovery preview validates names, uses only the fixed exact endpoint, deduplicates and caches requests', async () => {
  let calls = 0;
  const resolve = createCatalogPreviewService({ requestDelayMs: 0, fetchImpl: async (url, options) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.scryfall.com');
    assert.equal(parsed.pathname, '/cards/named');
    assert.equal(parsed.searchParams.get('exact'), 'Forest & q=evil');
    assert.equal(parsed.searchParams.has('q'), false);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return json(card);
  } });
  for (const name of [undefined, '', ' ', [], {}, 'x'.repeat(301)]) {
    await assert.rejects(resolve({ name }), { status: 400 });
  }
  const result = await Promise.all([resolve({ name: 'Forest & q=evil' }), resolve({ name: 'Forest & q=evil' })]);
  assert.deepEqual(result[0], result[1]);
  await resolve({ name: '  forest & q=evil ' });
  assert.equal(calls, 1);
});

test('discovery preview memory cache stays bounded and failed lookups remain retryable', async () => {
  let calls = 0;
  const resolve = createCatalogPreviewService({ requestDelayMs: 0, maxCacheEntries: 1, fetchImpl: async () => { calls++; return json(card); } });
  await resolve({ name: 'Forest' });
  await resolve({ name: 'Island' });
  await resolve({ name: 'Forest' });
  assert.equal(calls, 3);

  let fail = true;
  const retry = createCatalogPreviewService({ requestDelayMs: 0, fetchImpl: async () => fail ? json({}, { status: 404 }) : json(card) });
  await assert.rejects(retry({ name: 'Forest' }), { status: 404 });
  fail = false;
  assert.equal((await retry({ name: 'Forest' })).faces[0].image, image);
});

test('discovery preview bounds remote response bodies and reports unavailable/error responses', async () => {
  for (const [response, status] of [
    [json({}, { status: 404 }), 404], [json({}, { status: 429 }), 429], [json({}, { status: 500 }), 502],
    [new Response('invalid-json'), 502], [json({ name: 'No art' }), 404],
    [new Response('x'.repeat(1024 * 1024 + 1)), 502],
    [json(card, { headers: { 'content-length': String(1024 * 1024 + 1) } }), 502]
  ]) {
    const resolve = createCatalogPreviewService({ requestDelayMs: 0, fetchImpl: async () => response });
    await assert.rejects(resolve({ name: 'Forest' }), { status });
  }
  for (const [error, status] of [[new Error('unreachable'), 503], [new DOMException('timeout', 'TimeoutError'), 504]]) {
    const resolve = createCatalogPreviewService({ requestDelayMs: 0, fetchImpl: async () => { throw error; } });
    await assert.rejects(resolve({ name: 'Forest' }), { status });
  }
});

test('discovery preview imports and resolves independently without creating a collection or catalog database', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'discovery-preview-'));
  try {
    const moduleUrl = new URL('../src/card-catalog/preview.js', import.meta.url).href;
    const code = `import { createCatalogPreviewService } from ${JSON.stringify(moduleUrl)};
      const resolve = createCatalogPreviewService({requestDelayMs:0, fetchImpl:async()=>new Response(${JSON.stringify(JSON.stringify(card))})});
      await resolve({name:'Forest'});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, DATA_DIR: directory }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function mockPreviewDialog() {
  const events = new Map();
  const body = { innerHTML: '', querySelectorAll: () => [] };
  const dialog = {
    open: false, dataset: {}, classList: { toggle() {} },
    setAttribute() {}, remove() {},
    querySelector: (selector) => selector === '.modal-body' ? body : { focus() {}, addEventListener() {} },
    querySelectorAll: () => [],
    addEventListener: (name, listener) => { const list = events.get(name) || []; list.push(listener); events.set(name, list); },
    showModal() { this.open = true; },
    close() { this.open = false; for (const listener of events.get('close') || []) listener(); }
  };
  const windowEvents = new Map();
  return { dialog, body, windowEvents, document: { createElement: () => dialog, body: { append() {} } }, window: {
    addEventListener: (name, listener) => windowEvents.set(name, listener),
    removeEventListener: (name) => windowEvents.delete(name)
  } };
}

test('discovery image popup loads safe images and aborts/ignores stale responses when closed or navigated', async () => {
  const original = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  try {
    const dom = mockPreviewDialog();
    globalThis.document = dom.document;
    globalThis.window = dom.window;
    let finish;
    let signal;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/read/card-catalog/preview?name=Forest');
      signal = options.signal;
      return new Promise((resolve) => { finish = resolve; });
    };
    const popup = openDiscoveryCardPreview({ name: 'Forest', catalogId: 'not-a-primary-id' });
    dom.windowEvents.get('hashchange')();
    assert.equal(popup.open, false);
    assert.equal(signal.aborted, true);
    assert.equal(dom.windowEvents.size, 0);
    finish(json({ data: { name: 'Forest', faces: [{ name: 'Forest', image }] } }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(dom.body.innerHTML, '');

    const fresh = mockPreviewDialog();
    globalThis.document = fresh.document;
    globalThis.window = fresh.window;
    globalThis.fetch = async () => json({ data: { name: 'Forest', faces: [{ name: 'Forest', image }] } });
    openDiscoveryCardPreview({ name: 'Forest' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(fresh.body.innerHTML, /<img/);
    assert.match(fresh.body.innerHTML, /cards\.scryfall\.io/);
    fresh.dialog.close();

    const failed = mockPreviewDialog();
    globalThis.document = failed.document;
    globalThis.window = failed.window;
    globalThis.fetch = async () => json({ error: { message: '<b>Afbeelding niet beschikbaar</b>' } }, { status: 404 });
    openDiscoveryCardPreview({ name: 'Forest' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(failed.body.innerHTML, /&lt;b&gt;Afbeelding niet beschikbaar&lt;\/b&gt;/);
    assert.doesNotMatch(failed.body.innerHTML, /<img|<b>/);
    failed.dialog.close();

    const outdated = mockPreviewDialog();
    globalThis.document = outdated.document;
    globalThis.window = outdated.window;
    globalThis.fetch = async () => json({ error: { message: 'Endpoint niet gevonden.' } }, { status: 404 });
    openDiscoveryCardPreview({ name: 'Forest' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(outdated.body.innerHTML, /herstart de Node\.js-\/systemd-service/);
    assert.doesNotMatch(outdated.body.innerHTML, /Endpoint niet gevonden/);
    outdated.dialog.close();
  } finally {
    Object.assign(globalThis, original);
  }
});
