import { HttpError } from '../lib/http-error.js';
import { normalizeSearchText } from '../lib/text.js';
import { findCardByCollector, findCardByName, getCardByScryfallId, upsertScryfallCard } from './card-repository.js';
import { scryfallService } from './scryfall-service.js';

export async function ensureCard(input) {
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
