import { db, transaction } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';
import { oneOf, positiveInteger } from '../lib/validation.js';
import { isBasicLand } from '../lib/card-rules.js';
import { cardRowToApi } from './card-mapper.js';
import { enrichCardsWithInsights } from './card-insight-service.js';
import { addUsage, requireCardById, usageMapsForKeys } from './card-repository.js';
import { upsertWanted } from './wanted-service.js';
import {
  cleanupDeckCardLinkGroups,
  copyDeckCardLinks,
  deckCardRelationMap,
  reassignDeckCardLinks
} from './deck-link-service.js';
import { resolveSinglePrintingCard } from './printing-catalog-service.js';

const COUNTED_ROLES = ['commander', 'partner', 'main'];
const COLOR_IDENTITY_ORDER = ['W', 'U', 'B', 'R', 'G'];

function deckColorIdentity(deckId, commanderCardId = null, secondCommanderCardId = null) {
  const commanderIds = [commanderCardId, secondCommanderCardId].filter(Boolean).map(Number);
  const rows = commanderIds.length
    ? db.prepare(`
        SELECT DISTINCT UPPER(CAST(identity_color.value AS TEXT)) AS color
        FROM cards c
        JOIN json_each(c.color_identity_json) AS identity_color
        WHERE c.id IN (${commanderIds.map(() => '?').join(', ')})
      `).all(...commanderIds)
    : db.prepare(`
        SELECT DISTINCT UPPER(CAST(identity_color.value AS TEXT)) AS color
        FROM deck_cards dc
        JOIN cards c ON c.id = dc.card_id
        JOIN json_each(c.color_identity_json) AS identity_color
        WHERE dc.deck_id = ?
          AND dc.role IN ('commander', 'partner', 'main')
      `).all(deckId);
  const colors = new Set(rows.map((row) => row.color));
  return COLOR_IDENTITY_ORDER.filter((color) => colors.has(color));
}

function deckRowToApi(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    format: row.format,
    commanderCardId: row.commander_card_id === null ? null : Number(row.commander_card_id),
    secondCommanderCardId: row.second_commander_card_id === null ? null : Number(row.second_commander_card_id),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getDeck(id) {
  const row = db.prepare('SELECT * FROM decks WHERE id = ?').get(id);
  if (!row) return null;
  const deck = deckRowToApi(row);
  deck.commander = row.commander_card_id ? requireCardById(row.commander_card_id) : null;
  deck.secondCommander = row.second_commander_card_id ? requireCardById(row.second_commander_card_id) : null;
  deck.colorIdentity = deckColorIdentity(id, row.commander_card_id, row.second_commander_card_id);
  deck.totalCards = Number(db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS total FROM deck_cards
    WHERE deck_id = ? AND role IN ('commander', 'partner', 'main')
  `).get(id).total);
  deck.uniqueCards = Number(db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(c.oracle_id, c.scryfall_id)) AS total
    FROM deck_cards dc JOIN cards c ON c.id = dc.card_id
    WHERE dc.deck_id = ? AND dc.role IN ('commander', 'partner', 'main')
  `).get(id).total);
  return deck;
}

export function requireDeck(id) {
  const deck = getDeck(id);
  if (!deck) throw new HttpError(404, 'Deck niet gevonden.');
  return deck;
}

export function listDecks() {
  return db.prepare('SELECT * FROM decks ORDER BY updated_at DESC, name COLLATE NOCASE').all().map((row) => {
    const deck = deckRowToApi(row);
    const totals = db.prepare(`
      SELECT COALESCE(SUM(dc.quantity), 0) AS total,
        COUNT(DISTINCT COALESCE(c.oracle_id, c.scryfall_id)) AS unique_cards
      FROM deck_cards dc JOIN cards c ON c.id = dc.card_id
      WHERE dc.deck_id = ? AND dc.role IN ('commander', 'partner', 'main')
    `).get(deck.id);
    const missing = getDeckMissing(deck.id);
    return {
      ...deck,
      totalCards: Number(totals.total),
      uniqueCards: Number(totals.unique_cards),
      missingQuantity: missing.summary.missingFromCollection,
      missingUnique: missing.summary.uniqueMissingFromCollection,
      globalShortage: missing.summary.globalShortage,
      colorIdentity: deckColorIdentity(deck.id, row.commander_card_id, row.second_commander_card_id),
      commander: row.commander_card_id ? requireCardById(row.commander_card_id) : null
    };
  });
}

export function createDeck(input) {
  try {
    const result = db.prepare(`
      INSERT INTO decks (name, description, format, notes) VALUES (?, ?, ?, ?)
    `).run(input.name, input.description, input.format, input.notes);
    const id = Number(result.lastInsertRowid);
    return getDeck(id);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Er bestaat al een deck met deze naam.');
    throw error;
  }
}

export function updateDeck(id, input) {
  requireDeck(id);
  try {
    db.prepare(`
      UPDATE decks SET name = ?, description = ?, format = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(input.name, input.description, input.format, input.notes, id);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Er bestaat al een deck met deze naam.');
    throw error;
  }
  return getDeck(id);
}

export function deleteDeck(id) {
  const deck = requireDeck(id);
  db.prepare('DELETE FROM decks WHERE id = ?').run(id);
  return deck;
}

function mergeDeckNotes(left, right) {
  const note = [...new Set([left, right].filter(Boolean))].join('\n\n');
  if (note.length > 5000) {
    throw new HttpError(409, 'De samengevoegde decknotitie is te lang. Verkort de notities voordat je deze kaarten samenvoegt.');
  }
  return note;
}

function moveOldCommanderToMain(deckId, column, newCardId, role) {
  const deckRow = db.prepare(`SELECT ${column} AS card_id FROM decks WHERE id = ?`).get(deckId);
  const oldCardId = deckRow?.card_id ? Number(deckRow.card_id) : null;
  if (!oldCardId || oldCardId === newCardId) return;
  const oldRoleRow = db.prepare('SELECT * FROM deck_cards WHERE deck_id = ? AND card_id = ? AND role = ?').get(deckId, oldCardId, role);
  if (!oldRoleRow) return;
  const mainRow = db.prepare("SELECT id, quantity, note FROM deck_cards WHERE deck_id = ? AND card_id = ? AND role = 'main'").get(deckId, oldCardId);
  if (mainRow) {
    const note = mergeDeckNotes(mainRow.note, oldRoleRow.note);
    const quantity = positiveInteger(Number(mainRow.quantity) + Number(oldRoleRow.quantity), 'Totaalaantal');
    db.prepare('UPDATE deck_cards SET quantity = ?, note = ? WHERE id = ?')
      .run(quantity, note, mainRow.id);
    db.prepare(`
      INSERT OR IGNORE INTO deck_card_tags (deck_card_id, tag)
      SELECT ?, tag FROM deck_card_tags WHERE deck_card_id = ?
    `).run(mainRow.id, oldRoleRow.id);
    reassignDeckCardLinks(deckId, Number(oldRoleRow.id), Number(mainRow.id));
    db.prepare('DELETE FROM deck_cards WHERE id = ?').run(oldRoleRow.id);
  } else {
    db.prepare("UPDATE deck_cards SET role = 'main' WHERE id = ?").run(oldRoleRow.id);
  }
}

function synchronizeCommanderPointers(deckId, cardId, role) {
  if (role === 'commander') {
    moveOldCommanderToMain(deckId, 'commander_card_id', cardId, 'commander');
    db.prepare('UPDATE decks SET commander_card_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(cardId, deckId);
  }
  if (role === 'partner') {
    moveOldCommanderToMain(deckId, 'second_commander_card_id', cardId, 'partner');
    db.prepare('UPDATE decks SET second_commander_card_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(cardId, deckId);
  }
}

export function addDeckCard(deckId, input) {
  const deck = requireDeck(deckId);
  const card = requireCardById(input.cardId);
  const quantity = ['commander', 'partner', 'companion'].includes(input.role) ? 1 : input.quantity;

  return transaction(() => {
    synchronizeCommanderPointers(deckId, card.id, input.role);
    const singletonRole = ['commander', 'partner', 'companion'].includes(input.role);
    let existing = db.prepare('SELECT id, quantity, note FROM deck_cards WHERE deck_id = ? AND card_id = ? AND role = ?')
      .get(deckId, card.id, input.role);
    let deckCardId;

    // When a card already sits in the main deck and is promoted to a singleton role,
    // move one copy instead of silently creating an unintended duplicate.
    if (!existing && singletonRole) {
      const main = db.prepare("SELECT id, quantity, note FROM deck_cards WHERE deck_id = ? AND card_id = ? AND role = 'main'")
        .get(deckId, card.id);
      if (main) {
        if (Number(main.quantity) === 1) {
          db.prepare('UPDATE deck_cards SET role = ? WHERE id = ?').run(input.role, main.id);
          existing = main;
        } else {
          db.prepare('UPDATE deck_cards SET quantity = quantity - 1 WHERE id = ?').run(main.id);
        }
      }
    }

    if (existing) {
      const note = mergeDeckNotes(existing.note, input.note);
      if (singletonRole) {
        db.prepare(`
          UPDATE deck_cards SET quantity = 1, note = ? WHERE id = ?
        `).run(note, existing.id);
      } else {
        const total = positiveInteger(Number(existing.quantity) + Number(quantity), 'Totaalaantal');
        db.prepare(`
          UPDATE deck_cards SET quantity = ?, note = ? WHERE id = ?
        `).run(total, note, existing.id);
      }
      deckCardId = Number(existing.id);
    } else {
      const result = db.prepare(`
        INSERT INTO deck_cards (deck_id, card_id, quantity, role, note) VALUES (?, ?, ?, ?, ?)
      `).run(deckId, card.id, quantity, input.role, input.note);
      deckCardId = Number(result.lastInsertRowid);
    }
    mergeTags(deckCardId, input.tags || []);
    return getDeckCard(deckCardId);
  });
}

function mergeTags(deckCardId, tags) {
  const insert = db.prepare('INSERT OR IGNORE INTO deck_card_tags (deck_card_id, tag) VALUES (?, ?)');
  for (const rawTag of tags) {
    const tag = String(rawTag).trim().slice(0, 60);
    if (tag) insert.run(deckCardId, tag);
  }
}

function replaceTags(deckCardId, tags) {
  db.prepare('DELETE FROM deck_card_tags WHERE deck_card_id = ?').run(deckCardId);
  mergeTags(deckCardId, tags);
}

function tagsForDeckCardIds(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const placeholders = ids.map(() => '?').join(', ');
  for (const row of db.prepare(`SELECT deck_card_id, tag FROM deck_card_tags WHERE deck_card_id IN (${placeholders}) ORDER BY tag COLLATE NOCASE`).all(...ids)) {
    const id = Number(row.deck_card_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row.tag);
  }
  return map;
}

export function getDeckCards(deckId, { includeMaybeboard = true } = {}) {
  requireDeck(deckId);
  const whereMaybe = includeMaybeboard ? '' : "AND dc.role <> 'maybeboard'";
  const rows = db.prepare(`
    SELECT c.*,
      dc.id AS deck_card_id, dc.quantity AS deck_quantity, dc.role AS deck_role,
      dc.note AS deck_note, dc.created_at AS deck_card_created_at, dc.updated_at AS deck_card_updated_at
    FROM deck_cards dc JOIN cards c ON c.id = dc.card_id
    WHERE dc.deck_id = ? ${whereMaybe}
    ORDER BY
      CASE dc.role WHEN 'commander' THEN 0 WHEN 'partner' THEN 1 WHEN 'companion' THEN 2 WHEN 'main' THEN 3 WHEN 'sideboard' THEN 4 ELSE 5 END,
      c.name COLLATE NOCASE
  `).all(deckId);
  const cards = enrichCardsWithInsights(rows.map(cardRowToApi));
  const maps = usageMapsForKeys(cards.map((card) => card.cardKey));
  const tags = tagsForDeckCardIds(rows.map((row) => Number(row.deck_card_id)));
  const relations = deckCardRelationMap(deckId);

  return rows.map((row, index) => {
    const card = addUsage(cards[index], maps);
    const quantity = Number(row.deck_quantity);
    const owned = card.usage.owned;
    const basicLand = isBasicLand(card);
    const physicallyOwned = Math.min(quantity, owned);
    const assumedBasicLand = basicLand ? Math.max(quantity - physicallyOwned, 0) : 0;
    const directlyOwned = basicLand ? quantity : physicallyOwned;
    const missingFromCollection = basicLand ? 0 : Math.max(quantity - owned, 0);
    const globalShortage = basicLand ? 0 : Math.max(card.usage.needed - owned, 0);
    const shortageForWanted = Math.max(missingFromCollection, globalShortage);
    return {
      id: Number(row.deck_card_id),
      quantity,
      role: row.deck_role,
      note: row.deck_note,
      tags: tags.get(Number(row.deck_card_id)) || [],
      relations: relations.get(Number(row.deck_card_id)) || [],
      createdAt: row.deck_card_created_at,
      updatedAt: row.deck_card_updated_at,
      coverage: {
        physicallyOwned,
        assumedBasicLand,
        assumedAvailable: basicLand,
        directlyOwned,
        missingFromCollection,
        globalShortage,
        wantedGap: basicLand ? 0 : Math.max(shortageForWanted - card.usage.wanted, 0),
        sharedConflict: globalShortage > 0 && card.usage.needed > quantity,
        onWanted: !basicLand && card.usage.wanted > 0
      },
      card
    };
  });
}

export function getDeckCard(deckCardId) {
  const row = db.prepare('SELECT deck_id FROM deck_cards WHERE id = ?').get(deckCardId);
  if (!row) return null;
  return getDeckCards(Number(row.deck_id)).find((item) => item.id === Number(deckCardId)) || null;
}

export function updateDeckCard(deckId, deckCardId, input) {
  requireDeck(deckId);
  const existing = db.prepare('SELECT * FROM deck_cards WHERE id = ? AND deck_id = ?').get(deckCardId, deckId);
  if (!existing) throw new HttpError(404, 'Kaartregel in deck niet gevonden.');
  const quantity = ['commander', 'partner', 'companion'].includes(input.role) ? 1 : input.quantity;
  return transaction(() => {
    synchronizeCommanderPointers(deckId, Number(existing.card_id), input.role);
    if (existing.role === 'commander' && input.role !== 'commander') {
      db.prepare('UPDATE decks SET commander_card_id = NULL WHERE id = ? AND commander_card_id = ?').run(deckId, existing.card_id);
    }
    if (existing.role === 'partner' && input.role !== 'partner') {
      db.prepare('UPDATE decks SET second_commander_card_id = NULL WHERE id = ? AND second_commander_card_id = ?').run(deckId, existing.card_id);
    }
    try {
      db.prepare('UPDATE deck_cards SET quantity = ?, role = ?, note = ? WHERE id = ?')
        .run(quantity, input.role, input.note, deckCardId);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Deze kaart staat al met die rol in het deck.');
      throw error;
    }
    replaceTags(deckCardId, input.tags || []);
    return getDeckCard(deckCardId);
  });
}

export function deleteDeckCard(deckId, deckCardId) {
  requireDeck(deckId);
  const row = db.prepare('SELECT id FROM deck_cards WHERE id = ? AND deck_id = ?').get(deckCardId, deckId);
  if (!row) throw new HttpError(404, 'Kaartregel in deck niet gevonden.');
  const existing = getDeckCard(deckCardId);
  if (!existing) throw new HttpError(404, 'Kaartregel in deck niet gevonden.');
  transaction(() => {
    db.prepare('DELETE FROM deck_cards WHERE id = ? AND deck_id = ?').run(deckCardId, deckId);
    if (existing.role === 'commander') db.prepare('UPDATE decks SET commander_card_id = NULL WHERE id = ?').run(deckId);
    if (existing.role === 'partner') db.prepare('UPDATE decks SET second_commander_card_id = NULL WHERE id = ?').run(deckId);
    cleanupDeckCardLinkGroups(deckId);
  });
  return existing;
}

export function duplicateDeck(id, name) {
  const source = requireDeck(id);
  return transaction(() => {
    let result;
    try {
      result = db.prepare(`
        INSERT INTO decks (name, description, format, notes) VALUES (?, ?, ?, ?)
      `).run(name, source.description, source.format, source.notes);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Er bestaat al een deck met deze naam.');
      throw error;
    }
    const newId = Number(result.lastInsertRowid);
    const cards = db.prepare('SELECT * FROM deck_cards WHERE deck_id = ? ORDER BY id').all(id);
    const insert = db.prepare('INSERT INTO deck_cards (deck_id, card_id, quantity, role, note) VALUES (?, ?, ?, ?, ?)');
    const deckCardIdMap = new Map();
    for (const card of cards) {
      const cardResult = insert.run(newId, card.card_id, card.quantity, card.role, card.note);
      const newDeckCardId = Number(cardResult.lastInsertRowid);
      deckCardIdMap.set(Number(card.id), newDeckCardId);
      const tags = db.prepare('SELECT tag FROM deck_card_tags WHERE deck_card_id = ?').all(card.id);
      replaceTags(newDeckCardId, tags.map((tag) => tag.tag));
      if (card.role === 'commander') db.prepare('UPDATE decks SET commander_card_id = ? WHERE id = ?').run(card.card_id, newId);
      if (card.role === 'partner') db.prepare('UPDATE decks SET second_commander_card_id = ? WHERE id = ?').run(card.card_id, newId);
    }
    copyDeckCardLinks(id, newId, deckCardIdMap);
    return getDeck(newId);
  });
}

export function getDeckMissing(deckId) {
  const items = getDeckCards(deckId, { includeMaybeboard: false }).filter((item) => COUNTED_ROLES.includes(item.role));
  const byKey = new Map();
  for (const item of items) {
    const key = item.card.cardKey;
    if (!byKey.has(key)) {
      byKey.set(key, {
        card: item.card,
        basicLand: isBasicLand(item.card),
        quantity: 0,
        owned: item.card.usage.owned,
        neededAllDecks: item.card.usage.needed,
        wanted: item.card.usage.wanted,
        roles: []
      });
    }
    const row = byKey.get(key);
    row.quantity += item.quantity;
    row.roles.push(item.role);
  }
  const all = [...byKey.values()].map((row) => {
    const physicallyOwned = Math.min(row.quantity, row.owned);
    return {
      ...row,
      physicallyOwned,
      assumedBasicLand: row.basicLand ? Math.max(row.quantity - physicallyOwned, 0) : 0,
      directlyOwned: row.basicLand ? row.quantity : physicallyOwned,
      missingFromCollection: row.basicLand ? 0 : Math.max(row.quantity - row.owned, 0),
      globalShortage: row.basicLand ? 0 : Math.max(row.neededAllDecks - row.owned, 0),
      wantedGap: row.basicLand ? 0 : Math.max(Math.max(row.neededAllDecks - row.owned, 0) - row.wanted, 0)
    };
  });
  const totalCards = all.reduce((sum, row) => sum + row.quantity, 0);
  const directlyOwned = all.reduce((sum, row) => sum + row.directlyOwned, 0);
  const globalShortage = all.reduce((sum, row) => sum + row.globalShortage, 0);
  return {
    items: all.filter((row) => row.missingFromCollection > 0 || row.globalShortage > 0),
    summary: {
      totalCards,
      directlyOwned,
      physicallyOwned: all.reduce((sum, row) => sum + row.physicallyOwned, 0),
      assumedBasicLands: all.reduce((sum, row) => sum + row.assumedBasicLand, 0),
      missingFromCollection: all.reduce((sum, row) => sum + row.missingFromCollection, 0),
      globalShortage,
      uniqueMissingFromCollection: all.filter((row) => row.missingFromCollection > 0).length,
      uniqueShortages: all.filter((row) => row.globalShortage > 0).length,
      onWanted: all.reduce((sum, row) => sum + Math.min(row.globalShortage, row.wanted), 0),
      notOnWanted: all.reduce((sum, row) => sum + row.wantedGap, 0)
    }
  };
}

export async function addMissingToWanted(deckId) {
  requireDeck(deckId);
  const missing = getDeckMissing(deckId);
  const prepared = [];
  for (const row of missing.items) {
    if (row.wantedGap <= 0) continue;
    let printingCardId = null;
    try {
      printingCardId = (await resolveSinglePrintingCard(row.card))?.id || null;
    } catch (error) {
      console.warn(`[wanted] Automatische printingkeuze voor ${row.card.name} is overgeslagen: ${error.message}`);
    }
    prepared.push({ row, printingCardId });
  }
  return transaction(() => {
    // Printing lookup may yield to another request. Re-read both the deck and
    // current shortages before writing, so concurrent fills cannot add twice.
    const currentDeck = requireDeck(deckId);
    const printingByKey = new Map(prepared.map(({ row, printingCardId }) => [row.card.cardKey, printingCardId]));
    const currentMissing = getDeckMissing(deckId);
    const added = currentMissing.items
      .filter((row) => row.wantedGap > 0 && printingByKey.has(row.card.cardKey))
      .map((row) => upsertWanted({
        cardId: row.card.id,
        printingCardId: printingByKey.get(row.card.cardKey),
        deckIds: [deckId],
        quantity: row.wantedGap,
        priority: 3,
        maximumPrice: null,
        notes: `Ontbreekt voor deck: ${currentDeck.name}`
      }, { matchOracle: true }));
    return { added, missing: getDeckMissing(deckId) };
  });
}

function aggregateExportRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.cardKey || String(row.name || '').trim().toLocaleLowerCase('en');
    if (!grouped.has(key)) grouped.set(key, { quantity: 0, name: row.name });
    grouped.get(key).quantity += Number(row.quantity || 0);
  }
  return [...grouped.values()].filter((row) => row.quantity > 0);
}

export function exportDeckText(deckId, { missingOnly = false } = {}) {
  const deck = requireDeck(deckId);
  let rows;
  if (missingOnly) {
    rows = aggregateExportRows(getDeckMissing(deckId).items
      .filter((row) => row.globalShortage > 0)
      .map((row) => ({ quantity: row.globalShortage, name: row.card.name, cardKey: row.card.cardKey })));
  } else {
    rows = aggregateExportRows(getDeckCards(deckId)
      .filter((row) => row.role !== 'maybeboard')
      .map((row) => ({ quantity: row.quantity, name: row.card.name, cardKey: row.card.cardKey })));
  }
  return {
    filename: `${deck.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'deck'}${missingOnly ? '-ontbrekend' : ''}.txt`,
    text: rows.map((row) => `${row.quantity} ${row.name}`).join('\n') + (rows.length ? '\n' : '')
  };
}

function forgeCardName(card) {
  let name = String(card.name || '');
  // Forge identifies these cards by their front face. Split cards (including
  // aftermath and rooms) retain the combined "First // Second" name.
  if (['transform', 'modal_dfc', 'adventure', 'flip', 'double_faced_token'].includes(card.layout)) {
    name = String(card.cardFaces?.[0]?.name || '').trim() || name.split(/\s*\/\/\s*/)[0];
  } else if (card.layout === 'split') {
    name = name.split(/\s*\/\/\s*/).join(' // ');
  }
  return name.replace(/[\r\n]+/g, ' ').trim();
}

export function exportDeckDck(deckId) {
  const deck = requireDeck(deckId);
  const cards = getDeckCards(deckId, { includeMaybeboard: false });
  const lines = ['[metadata]', `Name=${deck.name.replace(/[\r\n]+/g, ' ').trim()}`];
  const sections = [
    ['Commander', ['commander', 'partner']],
    ['Main', ['main']],
    // Forge stores companions in the sideboard, not a separate Companion section.
    ['Sideboard', ['sideboard', 'companion']]
  ];
  for (const [section, roles] of sections) {
    const rows = aggregateExportRows(cards.filter((row) => roles.includes(row.role))
      .map((row) => ({ quantity: row.quantity, name: forgeCardName(row.card), cardKey: row.card.cardKey })));
    if (!rows.length && section !== 'Main') continue;
    lines.push(`[${section}]`, ...rows.map((row) => `${row.quantity} ${row.name}`));
  }
  return {
    filename: `${deck.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'deck'}.dck`,
    text: `${lines.join('\n')}\n`
  };
}

export function exportDeck(deckId, { format = 'txt' } = {}) {
  const selectedFormat = oneOf(format, ['txt', 'dck'], 'Exportformaat', 'txt');
  const result = selectedFormat === 'dck' ? exportDeckDck(deckId) : exportDeckText(deckId);
  return { ...result, format: selectedFormat };
}
