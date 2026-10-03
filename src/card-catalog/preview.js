import { config } from '../config.js';
import { HttpError, assert } from '../lib/http-error.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;

async function previewJson(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new HttpError(502, 'Scryfall gaf te veel kaartgegevens terug.');
  }
  assert(response.body, 502, 'Scryfall gaf geen kaartgegevens terug.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      assert(total <= MAX_RESPONSE_BYTES, 502, 'Scryfall gaf te veel kaartgegevens terug.');
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    } catch {
      throw new HttpError(502, 'Scryfall gaf ongeldige kaartgegevens terug.');
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function imageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'cards.scryfall.io'
      && !url.username && !url.password && !url.port) return url.href;
  } catch { /* Invalid or missing image URLs cannot be displayed. */ }
  return '';
}

function faceImage(face) {
  return ['large', 'normal', 'png'].map((size) => imageUrl(face?.image_uris?.[size])).find(Boolean) || '';
}

export function catalogPreviewFromScryfall(card) {
  const name = String(card?.name || 'Kaartvoorbeeld');
  const front = faceImage(card);
  // Split/adventure cards have a single image; transforming cards have an image per face.
  const faces = front ? [{ name, image: front }] : (Array.isArray(card?.card_faces) ? card.card_faces : [])
    .map((face) => ({ name: String(face?.name || name), image: faceImage(face) }))
    .filter((face) => face.image)
    .slice(0, 2);
  assert(faces.length > 0, 404, 'Voor deze kaart is geen afbeelding beschikbaar.');
  return { name, faces };
}

// The discovery catalog must remain independent of the collection database. This
// resolver uses only HTTP and a bounded, temporary memory cache: never the shared
// Scryfall service, whose persistent cache writes to the collection database.
export function createCatalogPreviewService({
  fetchImpl = (...args) => fetch(...args),
  requestDelayMs = config.scryfallRequestDelayMs,
  timeoutMs = config.scryfallTimeoutMs,
  cacheTtlMs = 60 * 60 * 1000,
  maxCacheEntries = 128
} = {}) {
  const cache = new Map();
  const pending = new Map();
  let queue = Promise.resolve();
  let lastRequestAt = 0;

  return async (input = {}) => {
    assert(typeof input.name === 'string', 400, 'Geef een kaartnaam op voor de afbeelding.');
    const name = input.name.trim();
    assert(name.length > 0 && name.length <= 300, 400, 'De kaartnaam moet 1 tot 300 tekens bevatten.');
    const key = name.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    cache.delete(key);
    if (pending.has(key)) return pending.get(key);

    const operation = queue.then(async () => {
      const waitMs = Math.max(0, requestDelayMs - (Date.now() - lastRequestAt));
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      let response;
      let card;
      try {
        response = await fetchImpl(`https://api.scryfall.com/cards/named?${new URLSearchParams({ exact: name })}`, {
          headers: { Accept: 'application/json', 'User-Agent': config.scryfallUserAgent },
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          if (response.status === 404) throw new HttpError(404, 'Voor deze kaart is geen afbeelding beschikbaar.');
          if (response.status === 429) throw new HttpError(429, 'Scryfall is tijdelijk druk. Probeer de afbeelding straks opnieuw.');
          throw new HttpError(502, 'De kaartafbeelding kon niet worden opgehaald.');
        }
        card = await previewJson(response);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (['AbortError', 'TimeoutError'].includes(error?.name)) {
          throw new HttpError(504, 'Het ophalen van de kaartafbeelding duurt te lang. Probeer het opnieuw.');
        }
        throw new HttpError(503, 'De kaartafbeelding is momenteel niet bereikbaar. Probeer het opnieuw.');
      } finally {
        lastRequestAt = Date.now();
      }
      const value = catalogPreviewFromScryfall(card);
      cache.set(key, { value, expires: Date.now() + cacheTtlMs });
      while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
      return value;
    });
    pending.set(key, operation);
    queue = operation.catch(() => undefined);
    try {
      return await operation;
    } finally {
      pending.delete(key);
    }
  };
}

export const cardCatalogPreview = createCatalogPreviewService();
