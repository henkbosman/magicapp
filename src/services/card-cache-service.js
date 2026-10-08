import { db } from '../db/database.js';
import { cardMatchesRequestedName } from '../lib/card-identity.js';
import { HttpError } from '../lib/http-error.js';
import { safeJsonParse } from '../lib/text.js';
import { positiveInteger } from '../lib/validation.js';
import { mapScryfallCard } from './card-mapper.js';
import { findCardByCollector, findCardByName, getCardById, getCardByScryfallId, upsertScryfallCard } from './card-repository.js';
import { scryfallService } from './scryfall-service.js';

const rawCardStatement = db.prepare('SELECT raw_json FROM cards WHERE id = ?');
const normalized = (value) => String(value ?? '').trim().toLowerCase();

function identityMismatch(card, input, { raw = null, checkLanguage = false } = {}) {
  if (input.scryfallId && normalized(card.scryfallId) !== normalized(input.scryfallId)) return 'scryfallId';
  if (input.expectedOracleId && normalized(card.oracleId) !== normalized(input.expectedOracleId)) return 'expectedOracleId';
  if (input.setCode && normalized(card.setCode) !== normalized(input.setCode)) return 'setCode';
  if (input.collectorNumber && normalized(card.collectorNumber) !== normalized(input.collectorNumber)) return 'collectorNumber';
  if (checkLanguage && input.language && normalized(card.language) !== normalized(input.language)) return 'language';
  if (input.name) {
    const rawData = raw || safeJsonParse(rawCardStatement.get(card.id)?.raw_json, {});
    if (!cardMatchesRequestedName(card, input.name, rawData)) return 'name';
  }
  return '';
}

function assertCardIdentity(card, input, options) {
  const mismatch = identityMismatch(card, input, options);
  if (mismatch === 'scryfallId') {
    throw new HttpError(409, 'De opgegeven kaart-ID en Scryfall-ID horen niet bij dezelfde printing. Kies de printing opnieuw.');
  }
  if (mismatch === 'expectedOracleId') {
    throw new HttpError(409, 'De gevonden printing hoort niet bij deze cataloguskaart. Kies een specifieke printing via Kaart opzoeken.');
  }
  if (mismatch) {
    throw new HttpError(409, 'De gevonden printing komt niet overeen met de opgegeven kaartnaam, set, kaartnummer of taal. Kies de printing opnieuw.');
  }
  return card;
}

function validRawCard(raw) {
  return raw && typeof raw === 'object' && typeof raw.id === 'string' && raw.id.trim()
    && typeof raw.name === 'string' && raw.name.trim();
}

// Acquiring a card must never refresh another cached printing as a side effect.
// Check the request and an existing printing before the first database write.
// Shared internally with automatic Wanted printing selection; request-facing
// identifier validation remains in ensureCard.
export function cacheResolvedCard(raw, input, options = {}) {
  if (!validRawCard(raw)) throw new HttpError(502, 'Scryfall gaf onvolledige kaartgegevens terug.');
  const mapped = mapScryfallCard(raw);
  assertCardIdentity(mapped, input, { ...options, raw });
  const existing = getCardByScryfallId(mapped.scryfallId);
  if (existing) {
    assertCardIdentity(existing, input, options);
    assertCardIdentity(mapped, {
      scryfallId: existing.scryfallId,
      expectedOracleId: existing.oracleId,
      name: existing.name,
      setCode: existing.setCode,
      collectorNumber: existing.collectorNumber,
      language: existing.language
    }, { raw, checkLanguage: true });
    return existing;
  }
  return upsertScryfallCard(raw);
}

export async function ensureCard(input) {
  if (input.expectedOracleId !== undefined && input.expectedOracleId !== null) {
    if (typeof input.expectedOracleId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.expectedOracleId.trim())) {
      throw new HttpError(400, 'expectedOracleId moet een geldig Scryfall Oracle-ID zijn.');
    }
  }
  if (input.cardId !== undefined && input.cardId !== null) {
    const local = getCardById(positiveInteger(input.cardId, 'Kaart-ID'));
    if (!local) throw new HttpError(404, 'De gekozen kaartprinting bestaat niet meer. Kies de printing opnieuw.');
    return assertCardIdentity(local, input);
  }
  if (input.scryfallId) {
    const scryfallId = String(input.scryfallId).trim();
    const local = getCardByScryfallId(scryfallId);
    if (local) return assertCardIdentity(local, input);
    return cacheResolvedCard(await scryfallService.getById(scryfallId), input);
  }
  if (input.setCode && input.collectorNumber) {
    const setCode = String(input.setCode).trim().toLowerCase();
    const collectorNumber = String(input.collectorNumber).trim();
    const language = normalized(input.language);
    const options = { checkLanguage: true };
    const local = findCardByCollector(setCode, collectorNumber, language);
    if (local) return assertCardIdentity(local, input, options);
    return cacheResolvedCard(await scryfallService.getByCollectorNumber(setCode, collectorNumber, language), input, options);
  }
  if (input.name) {
    const local = findCardByName(input.name, input.setCode || '');
    if (local) return assertCardIdentity(local, input);
    return cacheResolvedCard(await scryfallService.getByName(input.name, input.setCode || ''), input);
  }
  throw new HttpError(400, 'Geef een cardId, Scryfall-ID, kaartnaam of set/collector number op.');
}

function identifierInput(identifier, language = '') {
  return {
    scryfallId: identifier.id || identifier.scryfallId,
    expectedOracleId: identifier.expectedOracleId,
    name: identifier.name,
    setCode: identifier.set || identifier.setCode,
    collectorNumber: identifier.collector_number || identifier.collectorNumber,
    language: language || identifier.language || identifier.lang
  };
}

function matchRemoteCards(identifiers, rawCards, { language = '' } = {}) {
  const candidates = (rawCards || []).filter(validRawCard).map((raw) => ({ raw, card: mapScryfallCard(raw) }));
  const resolved = [];
  const notFound = [];
  for (const identifier of identifiers) {
    const input = identifierInput(identifier, language);
    const options = { checkLanguage: Boolean(input.language) };
    const hasIdentifier = input.scryfallId || input.name || (input.setCode && input.collectorNumber);
    const candidate = hasIdentifier && candidates.find(({ raw, card }) => !identityMismatch(card, input, { ...options, raw }));
    if (!candidate) {
      notFound.push(identifier);
      continue;
    }
    try {
      resolved.push({ identifier, card: cacheResolvedCard(candidate.raw, input, options) });
    } catch (error) {
      // Batch imports already report unresolved rows separately. A conflicting
      // cached printing is unresolved too; it must not be overwritten.
      if (error?.status !== 409) throw error;
      notFound.push(identifier);
    }
  }
  return { resolved, notFound };
}

export async function ensureCardsByIdentifiers(identifiers) {
  const resolved = [];
  const missing = [];
  for (const identifier of identifiers) {
    const input = identifierInput(identifier);
    let local = null;
    if (input.scryfallId) local = getCardByScryfallId(input.scryfallId);
    else if (input.setCode && input.collectorNumber) local = findCardByCollector(input.setCode, input.collectorNumber, input.language || '');
    else if (input.name) local = findCardByName(input.name, input.setCode || '');
    if (local && !identityMismatch(local, input, { checkLanguage: Boolean(input.language) })) resolved.push({ identifier, card: local });
    else missing.push(identifier);
  }
  if (!missing.length) return { resolved, notFound: [] };
  const response = await scryfallService.getCollection(missing);
  const remote = matchRemoteCards(missing, response.cards);
  return { resolved: [...resolved, ...remote.resolved], notFound: remote.notFound };
}

export async function ensureCardsByCollectorLanguage(identifiers, language = 'en') {
  const normalizedLanguage = normalized(language || 'en');
  const resolved = [];
  const missingBySet = new Map();
  for (const identifier of identifiers) {
    const setCode = normalized(identifier.set || identifier.setCode);
    const collectorNumber = String(identifier.collector_number || identifier.collectorNumber || '').trim();
    const normalizedIdentifier = { ...identifier, set: setCode, collector_number: collectorNumber };
    const input = identifierInput(normalizedIdentifier, normalizedLanguage);
    const local = findCardByCollector(setCode, collectorNumber, normalizedLanguage);
    if (local && !identityMismatch(local, input, { checkLanguage: true })) {
      resolved.push({ identifier: normalizedIdentifier, card: local });
      continue;
    }
    if (!missingBySet.has(setCode)) missingBySet.set(setCode, []);
    missingBySet.get(setCode).push(normalizedIdentifier);
  }
  const notFound = [];
  if (normalizedLanguage === 'en' && missingBySet.size) {
    const missing = [...missingBySet.values()].flat();
    const response = await scryfallService.getCollection(missing);
    const remote = matchRemoteCards(missing, response.cards, { language: normalizedLanguage });
    return { resolved: [...resolved, ...remote.resolved], notFound: remote.notFound };
  }
  for (const [setCode, missing] of missingBySet) {
    const rawCards = await scryfallService.cardsBySetAndLanguage(setCode, normalizedLanguage);
    const remote = matchRemoteCards(missing, rawCards, { language: normalizedLanguage });
    resolved.push(...remote.resolved);
    notFound.push(...remote.notFound);
  }
  return { resolved, notFound };
}
