import { db } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';
import { normalizeSearchText } from '../lib/text.js';
import { cardRowToApi } from './card-mapper.js';
import { addUsage, usageMapsForKeys } from './card-repository.js';
import { requireDeck } from './deck-service.js';

const COLOR_CODES = new Set(['W', 'U', 'B', 'R', 'G', 'C']);
const AVAILABILITY_VALUES = new Set(['all', 'free', 'used', 'shortage']);
const RARITY_VALUES = new Set(['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus']);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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

export function listAiDecks() {
  const decks = db.prepare(`
    SELECT
      d.id,
      d.name,
      d.format,
      commander.name AS commander,
      COALESCE(SUM(CASE
        WHEN dc.role IN ('commander', 'partner', 'main') THEN dc.quantity
        ELSE 0
      END), 0) AS card_count
    FROM decks d
    LEFT JOIN cards commander ON commander.id = d.commander_card_id
    LEFT JOIN deck_cards dc ON dc.deck_id = d.id
    GROUP BY d.id
    ORDER BY d.updated_at DESC, d.name COLLATE NOCASE
  `).all().map((row) => ({
    id: Number(row.id),
    name: row.name,
    format: row.format,
    commander: row.commander || null,
    cards: Number(row.card_count || 0)
  }));
  return { decks };
}

export function getAiDeckCards(deckId) {
  const deck = requireDeck(deckId);
  const cards = db.prepare(`
    SELECT c.id AS card_id, c.name, dc.quantity, dc.role
    FROM deck_cards dc
    JOIN cards c ON c.id = dc.card_id
    WHERE dc.deck_id = ?
    ORDER BY
      CASE dc.role
        WHEN 'commander' THEN 0
        WHEN 'partner' THEN 1
        WHEN 'companion' THEN 2
        WHEN 'main' THEN 3
        WHEN 'sideboard' THEN 4
        ELSE 5
      END,
      c.name COLLATE NOCASE
  `).all(deckId).map((row) => ({
    cardId: Number(row.card_id),
    name: row.name,
    qty: Number(row.quantity),
    role: row.role
  }));

  return {
    deck: {
      id: deck.id,
      name: deck.name,
      format: deck.format,
      cards: deck.totalCards
    },
    cards
  };
}

export function getAiCard(cardId) {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!row) throw new HttpError(404, 'Kaart niet gevonden.');
  const card = cardRowToApi(row);
  return {
    card: {
      id: card.id,
      name: card.name,
      manaCost: card.manaCost,
      manaValue: card.manaValue,
      type: card.typeLine,
      text: card.oracleText,
      keywords: card.keywords,
      power: card.power,
      toughness: card.toughness
    }
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
        representativeQuantity: quantity
      });
      continue;
    }
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
  const rawOffset = Number(filters.offset);
  const rawLimit = Number(filters.limit);
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 25;
  const page = cards.slice(offset, offset + limit).map((entry) => ({
    id: entry.card.id,
    name: entry.card.name,
    owned: entry.card.usage.owned,
    manaCost: entry.card.manaCost,
    manaValue: entry.card.manaValue,
    type: entry.card.typeLine
  }));
  const nextOffset = offset + page.length < total ? offset + page.length : null;

  return {
    cards: page,
    page: compactObject({ total, limit, offset, nextOffset })
  };
}
