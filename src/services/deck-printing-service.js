import { db } from '../db/database.js';
import { reassignDeckCardLinks } from './deck-link-service.js';

const SINGLETON_ROLES = new Set(['commander', 'partner', 'companion']);

function matchingDeckRows(card, sourceWantedId = null) {
  const params = [card.cardKey, card.id];
  let deckRestriction = '';
  if (sourceWantedId) {
    const wanted = db.prepare(`
      SELECT w.id, COALESCE(c.oracle_id, c.scryfall_id) AS card_key
      FROM wanted_items w JOIN cards c ON c.id = w.card_id
      WHERE w.id = ?
    `).get(sourceWantedId);
    if (!wanted || wanted.card_key !== card.cardKey) return [];
    const linked = db.prepare('SELECT deck_id FROM wanted_item_decks WHERE wanted_item_id = ?').all(sourceWantedId);
    // A wanted-item without an explicit deck link must never silently retarget
    // matching cards in every deck. Only the decks that created/claim this
    // wanted item are eligible for printing alignment.
    if (!linked.length) return [];
    const ids = linked.map((row) => Number(row.deck_id));
    deckRestriction = `AND dc.deck_id IN (${ids.map(() => '?').join(', ')})`;
    params.push(...ids);
  }

  return db.prepare(`
    SELECT dc.*, d.name AS deck_name,
      COALESCE(old_card.oracle_id, old_card.scryfall_id) AS card_key
    FROM deck_cards dc
    JOIN cards old_card ON old_card.id = dc.card_id
    JOIN decks d ON d.id = dc.deck_id
    WHERE COALESCE(old_card.oracle_id, old_card.scryfall_id) = ?
      AND dc.card_id <> ?
      ${deckRestriction}
      AND NOT EXISTS (
        SELECT 1 FROM collection_items existing_printing
        WHERE existing_printing.card_id = dc.card_id
          AND existing_printing.quantity > 0
      )
    ORDER BY dc.deck_id, dc.id
  `).all(...params);
}

function mergeNotes(left, right) {
  const values = [...new Set([left, right].map((value) => String(value || '').trim()).filter(Boolean))];
  return values.join('\n\n').slice(0, 5000);
}

function copyTags(sourceId, targetId) {
  db.prepare(`
    INSERT OR IGNORE INTO deck_card_tags (deck_card_id, tag)
    SELECT ?, tag FROM deck_card_tags WHERE deck_card_id = ?
  `).run(targetId, sourceId);
}

function alignDeckCard(row, newCardId) {
  const target = db.prepare(`
    SELECT * FROM deck_cards
    WHERE deck_id = ? AND card_id = ? AND role = ?
  `).get(row.deck_id, newCardId, row.role);

  let resultingDeckCardId;
  if (target) {
    const quantity = SINGLETON_ROLES.has(row.role)
      ? 1
      : Number(target.quantity) + Number(row.quantity);
    db.prepare(`
      UPDATE deck_cards SET quantity = ?, note = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(quantity, mergeNotes(target.note, row.note), target.id);
    copyTags(row.id, target.id);
    reassignDeckCardLinks(Number(row.deck_id), Number(row.id), Number(target.id));
    db.prepare('DELETE FROM deck_cards WHERE id = ?').run(row.id);
    resultingDeckCardId = Number(target.id);
  } else {
    db.prepare(`
      UPDATE deck_cards SET card_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(newCardId, row.id);
    resultingDeckCardId = Number(row.id);
  }

  db.prepare(`
    UPDATE decks
    SET commander_card_id = CASE WHEN commander_card_id = ? THEN ? ELSE commander_card_id END,
        second_commander_card_id = CASE WHEN second_commander_card_id = ? THEN ? ELSE second_commander_card_id END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(row.card_id, newCardId, row.card_id, newCardId, row.deck_id);

  return resultingDeckCardId;
}

export function alignDeckPrintingsAfterAcquisition(card, { sourceWantedId = null } = {}) {
  const rows = matchingDeckRows(card, sourceWantedId ? Number(sourceWantedId) : null);
  if (!rows.length) {
    return {
      updatedDeckCards: 0,
      deckIds: [],
      decks: []
    };
  }

  const deckMap = new Map();
  for (const row of rows) {
    alignDeckCard(row, card.id);
    deckMap.set(Number(row.deck_id), row.deck_name);
  }
  return {
    updatedDeckCards: rows.length,
    deckIds: [...deckMap.keys()],
    decks: [...deckMap.entries()].map(([id, name]) => ({ id, name }))
  };
}
