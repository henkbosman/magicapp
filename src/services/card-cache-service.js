import { HttpError } from '../lib/http-error.js';
import { normalizeSearchText } from '../lib/text.js';
import { findCardByCollector, findCardByName, getCardByScryfallId, upsertScryfallCard } from './card-repository.js';
import { scryfallService } from './scryfall-service.js';

export async function ensureCard(input) {
  let expectedOracleId = '';
  if (input.expectedOracleId !== undefined && input.expectedOracleId !== null) {
    if (typeof input.expectedOracleId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.expectedOracleId.trim())) {
      throw new HttpError(400, 'expectedOracleId moet een geldig Scryfall Oracle-ID zijn.');
    }
    expectedOracleId = input.expectedOracleId.trim().toLowerCase();
  }
  const card = await resolveCard(input);
  if (expectedOracleId && String(card.oracleId || '').toLowerCase() !== expectedOracleId) {
    throw new HttpError(409, 'De gevonden printing hoort niet bij deze cataloguskaart. Kies een specifieke printing via Kaart opzoeken.');
  }
  return card;
}

async function resolveCard(input) {
  if (input.cardId) {
    const { getCardById } = await import('./card-repository.js');
    const local = getCardById(Number(input.cardId));
    if (local) return local;
  }
  if (input.scryfallId) {
    const local = getCardByScryfallId(input.scryfallId);
    if (local) return local;
    return upsertScryfallCard(await scryfallService.getById(input.scryfallId));
  }
  if (input.setCode && input.collectorNumber) {
    const local = findCardByCollector(input.setCode, input.collectorNumber, input.language || '');
    if (local) return local;
    const raw = await scryfallService.getByCollectorNumber(input.setCode, input.collectorNumber, input.language || '');
    return upsertScryfallCard(raw);
  }
  if (input.name) {
    const local = findCardByName(input.name, input.setCode || '');
    if (local) return local;
    return upsertScryfallCard(await scryfallService.getByName(input.name, input.setCode || ''));
  }
  throw new HttpError(400, 'Geef een cardId, Scryfall-ID, kaartnaam of set/collector number op.');
}

export async function ensureCardsByIdentifiers(identifiers) {
  const resolved = [];
  const missing = [];

  for (const identifier of identifiers) {
    let local = null;
    if (identifier.id) local = getCardByScryfallId(identifier.id);
    else if (identifier.set && identifier.collector_number) local = findCardByCollector(identifier.set, identifier.collector_number);
    else if (identifier.name) local = findCardByName(identifier.name, identifier.set || '');
    if (local) resolved.push({ identifier, card: local });
    else missing.push(identifier);
  }

  if (missing.length) {
    const response = await scryfallService.getCollection(missing);
    const remoteCards = response.cards.map(upsertScryfallCard);
    const byScryfallId = new Map(remoteCards.map((card) => [card.scryfallId, card]));
    const byCollector = new Map(remoteCards.map((card) => [`${card.setCode}|${card.collectorNumber}`, card]));
    const byName = new Map();
    for (const card of remoteCards) {
      const key = `${normalizeSearchText(card.name)}|${card.setCode}`;
      byName.set(key, card);
      if (!byName.has(`${normalizeSearchText(card.name)}|`)) byName.set(`${normalizeSearchText(card.name)}|`, card);
    }
    for (const identifier of missing) {
      const key = `${normalizeSearchText(identifier.name || '')}|${String(identifier.set || '').toLowerCase()}`;
      const card = identifier.id
        ? byScryfallId.get(identifier.id)
        : identifier.set && identifier.collector_number
          ? byCollector.get(`${String(identifier.set).toLowerCase()}|${identifier.collector_number}`)
          : (byName.get(key) || byName.get(`${normalizeSearchText(identifier.name || '')}|`));
      if (card) resolved.push({ identifier, card });
    }
    return { resolved, notFound: response.notFound };
  }

  return { resolved, notFound: [] };
}

export async function ensureCardsByCollectorLanguage(identifiers, language = 'en') {
  const normalizedLanguage = String(language || 'en').toLowerCase();
  const resolved = [];
  const missingBySet = new Map();

  for (const identifier of identifiers) {
    const setCode = String(identifier.set || identifier.setCode || '').toLowerCase();
    const collectorNumber = String(identifier.collector_number || identifier.collectorNumber || '');
    const normalizedIdentifier = { set: setCode, collector_number: collectorNumber };
    const local = findCardByCollector(setCode, collectorNumber, normalizedLanguage);
    if (local) {
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
    const byPrinting = new Map((response.cards || [])
      .filter((card) => String(card.lang || 'en').toLowerCase() === 'en')
      .map((card) => [
        `${String(card.set || '').toLowerCase()}|${String(card.collector_number || '').toLowerCase()}`,
        card
      ]));
    for (const identifier of missing) {
      const key = `${identifier.set}|${String(identifier.collector_number).toLowerCase()}`;
      const raw = byPrinting.get(key);
      if (raw) resolved.push({ identifier, card: upsertScryfallCard(raw) });
      else notFound.push(identifier);
    }
    return { resolved, notFound };
  }

  for (const [setCode, missing] of missingBySet) {
    const rawCards = await scryfallService.cardsBySetAndLanguage(setCode, normalizedLanguage);
    const byCollector = new Map(rawCards.map((card) => [String(card.collector_number).toLowerCase(), card]));
    for (const identifier of missing) {
      const raw = byCollector.get(String(identifier.collector_number).toLowerCase());
      if (raw) resolved.push({ identifier, card: upsertScryfallCard(raw) });
      else notFound.push(identifier);
    }
  }

  return { resolved, notFound };
}
