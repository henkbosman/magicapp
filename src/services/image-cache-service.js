import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { assert } from '../lib/http-error.js';

const inFlight = new Map();
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function parsedScryfallImageUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    assert(false, 400, 'De URL van de kaartafbeelding is ongeldig.');
  }
  const hostname = url.hostname.toLowerCase();
  assert(url.protocol === 'https:', 400, 'Kaartafbeeldingen moeten via HTTPS worden opgehaald.');
  assert(hostname === 'cards.scryfall.io' || hostname.endsWith('.scryfall.io'), 400, 'Alleen kaartafbeeldingen van Scryfall zijn toegestaan.');
  return url;
}

function extensionFor(url, contentType = '') {
  const pathname = url.pathname.toLowerCase();
  if (contentType === 'image/png' || pathname.endsWith('.png')) return 'png';
  if (contentType === 'image/webp' || pathname.endsWith('.webp')) return 'webp';
  return 'jpg';
}

function safeCacheName(url, preferredName = '') {
  const hash = crypto.createHash('sha256').update(url.href).digest('hex');
  if (preferredName) {
    const cleaned = String(preferredName).replace(/[^a-zA-Z0-9._-]/g, '-');
    assert(cleaned && !cleaned.startsWith('.'), 400, 'Ongeldige naam voor de afbeeldingscache.');
    const originalExtension = path.extname(cleaned);
    const extension = originalExtension || `.${extensionFor(url)}`;
    const stem = originalExtension ? cleaned.slice(0, -originalExtension.length) : cleaned;
    // Bind a human-readable card key to the exact Scryfall URL. If metadata or
    // an image URL is corrected, the application cannot accidentally reuse an
    // older file that belonged to a different response.
    return `${stem}-${hash.slice(0, 16)}${extension}`;
  }
  return `${hash}.${extensionFor(url)}`;
}

function imageHeaders(res) {
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  res.setHeader('X-Image-Cache', 'local');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

async function downloadImage(url, destination) {
  const key = destination;
  if (inFlight.has(key)) return inFlight.get(key);

  const operation = (async () => {
    const response = await fetch(url, {
      headers: {
        'User-Agent': config.scryfallUserAgent,
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8'
      },
      signal: AbortSignal.timeout(config.scryfallTimeoutMs)
    });
    assert(response.ok, 502, 'Kaartafbeelding kon niet worden opgehaald.');
    const contentType = String(response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
    assert(ALLOWED_IMAGE_TYPES.has(contentType), 502, 'Scryfall gaf geen geldige kaartafbeelding terug.');

    const buffer = Buffer.from(await response.arrayBuffer());
    assert(buffer.length > 0, 502, 'De opgehaalde kaartafbeelding is leeg.');
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, buffer);
    fs.renameSync(temporary, destination);
    return { buffer, contentType };
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, operation);
  return operation;
}

export async function serveScryfallImage(res, value, { preferredName = '' } = {}) {
  const url = parsedScryfallImageUrl(value);
  const filename = safeCacheName(url, preferredName);
  fs.mkdirSync(config.imageCacheDir, { recursive: true });
  const cachedPath = path.join(config.imageCacheDir, filename);

  imageHeaders(res);
  if (fs.existsSync(cachedPath)) return res.sendFile(cachedPath);
  if (!config.cacheImages) {
    res.setHeader('X-Image-Cache', 'disabled');
    return res.redirect(302, url.href);
  }

  const { buffer, contentType } = await downloadImage(url, cachedPath);
  return res.type(contentType).send(buffer);
}
