import { db, transaction } from '../db/database.js';
import { HttpError, assert } from '../lib/http-error.js';
import { isBasicLand } from '../lib/card-rules.js';
import { normalizeSearchText } from '../lib/text.js';
import { cardRowToApi, mapScryfallCard } from './card-mapper.js';
import { enrichCardWithInsights, enrichCardsWithInsights } from './card-insight-service.js';
import { alignDeckPrintingsAfterAcquisition } from './deck-printing-service.js';

const CARD_COLUMNS = [
  'scryfall_id', 'oracle_id', 'name', 'search_name', 'printed_name', 'mana_cost', 'mana_value',
  'colors_json', 'color_identity_json', 'produced_mana_json', 'type_line', 'card_types_json',
  'supertypes_json', 'subtypes_json', 'oracle_text', 'printed_text', 'power', 'toughness',
  'loyalty', 'defense', 'keywords_json', 'set_name', 'set_code', 'collector_number', 'rarity',
  'released_at', 'artist', 'language', 'layout', 'legalities_json', 'image_small', 'image_normal',
  'image_large', 'image_png', 'back_image_small', 'back_image_normal', 'back_image_large',
  'back_image_png', 'finishes_json', 'prices_json', 'card_faces_json', 'scryfall_uri', 'raw_json'
];

const upsertCardStatement = db.prepare(`
  INSERT INTO cards (${CARD_COLUMNS.join(', ')})
  VALUES (${CARD_COLUMNS.map(() => '?').join(', ')})
  ON CONFLICT(scryfall_id) DO UPDATE SET
    oracle_id = excluded.oracle_id,
    name = excluded.name,
    search_name = excluded.search_name,
    printed_name = excluded.printed_name,
    mana_cost = excluded.mana_cost,
    mana_value = excluded.mana_value,
    colors_json = excluded.colors_json,
    color_identity_json = excluded.color_identity_json,
    produced_mana_json = excluded.produced_mana_json,
    type_line = excluded.type_line,
    card_types_json = excluded.card_types_json,
    supertypes_json = excluded.supertypes_json,
    subtypes_json = excluded.subtypes_json,
    oracle_text = excluded.oracle_text,
    printed_text = excluded.printed_text,
    power = excluded.power,
    toughness = excluded.toughness,
    loyalty = excluded.loyalty,
    defense = excluded.defense,
    keywords_json = excluded.keywords_json,
    set_name = excluded.set_name,
    set_code = excluded.set_code,
    collector_number = excluded.collector_number,
    rarity = excluded.rarity,
    released_at = excluded.released_at,
    artist = excluded.artist,
    language = excluded.language,
    layout = excluded.layout,
    legalities_json = excluded.legalities_json,
    image_small = excluded.image_small,
    image_normal = excluded.image_normal,
    image_large = excluded.image_large,
    image_png = excluded.image_png,
    back_image_small = excluded.back_image_small,
    back_image_normal = excluded.back_image_normal,
    back_image_large = excluded.back_image_large,
    back_image_png = excluded.back_image_png,
    finishes_json = excluded.finishes_json,
    prices_json = excluded.prices_json,
    card_faces_json = excluded.card_faces_json,
    scryfall_uri = excluded.scryfall_uri,
    raw_json = excluded.raw_json,
    updated_at = CURRENT_TIMESTAMP
  RETURNING id
`);

function mappedValues(mapped) {
  const values = {
    scryfall_id: mapped.scryfallId,
    oracle_id: mapped.oracleId,
    name: mapped.name,
    search_name: mapped.searchName,
    printed_name: mapped.printedName,
    mana_cost: mapped.manaCost,
    mana_value: mapped.manaValue,
    colors_json: JSON.stringify(mapped.colors),
    color_identity_json: JSON.stringify(mapped.colorIdentity),
    produced_mana_json: JSON.stringify(mapped.producedMana),
    type_line: mapped.typeLine,
    card_types_json: JSON.stringify(mapped.cardTypes),
    supertypes_json: JSON.stringify(mapped.supertypes),
    subtypes_json: JSON.stringify(mapped.subtypes),
    oracle_text: mapped.oracleText,
    printed_text: mapped.printedText,
    power: mapped.power,
    toughness: mapped.toughness,
    loyalty: mapped.loyalty,
    defense: mapped.defense,
    keywords_json: JSON.stringify(mapped.keywords),
    set_name: mapped.setName,
    set_code: mapped.setCode,
    collector_number: mapped.collectorNumber,
    rarity: mapped.rarity,
    released_at: mapped.releasedAt,
    artist: mapped.artist,
    language: mapped.language,
    layout: mapped.layout,
    legalities_json: JSON.stringify(mapped.legalities),
    image_small: mapped.imageSmall,
    image_normal: mapped.imageNormal,
    image_large: mapped.imageLarge,
    image_png: mapped.imagePng,
    back_image_small: mapped.backImageSmall,
    back_image_normal: mapped.backImageNormal,
    back_image_large: mapped.backImageLarge,
    back_image_png: mapped.backImagePng,
    finishes_json: JSON.stringify(mapped.finishes),
    prices_json: JSON.stringify(mapped.prices),
    card_faces_json: JSON.stringify(mapped.cardFaces),
    scryfall_uri: mapped.scryfallUri,
    raw_json: JSON.stringify(mapped.raw)
  };
  return CARD_COLUMNS.map((column) => values[column]);
}

export function upsertScryfallCard(rawCard) {
  const mapped = mapScryfallCard(rawCard);
  assert(mapped.scryfallId && mapped.name, 502, 'Scryfall gaf onvolledige kaartgegevens terug.');
  const result = upsertCardStatement.get(...mappedValues(mapped));
  return getCardById(Number(result.id));
}

export function getCardById(id) {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  return enrichCardWithInsights(cardRowToApi(row));
}

export function requireCardById(id) {
  const card = getCardById(id);
  if (!card) throw new HttpError(404, 'Kaart niet gevonden.');
  return card;
}

export function getCardByScryfallId(scryfallId) {
  return enrichCardWithInsights(cardRowToApi(db.prepare('SELECT * FROM cards WHERE scryfall_id = ?').get(scryfallId)));
}

export function findCardByName(name, setCode = '') {
  const search = normalizeSearchText(name);
  const row = setCode
    ? db.prepare('SELECT * FROM cards WHERE search_name = ? AND set_code = ? ORDER BY released_at DESC LIMIT 1').get(search, setCode.toLowerCase())
    : db.prepare('SELECT * FROM cards WHERE name = ? COLLATE NOCASE ORDER BY released_at DESC LIMIT 1').get(name);
  return enrichCardWithInsights(cardRowToApi(row));
}

export function findCardByCollector(setCode, collectorNumber, language = '') {
  const row = language
    ? db.prepare('SELECT * FROM cards WHERE set_code = ? AND collector_number = ? AND language = ? LIMIT 1').get(String(setCode).toLowerCase(), String(collectorNumber), language)
    : db.prepare("SELECT * FROM cards WHERE set_code = ? AND collector_number = ? ORDER BY CASE WHEN language = 'en' THEN 0 ELSE 1 END LIMIT 1").get(String(setCode).toLowerCase(), String(collectorNumber));
  return enrichCardWithInsights(cardRowToApi(row));
}

export function getPrintingsByName(name) {
  return enrichCardsWithInsights(db
    .prepare('SELECT * FROM cards WHERE name = ? COLLATE NOCASE ORDER BY released_at DESC, set_code, collector_number')
    .all(name)
    .map(cardRowToApi));
}

function makePlaceholders(count) {
  return new Array(count).fill('?').join(', ');
}

export function usageMapsForKeys(keys) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const empty = {
    owned: new Map(),
    needed: new Map(),
    wanted: new Map(),
    decks: new Map()
  };
  if (!uniqueKeys.length) return empty;
  const placeholders = makePlaceholders(uniqueKeys.length);

  const ownedRows = db.prepare(`
    SELECT COALESCE(c.oracle_id, c.scryfall_id) AS card_key, SUM(ci.quantity) AS quantity
    FROM collection_items ci JOIN cards c ON c.id = ci.card_id
    WHERE COALESCE(c.oracle_id, c.scryfall_id) IN (${placeholders})
    GROUP BY card_key
  `).all(...uniqueKeys);

  const neededRows = db.prepare(`
    SELECT COALESCE(c.oracle_id, c.scryfall_id) AS card_key, SUM(dc.quantity) AS quantity
    FROM deck_cards dc JOIN cards c ON c.id = dc.card_id
    WHERE dc.role NOT IN ('sideboard', 'maybeboard')
      AND COALESCE(c.oracle_id, c.scryfall_id) IN (${placeholders})
    GROUP BY card_key
  `).all(...uniqueKeys);

  const wantedRows = db.prepare(`
    SELECT COALESCE(c.oracle_id, c.scryfall_id) AS card_key, SUM(w.quantity) AS quantity
    FROM wanted_items w JOIN cards c ON c.id = w.card_id
    WHERE COALESCE(c.oracle_id, c.scryfall_id) IN (${placeholders})
    GROUP BY card_key
  `).all(...uniqueKeys);

  const deckRows = db.prepare(`
    SELECT COALESCE(c.oracle_id, c.scryfall_id) AS card_key, d.id, d.name, SUM(dc.quantity) AS quantity
    FROM deck_cards dc
    JOIN cards c ON c.id = dc.card_id
    JOIN decks d ON d.id = dc.deck_id
    WHERE dc.role NOT IN ('maybeboard')
      AND COALESCE(c.oracle_id, c.scryfall_id) IN (${placeholders})
    GROUP BY card_key, d.id, d.name
    ORDER BY d.name COLLATE NOCASE
  `).all(...uniqueKeys);

  const result = {
    owned: new Map(ownedRows.map((row) => [row.card_key, Number(row.quantity || 0)])),
    needed: new Map(neededRows.map((row) => [row.card_key, Number(row.quantity || 0)])),
    wanted: new Map(wantedRows.map((row) => [row.card_key, Number(row.quantity || 0)])),
    decks: new Map()
  };
  for (const row of deckRows) {
    if (!result.decks.has(row.card_key)) result.decks.set(row.card_key, []);
    result.decks.get(row.card_key).push({ id: Number(row.id), name: row.name, quantity: Number(row.quantity) });
  }
  return result;
}

export function addUsage(card, maps) {
  const key = card.cardKey;
  const owned = maps.owned.get(key) || 0;
  const needed = maps.needed.get(key) || 0;
  const assumedAvailable = isBasicLand(card);
  const wanted = assumedAvailable ? 0 : (maps.wanted.get(key) || 0);
  return {
    ...card,
    usage: {
      owned,
      needed,
      free: Math.max(owned - needed, 0),
      shortage: assumedAvailable ? 0 : Math.max(needed - owned, 0),
      wanted,
      assumedAvailable,
      decks: maps.decks.get(key) || []
    }
  };
}

export function getCardWithUsage(id) {
  const card = requireCardById(id);
  return addUsage(card, usageMapsForKeys([card.cardKey]));
}

export function searchCards(query, limit = 20) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const rows = db.prepare(`
    SELECT c.*,
      COALESCE((SELECT SUM(ci.quantity) FROM collection_items ci WHERE ci.card_id = c.id), 0) AS printing_owned
    FROM cards c
    WHERE c.search_name LIKE ?
    ORDER BY
      CASE WHEN c.search_name = ? THEN 0 WHEN c.search_name LIKE ? THEN 1 ELSE 2 END,
      printing_owned DESC,
      c.name COLLATE NOCASE,
      c.released_at DESC
    LIMIT ?
  `).all(`%${normalized}%`, normalized, `${normalized}%`, Math.max(limit * 5, 50));

  const concepts = new Map();
  for (const row of rows) {
    const card = cardRowToApi(row);
    const current = concepts.get(card.cardKey);
    if (!current || Number(row.printing_owned || 0) > Number(current.printingOwned || 0)) {
      concepts.set(card.cardKey, { ...card, printingOwned: Number(row.printing_owned || 0) });
    }
  }
  const cards = enrichCardsWithInsights([...concepts.values()].slice(0, limit));
  const maps = usageMapsForKeys(cards.map((card) => card.cardKey));
  return cards.map((card) => addUsage(card, maps));
}

const COLLECTION_COLOR_CODES = new Set(['W', 'U', 'B', 'R', 'G', 'C', 'M']);

function flattenQueryValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenQueryValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(flattenQueryValues);
  return String(value ?? '').split(',');
}

function normalizeCollectionColors(value) {
  return [...new Set(flattenQueryValues(value)
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => COLLECTION_COLOR_CODES.has(entry)))];
}

export function listCollection(filters = {}) {
  const conditions = [];
  const params = [];
  const query = normalizeSearchText(filters.q || '');
  if (query) {
    conditions.push('c.search_name LIKE ?');
    params.push(`%${query}%`);
  }
  if (filters.cardKey) {
    conditions.push('COALESCE(c.oracle_id, c.scryfall_id) = ?');
    params.push(String(filters.cardKey));
  }
  if (filters.type) {
    conditions.push('c.card_types_json LIKE ?');
    params.push(`%"${filters.type}"%`);
  }
  if (filters.color) {
    const colors = normalizeCollectionColors(filters.color);

    // De historische API-waarde M blijft ondersteund. De normale kleurknoppen
    // gebruiken een exacte AND-selectie: alle gekozen kleuren moeten aanwezig
    // zijn en aanvullende kleuren worden uitgesloten.
    if (colors.length === 1 && colors[0] === 'M') {
      conditions.push('json_array_length(c.color_identity_json) > 1');
    } else {
      const selectedColors = colors.filter((color) => ['W', 'U', 'B', 'R', 'G'].includes(color));
      const includeColorless = colors.includes('C');

      if (includeColorless && selectedColors.length) {
        conditions.push('0 = 1');
      } else if (includeColorless) {
        conditions.push('json_array_length(c.color_identity_json) = 0');
      } else if (selectedColors.length) {
        const requiredColors = selectedColors.map(() => `EXISTS (
          SELECT 1 FROM json_each(c.color_identity_json) AS identity_color
          WHERE UPPER(CAST(identity_color.value AS TEXT)) = ?
        )`);
        conditions.push(`(
          json_array_length(c.color_identity_json) = ?
          AND ${requiredColors.join('\n          AND ')}
        )`);
        params.push(selectedColors.length, ...selectedColors);
      }
    }
  }
  if (filters.subtype) {
    conditions.push('c.subtypes_json LIKE ?');
    params.push(`%"${String(filters.subtype).replace(/"/g, '')}"%`);
  }
  if (filters.manaValue) {
    if (String(filters.manaValue) === '7+') conditions.push('c.mana_value >= 7');
    else {
      const manaValue = Number(filters.manaValue);
      if (Number.isFinite(manaValue)) {
        conditions.push('c.mana_value = ?');
        params.push(manaValue);
      }
    }
  }
  if (filters.ability) {
    conditions.push(`EXISTS (
      SELECT 1 FROM json_each(c.keywords_json) AS keyword
      WHERE LOWER(CAST(keyword.value AS TEXT)) = LOWER(?)
    )`);
    params.push(String(filters.ability));
  }
  // Commander-legaliteit blijft voor bestaande API-koppelingen ondersteund,
  // maar wordt niet meer als filter in de collectie-interface aangeboden.
  if (filters.commanderLegal) {
    conditions.push("json_extract(c.legalities_json, '$.commander') = ?");
    params.push(filters.commanderLegal === 'legal' ? 'legal' : 'not_legal');
  }
  if (filters.set) {
    conditions.push('c.set_code = ?');
    params.push(String(filters.set).toLowerCase());
  }
  if (filters.rarity) {
    conditions.push('c.rarity = ?');
    params.push(filters.rarity);
  }
  if (filters.finish) {
    conditions.push('ci.finish = ?');
    params.push(filters.finish);
  }
  if (filters.deckId) {
    conditions.push(`EXISTS (
      SELECT 1 FROM deck_cards dc JOIN cards deck_card ON deck_card.id = dc.card_id
      WHERE dc.deck_id = ?
        AND COALESCE(deck_card.oracle_id, deck_card.scryfall_id) = COALESCE(c.oracle_id, c.scryfall_id)
    )`);
    params.push(Number(filters.deckId));
  }

  if (['free', 'shortage', 'used'].includes(filters.availability)) {
    const ownedExpression = `(
      SELECT COALESCE(SUM(ci2.quantity), 0)
      FROM collection_items ci2
      JOIN cards owned_card ON owned_card.id = ci2.card_id
      WHERE COALESCE(owned_card.oracle_id, owned_card.scryfall_id) = COALESCE(c.oracle_id, c.scryfall_id)
    )`;
    const neededExpression = `(
      SELECT COALESCE(SUM(dc2.quantity), 0)
      FROM deck_cards dc2
      JOIN cards needed_card ON needed_card.id = dc2.card_id
      WHERE dc2.role NOT IN ('sideboard', 'maybeboard')
        AND COALESCE(needed_card.oracle_id, needed_card.scryfall_id) = COALESCE(c.oracle_id, c.scryfall_id)
    )`;
    if (filters.availability === 'free') conditions.push(`${ownedExpression} > ${neededExpression}`);
    if (filters.availability === 'shortage') {
      conditions.push(`NOT (c.card_types_json LIKE '%"Land"%' AND c.supertypes_json LIKE '%"Basic"%')`);
      conditions.push(`${neededExpression} > ${ownedExpression}`);
    }
    if (filters.availability === 'used') conditions.push(`${neededExpression} > 0`);
  }

  const limit = Math.min(Math.max(Number(filters.limit || 200), 1), 1000);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT c.*,
      c.id AS card_record_id,
      ci.id AS collection_item_id,
      ci.quantity AS collection_quantity,
      ci.finish AS collection_finish,
      ci.language AS collection_language,
      ci.condition AS collection_condition,
      ci.location AS collection_location,
      ci.notes AS collection_notes,
      ci.purchase_price AS collection_purchase_price,
      ci.created_at AS collection_created_at,
      ci.updated_at AS collection_updated_at
    FROM collection_items ci
    JOIN cards c ON c.id = ci.card_id
    ${where}
    ORDER BY c.name COLLATE NOCASE, c.set_code, c.collector_number, ci.finish
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const cards = enrichCardsWithInsights(rows.map((row) => cardRowToApi(row)));
  const maps = usageMapsForKeys(cards.map((card) => card.cardKey));
  const items = rows.map((row, index) => ({
    id: Number(row.collection_item_id),
    quantity: Number(row.collection_quantity),
    finish: row.collection_finish,
    language: row.collection_language,
    condition: row.collection_condition,
    location: row.collection_location,
    notes: row.collection_notes,
    purchasePrice: row.collection_purchase_price === null ? null : Number(row.collection_purchase_price),
    createdAt: row.collection_created_at,
    updatedAt: row.collection_updated_at,
    card: addUsage(cards[index], maps)
  }));

  const total = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM collection_items ci
    JOIN cards c ON c.id = ci.card_id
    ${where}
  `).get(...params).count);

  return { items, total, limit, offset };
}

export function collectionFilterOptions() {
  return {
    sets: db.prepare(`
      SELECT c.set_code AS code, c.set_name AS name, SUM(ci.quantity) AS quantity
      FROM collection_items ci JOIN cards c ON c.id = ci.card_id
      GROUP BY c.set_code, c.set_name ORDER BY c.set_name COLLATE NOCASE
    `).all().map((row) => ({ ...row, quantity: Number(row.quantity) })),
    abilities: db.prepare(`
      SELECT keyword.value AS name, COUNT(DISTINCT COALESCE(c.oracle_id, c.scryfall_id)) AS card_count
      FROM collection_items ci
      JOIN cards c ON c.id = ci.card_id
      JOIN json_each(c.keywords_json) AS keyword
      WHERE keyword.type = 'text' AND TRIM(CAST(keyword.value AS TEXT)) <> ''
      GROUP BY LOWER(CAST(keyword.value AS TEXT))
      ORDER BY CAST(keyword.value AS TEXT) COLLATE NOCASE
    `).all().map((row) => ({ name: String(row.name), cardCount: Number(row.card_count) })),
    decks: db.prepare('SELECT id, name FROM decks ORDER BY name COLLATE NOCASE').all().map((row) => ({ id: Number(row.id), name: row.name }))
  };
}

function reconcileWantedForKey(cardKey, acquiredQuantity) {
  let remaining = acquiredQuantity;
  const rows = db.prepare(`
    SELECT w.id, w.quantity
    FROM wanted_items w JOIN cards c ON c.id = w.card_id
    WHERE COALESCE(c.oracle_id, c.scryfall_id) = ?
    ORDER BY w.created_at, w.id
  `).all(cardKey);
  for (const row of rows) {
    if (remaining <= 0) break;
    const current = Number(row.quantity);
    if (remaining >= current) {
      db.prepare('DELETE FROM wanted_items WHERE id = ?').run(row.id);
      remaining -= current;
    } else {
      db.prepare('UPDATE wanted_items SET quantity = quantity - ? WHERE id = ?').run(remaining, row.id);
      remaining = 0;
    }
  }
}

export function addCollectionItem(input) {
  const card = requireCardById(input.cardId);
  return transaction(() => {
    const existing = db.prepare(`
      SELECT id FROM collection_items
      WHERE card_id = ? AND finish = ? AND language = ? AND condition = ? AND location = ?
    `).get(card.id, input.finish, input.language, input.condition, input.location);

    let itemId;
    if (existing) {
      db.prepare(`
        UPDATE collection_items
        SET quantity = quantity + ?, notes = CASE WHEN ? <> '' THEN ? ELSE notes END,
            purchase_price = COALESCE(?, purchase_price)
        WHERE id = ?
      `).run(input.quantity, input.notes, input.notes, input.purchasePrice, existing.id);
      itemId = Number(existing.id);
    } else {
      const result = db.prepare(`
        INSERT INTO collection_items
          (card_id, quantity, finish, language, condition, location, notes, purchase_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(card.id, input.quantity, input.finish, input.language, input.condition, input.location, input.notes, input.purchasePrice);
      itemId = Number(result.lastInsertRowid);
    }

    const deckPrintingAlignment = alignDeckPrintingsAfterAcquisition(card, {
      sourceWantedId: input.sourceWantedId || null
    });
    if (input.reconcileWanted !== false) reconcileWantedForKey(card.cardKey, input.quantity);
    return {
      ...getCollectionItem(itemId),
      deckPrintingAlignment
    };
  });
}

export function getCollectionItem(id) {
  const row = db.prepare(`
    SELECT c.*,
      c.id AS card_record_id,
      ci.id AS collection_item_id,
      ci.quantity AS collection_quantity,
      ci.finish AS collection_finish,
      ci.language AS collection_language,
      ci.condition AS collection_condition,
      ci.location AS collection_location,
      ci.notes AS collection_notes,
      ci.purchase_price AS collection_purchase_price
    FROM collection_items ci JOIN cards c ON c.id = ci.card_id WHERE ci.id = ?
  `).get(id);
  if (!row) return null;
  const card = getCardWithUsage(Number(row.card_record_id));
  return {
    id: Number(row.collection_item_id), quantity: Number(row.collection_quantity), finish: row.collection_finish,
    language: row.collection_language, condition: row.collection_condition, location: row.collection_location,
    notes: row.collection_notes, purchasePrice: row.collection_purchase_price === null ? null : Number(row.collection_purchase_price), card
  };
}

export function updateCollectionItem(id, input) {
  const existing = getCollectionItem(id);
  if (!existing) throw new HttpError(404, 'Collectieregel niet gevonden.');

  return transaction(() => {
    if (input.quantity === 0) {
      db.prepare('DELETE FROM collection_items WHERE id = ?').run(id);
      return null;
    }

    const duplicate = db.prepare(`
      SELECT id, quantity, notes, purchase_price
      FROM collection_items
      WHERE card_id = ? AND finish = ? AND language = ? AND condition = ? AND location = ? AND id <> ?
      LIMIT 1
    `).get(existing.card.id, input.finish, input.language, input.condition, input.location, id);

    if (duplicate) {
      const notes = [...new Set([duplicate.notes, input.notes].map((value) => String(value || '').trim()).filter(Boolean))]
        .join('\n\n')
        .slice(0, 5000);
      db.prepare(`
        UPDATE collection_items
        SET quantity = ?, notes = ?, purchase_price = COALESCE(?, purchase_price)
        WHERE id = ?
      `).run(Number(duplicate.quantity) + Number(input.quantity), notes, input.purchasePrice, duplicate.id);
      db.prepare('DELETE FROM collection_items WHERE id = ?').run(id);
      return getCollectionItem(Number(duplicate.id));
    }

    db.prepare(`
      UPDATE collection_items
      SET quantity = ?, finish = ?, language = ?, condition = ?, location = ?, notes = ?, purchase_price = ?
      WHERE id = ?
    `).run(input.quantity, input.finish, input.language, input.condition, input.location, input.notes, input.purchasePrice, id);
    return getCollectionItem(id);
  });
}

export function deleteCollectionItem(id) {
  const existing = getCollectionItem(id);
  if (!existing) throw new HttpError(404, 'Collectieregel niet gevonden.');
  db.prepare('DELETE FROM collection_items WHERE id = ?').run(id);
  return existing;
}

