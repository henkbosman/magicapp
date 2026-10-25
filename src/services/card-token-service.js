import { db } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';
import { positiveInteger } from '../lib/validation.js';
import { safeJsonParse } from '../lib/text.js';
import { scryfallService } from './scryfall-service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLORS = new Set(['W', 'U', 'B', 'R', 'G']);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const stat = (value) => typeof value === 'string' || typeof value === 'number' ? String(value) : null;
const strings = (value) => [...new Set((Array.isArray(value) ? value : []).filter((item) => typeof item === 'string'))];
const colors = (value) => strings(value).filter((color) => COLORS.has(color));

function imageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'cards.scryfall.io'
      && !url.username && !url.password && !url.port) return url.href;
  } catch { /* Missing or untrusted images do not invalidate the token text. */ }
  return null;
}

function imageUris(value) {
  const source = object(value) ? value : {};
  const result = Object.fromEntries(['small', 'normal', 'large', 'png']
    .map((size) => [size, imageUrl(source[size])]));
  result.normal ||= result.large || result.png || result.small;
  result.large ||= result.normal;
  result.small ||= result.normal;
  return result;
}

function tokenFace(face) {
  return {
    name: text(face.name),
    mana_cost: text(face.mana_cost),
    type_line: text(face.type_line),
    oracle_text: text(face.oracle_text),
    colors: colors(face.colors),
    keywords: strings(face.keywords),
    power: stat(face.power),
    toughness: stat(face.toughness),
    image_uris: imageUris(face.image_uris)
  };
}

export function tokenFromScryfall(raw, expectedId) {
  const faces = object(raw) && Array.isArray(raw.card_faces) ? raw.card_faces.filter(object).slice(0, 2) : [];
  const isToken = ['token', 'double_faced_token', 'emblem'].includes(raw?.layout)
    || /^Token\b/i.test(text(raw?.type_line))
    || (faces.length > 0 && faces.every((face) => /^Token\b/i.test(text(face.type_line))));
  if (!object(raw) || raw.object !== 'card' || text(raw.id).toLowerCase() !== expectedId
    || !text(raw.name).trim() || !isToken) {
    throw new HttpError(502, 'De opgehaalde gegevens horen niet bij de verwachte token.');
  }
  const cardFaces = faces.map(tokenFace);
  const front = imageUris(raw.image_uris);
  const faceFront = cardFaces[0]?.image_uris || {};
  const back = cardFaces[1]?.image_uris || {};
  return {
    scryfallId: expectedId,
    name: raw.name,
    typeLine: text(raw.type_line) || cardFaces.map((face) => face.type_line).filter(Boolean).join(' // '),
    manaCost: text(raw.mana_cost),
    oracleText: text(raw.oracle_text) || cardFaces.map((face) => `${face.name}\n${face.oracle_text}`).join('\n\n'),
    colors: Array.isArray(raw.colors) ? colors(raw.colors) : colors(cardFaces.flatMap((face) => face.colors)),
    keywords: strings([...(Array.isArray(raw.keywords) ? raw.keywords : []), ...cardFaces.flatMap((face) => face.keywords)]),
    power: stat(raw.power),
    toughness: stat(raw.toughness),
    images: {
      small: front.small || faceFront.small || null,
      normal: front.normal || faceFront.normal || null,
      large: front.large || faceFront.large || null,
      png: front.png || faceFront.png || null,
      backSmall: back.small || null,
      backNormal: back.normal || null,
      backLarge: back.large || null,
      backPng: back.png || null
    },
    cardFaces,
    available: true
  };
}

function references(raw, sourceId) {
  if (raw.all_parts === undefined || raw.all_parts === null) return [];
  if (!Array.isArray(raw.all_parts)) {
    throw new HttpError(502, 'De opgeslagen tokenverwijzingen zijn ongeldig. Vernieuw de kaartgegevens.');
  }
  const seen = new Set();
  return raw.all_parts.flatMap((part) => {
    if (!object(part) || part.component !== 'token') return [];
    const id = text(part.id).trim().toLowerCase();
    if (id === sourceId.toLowerCase() || (id && seen.has(id))) return [];
    if (id) seen.add(id);
    return [{
      scryfallId: UUID.test(id) ? id : null,
      name: text(part.name).trim() || 'Token',
      typeLine: text(part.type_line).trim() || 'Token'
    }];
  });
}

function discardInvalidCachedToken(id, raw) {
  // getById shares the existing persistent card cache. Its loader saves before
  // this token-specific identity check, so discard only that exact bad payload
  // rather than making retries reuse it for the entire cache TTL.
  db.prepare('DELETE FROM external_api_cache WHERE cache_key = ? AND payload_json = ?')
    .run(`card:id:${id}`, JSON.stringify(raw) ?? 'null');
}

async function resolveToken(reference) {
  if (!reference.scryfallId) return { ...reference, available: false, error: 'Deze token heeft geen geldige Scryfall-verwijzing. Vernieuw de kaartgegevens.' };
  try {
    const row = db.prepare('SELECT raw_json FROM cards WHERE scryfall_id = ? COLLATE NOCASE').get(reference.scryfallId);
    if (row) {
      try {
        return tokenFromScryfall(safeJsonParse(row.raw_json, null), reference.scryfallId);
      } catch { /* Resolve incomplete legacy metadata without changing the local card. */ }
    }
    // The stored URI is intentionally ignored: only the validated UUID is used
    // with the existing fixed-origin Scryfall method and its shared request queue.
    const raw = await scryfallService.getById(reference.scryfallId);
    try {
      return tokenFromScryfall(raw, reference.scryfallId);
    } catch (error) {
      discardInvalidCachedToken(reference.scryfallId, raw);
      throw error;
    }
  } catch (error) {
    return {
      ...reference,
      available: false,
      error: error instanceof HttpError ? error.message : 'De tokengegevens konden niet worden geladen. Probeer het opnieuw.'
    };
  }
}

export async function getCardTokens(cardId) {
  const id = positiveInteger(cardId, 'Kaart-ID');
  const card = db.prepare('SELECT scryfall_id, raw_json FROM cards WHERE id = ?').get(id);
  if (!card) throw new HttpError(404, 'Kaart niet gevonden.');
  const raw = safeJsonParse(card.raw_json, null);
  if (!object(raw)) throw new HttpError(502, 'De opgeslagen kaartgegevens zijn ongeldig. Vernieuw de kaartgegevens.');
  const parts = references(raw, card.scryfall_id);
  if (parts.length && text(raw.id).toLowerCase() !== card.scryfall_id.toLowerCase()) {
    throw new HttpError(502, 'De opgeslagen tokenverwijzingen horen niet bij deze kaart. Vernieuw de kaartgegevens.');
  }
  return Promise.all(parts.map(resolveToken));
}
