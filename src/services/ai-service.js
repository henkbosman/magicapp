import { db } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';
import { normalizeSearchText } from '../lib/text.js';
import { cardRowToApi } from './card-mapper.js';
import {
  addUsage,
  getCardWithUsage,
  listCollection,
  usageMapsForKeys
} from './card-repository.js';
import { getDeckCards, listDecks, requireDeck } from './deck-service.js';

const COLOR_CODES = new Set(['W', 'U', 'B', 'R', 'G', 'C']);
const AVAILABILITY_VALUES = new Set(['all', 'free', 'used', 'shortage']);
const RARITY_VALUES = new Set(['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus']);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => (
    entry !== undefined
    && entry !== null
    && entry !== ''
  )));
}

function normalizeColors(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(',');
  return unique(source
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => COLOR_CODES.has(entry)));
}

function deckSummary(deck) {
  return {
    id: deck.id,
    name: deck.name,
    format: deck.format,
    commander: deck.commander?.name || null,
    cards: deck.totalCards,
    missing: deck.missingQuantity,
    updatedAt: deck.updatedAt
  };
}

export function listAiDecks() {
  return { decks: listDecks().map(deckSummary) };
}

export function getAiDeckCards(deckId) {
  const deck = requireDeck(deckId);
  const items = getDeckCards(deckId);
  return {
    deck: {
      id: deck.id,
      name: deck.name,
      format: deck.format,
      cards: deck.totalCards
    },
    cards: items.map((item) => ({
      entryId: item.id,
      cardId: item.card.id,
      name: item.card.name,
      qty: item.quantity,
      role: item.role,
      manaCost: item.card.manaCost,
      manaValue: item.card.manaValue,
      type: item.card.typeLine,
      colorIdentity: item.card.colorIdentity,
      tags: item.tags,
      owned: item.card.usage.owned,
      missing: item.coverage.missingFromCollection
    }))
  };
}

function wantedForCardKey(cardKey) {
  const rows = db.prepare(`
    SELECT w.id, w.quantity, w.priority, w.maximum_price, w.notes
    FROM wanted_items w
    JOIN cards c ON c.id = w.card_id
    WHERE COALESCE(c.oracle_id, c.scryfall_id) = ?
    ORDER BY w.priority, w.id
  `).all(cardKey);
  if (!rows.length) return null;
  return compactObject({
    quantity: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    priority: Math.min(...rows.map((row) => Number(row.priority || 3))),
    maximumPrice: rows.find((row) => row.maximum_price !== null)?.maximum_price ?? null,
    notes: rows.map((row) => String(row.notes || '').trim()).filter(Boolean).join('\n')
  });
}

export function getAiCard(cardId) {
  const card = getCardWithUsage(cardId);
  const collectionItems = listCollection({ cardKey: card.cardKey, limit: 1000 }).items;
  const manaInsight = card.insights?.manaProduction || {};
  const searchInsight = card.insights?.librarySearch || {};

  return {
    card: compactObject({
      id: card.id,
      scryfallId: card.scryfallId,
      oracleId: card.oracleId,
      name: card.name,
      manaCost: card.manaCost,
      manaValue: card.manaValue,
      type: card.typeLine,
      text: card.oracleText,
      colors: card.colors,
      colorIdentity: card.colorIdentity,
      keywords: card.keywords,
      power: card.power,
      toughness: card.toughness,
      loyalty: card.loyalty,
      defense: card.defense,
      producesMana: manaInsight.entries || [],
      manaNote: nonEmpty(manaInsight.note),
      searchesLibraryFor: searchInsight.targets || [],
      searchNote: nonEmpty(searchInsight.note),
      commanderLegality: card.legalities?.commander,
      printing: {
        set: card.setName,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber,
        rarity: card.rarity,
        language: card.language,
        finishes: card.finishes,
        pricesEur: compactObject({
          nonfoil: card.prices?.eur,
          foil: card.prices?.eur_foil,
          etched: card.prices?.eur_etched
        })
      },
      usage: {
        owned: card.usage.owned,
        used: card.usage.needed,
        free: card.usage.free,
        shortage: card.usage.shortage,
        wanted: card.usage.wanted,
        decks: card.usage.decks.map((deck) => ({ id: deck.id, name: deck.name, qty: deck.quantity }))
      },
      wanted: wantedForCardKey(card.cardKey),
      collection: collectionItems.map((item) => compactObject({
        cardId: item.card.id,
        setCode: item.card.setCode,
        collectorNumber: item.card.collectorNumber,
        rarity: item.card.rarity,
        qty: item.quantity,
        finish: item.finish,
        language: item.language,
        condition: item.condition,
        location: nonEmpty(item.location)
      }))
    })
  };
}

function addCollectionColorCondition(conditions, params, rawColors) {
  const colors = normalizeColors(rawColors);
  if (!colors.length) return;
  const selectedColors = colors.filter((color) => color !== 'C');
  const includeColorless = colors.includes('C');
  const clauses = [];

  if (includeColorless) clauses.push('json_array_length(c.color_identity_json) = 0');
  if (selectedColors.length) {
    const placeholders = selectedColors.map(() => '?').join(', ');
    clauses.push(`(
      json_array_length(c.color_identity_json) BETWEEN 1 AND ?
      AND NOT EXISTS (
        SELECT 1 FROM json_each(c.color_identity_json) AS identity_color
        WHERE UPPER(CAST(identity_color.value AS TEXT)) NOT IN (${placeholders})
      )
    )`);
    params.push(selectedColors.length, ...selectedColors);
  }
  if (clauses.length) conditions.push(`(${clauses.join(' OR ')})`);
}

function collectionRows(filters) {
  const conditions = ['ci.quantity > 0'];
  const params = [];
  const query = normalizeSearchText(filters.q || '');

  if (query) {
    conditions.push('c.search_name LIKE ?');
    params.push(`%${query}%`);
  }
  if (filters.type) {
    conditions.push(`EXISTS (
      SELECT 1 FROM json_each(c.card_types_json) AS card_type
      WHERE LOWER(CAST(card_type.value AS TEXT)) = LOWER(?)
    )`);
    params.push(String(filters.type));
  }
  if (filters.subtype) {
    conditions.push(`EXISTS (
      SELECT 1 FROM json_each(c.subtypes_json) AS subtype
      WHERE LOWER(CAST(subtype.value AS TEXT)) = LOWER(?)
    )`);
    params.push(String(filters.subtype));
  }
  if (filters.keyword) {
    conditions.push(`EXISTS (
      SELECT 1 FROM json_each(c.keywords_json) AS keyword
      WHERE LOWER(CAST(keyword.value AS TEXT)) = LOWER(?)
    )`);
    params.push(String(filters.keyword));
  }
  addCollectionColorCondition(conditions, params, filters.colors);

  if (filters.manaValue !== undefined && filters.manaValue !== null && filters.manaValue !== '') {
    if (String(filters.manaValue) === '7+') conditions.push('c.mana_value >= 7');
    else {
      const manaValue = Number(filters.manaValue);
      if (!Number.isFinite(manaValue) || manaValue < 0) throw new HttpError(400, 'manaValue moet een getal of 7+ zijn.');
      conditions.push('c.mana_value = ?');
      params.push(manaValue);
    }
  }
  if (filters.set) {
    conditions.push('LOWER(c.set_code) = LOWER(?)');
    params.push(String(filters.set));
  }
  if (filters.rarity) {
    const rarity = String(filters.rarity).toLowerCase();
    if (!RARITY_VALUES.has(rarity)) throw new HttpError(400, 'Ongeldige rarity.');
    conditions.push('c.rarity = ?');
    params.push(rarity);
  }
  if (filters.deckId) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM deck_cards dc
      JOIN cards deck_card ON deck_card.id = dc.card_id
      WHERE dc.deck_id = ?
        AND COALESCE(deck_card.oracle_id, deck_card.scryfall_id) = COALESCE(c.oracle_id, c.scryfall_id)
    )`);
    params.push(Number(filters.deckId));
  }

  return db.prepare(`
    SELECT c.*, ci.quantity AS collection_quantity
    FROM collection_items ci
    JOIN cards c ON c.id = ci.card_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.name COLLATE NOCASE, c.released_at DESC, c.id DESC
  `).all(...params);
}

function groupOwnedCards(rows) {
  const groups = new Map();
  for (const row of rows) {
    const card = cardRowToApi(row);
    const quantity = Number(row.collection_quantity || 0);
    const current = groups.get(card.cardKey);
    if (!current) {
      groups.set(card.cardKey, {
        card,
        representativeQuantity: quantity,
        printingIds: new Set([card.id])
      });
      continue;
    }
    current.printingIds.add(card.id);
    if (quantity > current.representativeQuantity) {
      current.card = card;
      current.representativeQuantity = quantity;
    }
  }
  return [...groups.values()];
}

export function listAiCollection(filters = {}) {
  const availability = String(filters.availability || 'all').toLowerCase();
  if (!AVAILABILITY_VALUES.has(availability)) {
    throw new HttpError(400, 'availability moet all, free, used of shortage zijn.');
  }

  const grouped = groupOwnedCards(collectionRows(filters));
  const maps = usageMapsForKeys(grouped.map((entry) => entry.card.cardKey));
  const cards = grouped
    .map((entry) => ({
      ...entry,
      card: addUsage(entry.card, maps)
    }))
    .filter((entry) => {
      if (availability === 'free') return entry.card.usage.free > 0;
      if (availability === 'used') return entry.card.usage.needed > 0;
      if (availability === 'shortage') return entry.card.usage.shortage > 0;
      return true;
    })
    .sort((left, right) => left.card.name.localeCompare(right.card.name, 'nl'));

  const total = cards.length;
  const offset = filters.offset;
  const limit = filters.limit;
  const page = cards.slice(offset, offset + limit).map((entry) => ({
    id: entry.card.id,
    name: entry.card.name,
    owned: entry.card.usage.owned,
    used: entry.card.usage.needed,
    free: entry.card.usage.free,
    shortage: entry.card.usage.shortage,
    wanted: entry.card.usage.wanted,
    manaCost: entry.card.manaCost,
    manaValue: entry.card.manaValue,
    type: entry.card.typeLine,
    colorIdentity: entry.card.colorIdentity,
    printings: entry.printingIds.size
  }));
  const nextOffset = offset + page.length < total ? offset + page.length : null;

  return {
    cards: page,
    page: compactObject({ total, limit, offset, nextOffset })
  };
}
