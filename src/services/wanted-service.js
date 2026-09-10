import { db } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';
import { isBasicLand } from '../lib/card-rules.js';
import { normalizeSearchText } from '../lib/text.js';
import {
  addUsage,
  getCardById,
  getCardWithUsage,
  requireCardById,
  usageMapsForKeys
} from './card-repository.js';
import { cardRowToApi } from './card-mapper.js';
import { printingCatalogSummaryMap } from './printing-catalog-service.js';

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];

function wantedRowToApi(row, card, maps, catalogMap) {
  const printing = row.wanted_printing_card_id
    ? getCardById(Number(row.wanted_printing_card_id))
    : null;
  return {
    id: Number(row.wanted_item_id),
    quantity: Number(row.wanted_quantity),
    priority: Number(row.wanted_priority),
    maximumPrice: row.wanted_maximum_price === null ? null : Number(row.wanted_maximum_price),
    notes: row.wanted_notes,
    createdAt: row.wanted_created_at,
    updatedAt: row.wanted_updated_at,
    printingSelected: Boolean(printing),
    printing,
    printingCatalog: catalogMap.get(card.cardKey) || {
      printingCount: 0,
      sets: [],
      rarities: card.rarity ? [card.rarity] : [],
      rarityPrintings: card.rarity ? {
        [card.rarity]: [{
          printingKey: `${card.setCode}:${card.collectorNumber}`,
          setCode: card.setCode,
          setName: card.setName,
          collectorNumber: card.collectorNumber
        }]
      } : {}
    },
    requestedForDecks: db.prepare(`
      SELECT d.id, d.name FROM wanted_item_decks link
      JOIN decks d ON d.id = link.deck_id
      WHERE link.wanted_item_id = ?
      ORDER BY d.name COLLATE NOCASE
    `).all(row.wanted_item_id).map((deck) => ({ id: Number(deck.id), name: deck.name })),
    card: addUsage(card, maps)
  };
}

function selectWantedRows(where = '', order = 'w.priority ASC, c.name COLLATE NOCASE', params = []) {
  return db.prepare(`
    SELECT c.*,
      w.id AS wanted_item_id,
      w.quantity AS wanted_quantity,
      w.priority AS wanted_priority,
      w.maximum_price AS wanted_maximum_price,
      w.notes AS wanted_notes,
      w.printing_card_id AS wanted_printing_card_id,
      w.created_at AS wanted_created_at,
      w.updated_at AS wanted_updated_at
    FROM wanted_items w
    JOIN cards c ON c.id = w.card_id
    LEFT JOIN cards pc ON pc.id = w.printing_card_id
    ${where}
    ORDER BY ${order}
  `).all(...params);
}

export function listWanted(filters = {}) {
  const conditions = [
    `NOT (c.card_types_json LIKE '%"Land"%' AND c.supertypes_json LIKE '%"Basic"%')`
  ];
  const params = [];
  const query = normalizeSearchText(filters.q || '');
  if (query) {
    conditions.push('c.search_name LIKE ?');
    params.push(`%${query}%`);
  }
  if (filters.priority) {
    conditions.push('w.priority = ?');
    params.push(Number(filters.priority));
  }
  if (filters.color) {
    const color = String(filters.color).toUpperCase();
    if (color === 'C') conditions.push("c.color_identity_json = '[]'");
    else if (color === 'M') conditions.push('json_array_length(c.color_identity_json) > 1');
    else {
      conditions.push('c.color_identity_json LIKE ?');
      params.push(`%"${color}"%`);
    }
  }
  if (filters.deckId) {
    const deckId = Number(filters.deckId);
    if (Number.isInteger(deckId) && deckId > 0) {
      conditions.push(`EXISTS (
        SELECT 1
        FROM deck_cards selected_deck_card
        JOIN cards selected_card ON selected_card.id = selected_deck_card.card_id
        WHERE selected_deck_card.deck_id = ?
          AND selected_deck_card.role <> 'maybeboard'
          AND COALESCE(selected_card.oracle_id, selected_card.scryfall_id) = COALESCE(c.oracle_id, c.scryfall_id)
      )`);
      params.push(deckId);
    }
  }
  if (filters.printing) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM card_printing_catalog catalog
      WHERE catalog.card_key = COALESCE(c.oracle_id, c.scryfall_id)
        AND catalog.set_code = ?
    )`);
    params.push(String(filters.printing).toLowerCase());
  }
  if (filters.rarity) {
    conditions.push(`(
      EXISTS (
        SELECT 1
        FROM card_printing_catalog rarity_catalog
        WHERE rarity_catalog.card_key = COALESCE(c.oracle_id, c.scryfall_id)
          AND rarity_catalog.rarity = ?
      ) OR (
        NOT EXISTS (
          SELECT 1 FROM card_printing_catalog any_catalog
          WHERE any_catalog.card_key = COALESCE(c.oracle_id, c.scryfall_id)
        ) AND c.rarity = ?
      )
    )`);
    const rarity = String(filters.rarity).toLowerCase();
    params.push(rarity, rarity);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortMap = {
    name: 'c.name COLLATE NOCASE ASC',
    priority: 'w.priority ASC, c.name COLLATE NOCASE',
    price: 'w.maximum_price IS NULL, w.maximum_price ASC, c.name COLLATE NOCASE',
    quantity: 'w.quantity DESC, c.name COLLATE NOCASE',
    printing: `COALESCE((
      SELECT MIN(catalog.set_name)
      FROM card_printing_catalog catalog
      WHERE catalog.card_key = COALESCE(c.oracle_id, c.scryfall_id)
    ), c.set_name) COLLATE NOCASE, c.name COLLATE NOCASE`,
    newest: 'w.created_at DESC'
  };
  const rows = selectWantedRows(where, sortMap[filters.sort] || sortMap.priority, params);
  const cards = rows.map(cardRowToApi);
  const maps = usageMapsForKeys(cards.map((card) => card.cardKey));
  const catalogMap = printingCatalogSummaryMap(cards.map((card) => card.cardKey));
  return rows.map((row, index) => wantedRowToApi(row, cards[index], maps, catalogMap));
}

export function getWantedItem(id) {
  const rows = selectWantedRows('WHERE w.id = ?', 'w.id', [id]);
  const row = rows[0];
  if (!row) return null;
  const card = cardRowToApi(row);
  return wantedRowToApi(
    row,
    card,
    usageMapsForKeys([card.cardKey]),
    printingCatalogSummaryMap([card.cardKey])
  );
}

function validatePrintingForCard(card, printingCardId) {
  if (printingCardId === null || printingCardId === undefined) return null;
  const printing = requireCardById(Number(printingCardId));
  if (printing.cardKey !== card.cardKey) {
    throw new HttpError(400, 'De gekozen printing hoort niet bij dezelfde kaart.');
  }
  return printing;
}

function linkWantedToDecks(wantedItemId, deckIds = []) {
  const ids = [...new Set((Array.isArray(deckIds) ? deckIds : [deckIds])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];
  if (!ids.length) return;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO wanted_item_decks (wanted_item_id, deck_id)
    SELECT ?, id FROM decks WHERE id = ?
  `);
  for (const deckId of ids) insert.run(wantedItemId, deckId);
}

export function upsertWanted(input, { matchOracle = true } = {}) {
  const card = requireCardById(input.cardId);
  if (isBasicLand(card)) {
    throw new HttpError(400, 'Basic lands worden als standaard beschikbaar beschouwd en niet aan Wanted toegevoegd.');
  }

  const printing = validatePrintingForCard(card, input.printingCardId);
  let existing;
  if (matchOracle) {
    existing = db.prepare(`
      SELECT w.id FROM wanted_items w JOIN cards c ON c.id = w.card_id
      WHERE COALESCE(c.oracle_id, c.scryfall_id) = ?
      ORDER BY CASE WHEN c.id = ? THEN 0 ELSE 1 END, w.id LIMIT 1
    `).get(card.cardKey, card.id);
  } else {
    existing = db.prepare('SELECT id FROM wanted_items WHERE card_id = ?').get(card.id);
  }

  let id;
  if (existing) {
    db.prepare(`
      UPDATE wanted_items SET quantity = quantity + ?, priority = MIN(priority, ?),
        maximum_price = COALESCE(?, maximum_price),
        notes = CASE WHEN ? <> '' THEN ? ELSE notes END
      WHERE id = ?
    `).run(input.quantity, input.priority, input.maximumPrice, input.notes, input.notes, existing.id);
    if (printing) {
      db.prepare('UPDATE wanted_items SET printing_card_id = ? WHERE id = ?').run(printing.id, existing.id);
    }
    id = Number(existing.id);
  } else {
    const result = db.prepare(`
      INSERT INTO wanted_items (card_id, printing_card_id, quantity, priority, maximum_price, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(card.id, printing?.id || null, input.quantity, input.priority, input.maximumPrice, input.notes);
    id = Number(result.lastInsertRowid);
  }
  linkWantedToDecks(id, input.deckIds || input.deckId || []);
  return getWantedItem(id);
}

export function updateWanted(id, input) {
  if (!getWantedItem(id)) throw new HttpError(404, 'Wanted-item niet gevonden.');
  db.prepare(`
    UPDATE wanted_items SET quantity = ?, priority = ?, maximum_price = ?, notes = ? WHERE id = ?
  `).run(input.quantity, input.priority, input.maximumPrice, input.notes, id);
  return getWantedItem(id);
}

export function setWantedPrinting(id, printingCardId) {
  const item = getWantedItem(id);
  if (!item) throw new HttpError(404, 'Wanted-item niet gevonden.');
  if (printingCardId === null || printingCardId === undefined) {
    db.prepare('UPDATE wanted_items SET printing_card_id = NULL WHERE id = ?').run(id);
    return getWantedItem(id);
  }
  const printing = validatePrintingForCard(item.card, printingCardId);
  db.prepare('UPDATE wanted_items SET printing_card_id = ? WHERE id = ?').run(printing.id, id);
  return getWantedItem(id);
}

export function deleteWanted(id) {
  const item = getWantedItem(id);
  if (!item) throw new HttpError(404, 'Wanted-item niet gevonden.');
  db.prepare('DELETE FROM wanted_items WHERE id = ?').run(id);
  return item;
}

export function wantedFilterOptions() {
  const printings = db.prepare(`
    SELECT catalog.set_code AS code, catalog.set_name AS name,
      COUNT(DISTINCT w.id) AS quantity,
      COUNT(DISTINCT catalog.printing_key) AS printing_count
    FROM wanted_items w
    JOIN cards c ON c.id = w.card_id
    JOIN card_printing_catalog catalog
      ON catalog.card_key = COALESCE(c.oracle_id, c.scryfall_id)
    WHERE NOT (c.card_types_json LIKE '%"Land"%' AND c.supertypes_json LIKE '%"Basic"%')
    GROUP BY catalog.set_code, catalog.set_name
    ORDER BY catalog.set_name COLLATE NOCASE, catalog.set_code
  `).all().map((row) => ({
    code: row.code,
    name: row.name,
    quantity: Number(row.quantity || 0),
    printingCount: Number(row.printing_count || 0)
  }));
  const rarities = db.prepare(`
    SELECT rarity, COUNT(DISTINCT wanted_id) AS quantity
    FROM (
      SELECT w.id AS wanted_id, catalog.rarity AS rarity
      FROM wanted_items w
      JOIN cards c ON c.id = w.card_id
      JOIN card_printing_catalog catalog
        ON catalog.card_key = COALESCE(c.oracle_id, c.scryfall_id)
      WHERE catalog.rarity <> ''
        AND NOT (c.card_types_json LIKE '%"Land"%' AND c.supertypes_json LIKE '%"Basic"%')
      UNION ALL
      SELECT w.id AS wanted_id, c.rarity AS rarity
      FROM wanted_items w
      JOIN cards c ON c.id = w.card_id
      WHERE c.rarity <> ''
        AND NOT EXISTS (
          SELECT 1 FROM card_printing_catalog catalog
          WHERE catalog.card_key = COALESCE(c.oracle_id, c.scryfall_id)
        )
        AND NOT (c.card_types_json LIKE '%"Land"%' AND c.supertypes_json LIKE '%"Basic"%')
    ) possible_rarities
    GROUP BY rarity
  `).all().map((row) => ({
    rarity: row.rarity,
    quantity: Number(row.quantity || 0)
  })).sort((a, b) => {
    const ai = RARITY_ORDER.indexOf(a.rarity);
    const bi = RARITY_ORDER.indexOf(b.rarity);
    return (ai === -1 ? RARITY_ORDER.length : ai) - (bi === -1 ? RARITY_ORDER.length : bi)
      || a.rarity.localeCompare(b.rarity);
  });
  const decks = db.prepare(`
    SELECT d.id, d.name, COUNT(DISTINCT w.id) AS quantity
    FROM decks d
    JOIN deck_cards dc ON dc.deck_id = d.id AND dc.role <> 'maybeboard'
    JOIN cards deck_card ON deck_card.id = dc.card_id
    JOIN cards wanted_card
      ON COALESCE(wanted_card.oracle_id, wanted_card.scryfall_id)
       = COALESCE(deck_card.oracle_id, deck_card.scryfall_id)
    JOIN wanted_items w ON w.card_id = wanted_card.id
    WHERE NOT (
      wanted_card.card_types_json LIKE '%"Land"%'
      AND wanted_card.supertypes_json LIKE '%"Basic"%'
    )
    GROUP BY d.id, d.name
    ORDER BY d.name COLLATE NOCASE
  `).all().map((row) => ({
    id: Number(row.id),
    name: row.name,
    quantity: Number(row.quantity || 0)
  }));
  return { printings, rarities, decks };
}

