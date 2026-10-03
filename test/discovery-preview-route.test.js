import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('discovery preview HTTP route resolves the client URL and distinguishes missing images from missing endpoints without writing databases', async (t) => {
  let express;
  try {
    ({ default: express } = await import('express'));
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    t.skip('Installeer de Express-afhankelijkheid om de HTTP-integratietest uit te voeren.');
    return;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-preview-route-'));
  const primaryPath = path.join(directory, 'primary.sqlite');
  const primarySentinel = Buffer.from('The discovery image route must never open or change the collection database.');
  fs.writeFileSync(primaryPath, primarySentinel);
  const savedEnvironment = Object.fromEntries(['DATA_DIR', 'DATABASE_FILE', 'CARD_CATALOG_DATABASE_FILE', 'SCRYFALL_REQUEST_DELAY_MS']
    .map((key) => [key, process.env[key]]));
  process.env.DATA_DIR = directory;
  process.env.DATABASE_FILE = 'primary.sqlite';
  process.env.CARD_CATALOG_DATABASE_FILE = 'catalog.sqlite';
  process.env.SCRYFALL_REQUEST_DELAY_MS = '0';
  const request = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = request;
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const { cardCatalogReadRouter } = await import('../src/routes/card-catalog.js');
  const { closeCardCatalogDatabase } = await import('../src/card-catalog/database.js');
  const { HttpError } = await import('../src/lib/http-error.js');
  const { apiPath } = await import('../public/js/api.js');
  t.after(closeCardCatalogDatabase);

  const image = 'https://cards.scryfall.io/large/front/a/b/route-test.jpg';
  const upstreamNames = [];
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.scryfall.com');
    assert.equal(parsed.pathname, '/cards/named');
    assert.equal(options.redirect, 'error');
    const name = parsed.searchParams.get('exact');
    upstreamNames.push(name);
    return new Response(JSON.stringify(name === 'Preview Route Forest'
      ? { name, image_uris: { large: image } }
      : { object: 'error', details: 'No cards found matching the given name.' }), {
      status: name === 'Preview Route Forest' ? 200 : 404,
      headers: { 'content-type': 'application/json' }
    });
  };

  // Keep the same two route mounts as server.js and use the real client path helper.
  const app = express();
  const readApi = express.Router();
  readApi.use('/card-catalog', cardCatalogReadRouter);
  app.use('/api/read', readApi);
  app.use((_req, res) => res.status(404).json({ error: { message: 'Endpoint niet gevonden.' } }));
  app.use((error, _req, res, _next) => {
    const status = error instanceof HttpError ? error.status : 500;
    res.status(status).json({ error: { message: status === 500 ? 'Er is een onverwachte fout opgetreden.' : error.message } });
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const previewPath = (name) => apiPath(`/card-catalog/preview?${new URLSearchParams({ name })}`);

  const found = await request(`${origin}${previewPath('Preview Route Forest')}`);
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), { data: { name: 'Preview Route Forest', faces: [{ name: 'Preview Route Forest', image }] } });

  const missingImage = await request(`${origin}${previewPath('Preview Route Missing')}`);
  assert.equal(missingImage.status, 404);
  assert.deepEqual(await missingImage.json(), { error: { message: 'Voor deze kaart is geen afbeelding beschikbaar.' } });

  const invalid = await request(`${origin}${apiPath('/card-catalog/preview')}`);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: { message: 'Geef een kaartnaam op voor de afbeelding.' } });

  const missingEndpoint = await request(`${origin}${apiPath('/card-catalog/no-such-preview-route')}`);
  assert.equal(missingEndpoint.status, 404);
  assert.deepEqual(await missingEndpoint.json(), { error: { message: 'Endpoint niet gevonden.' } });
  assert.deepEqual(upstreamNames, ['Preview Route Forest', 'Preview Route Missing']);
  assert.deepEqual(fs.readFileSync(primaryPath), primarySentinel);
  assert.deepEqual(fs.readdirSync(directory), ['primary.sqlite']);
});
