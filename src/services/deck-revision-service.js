import { createHash } from 'node:crypto';
import { db } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';
import { positiveInteger } from '../lib/validation.js';

export function getDeckRevision(deckId) {
  const id = positiveInteger(deckId, 'Deck-ID');
  // One SQLite statement observes a consistent snapshot, even when another
  // Node process writes to the same database. Values, not timestamp precision
  // or card totals, determine whether the displayed deck has changed.
  const rows = db.prepare(`
    WITH selected_deck AS (SELECT * FROM decks WHERE id = ?)
    SELECT 0 AS section, d.id AS entity_id, '' AS sort_key,
      json_object('id', d.id, 'name', d.name, 'description', d.description,
        'format', d.format, 'notes', d.notes, 'commander', d.commander_card_id,
        'partner', d.second_commander_card_id) AS payload
    FROM selected_deck d
    UNION ALL
    SELECT 1, dc.id, '',
      json_object('id', dc.id, 'card', dc.card_id, 'quantity', dc.quantity,
        'role', dc.role, 'note', dc.note)
    FROM deck_cards dc JOIN selected_deck d ON d.id = dc.deck_id
    UNION ALL
    SELECT 2, dt.deck_card_id, dt.tag, json_object('tag', dt.tag)
    FROM deck_card_tags dt JOIN deck_cards dc ON dc.id = dt.deck_card_id
      JOIN selected_deck d ON d.id = dc.deck_id
    UNION ALL
    SELECT 3, dt.id, '', json_object('id', dt.id, 'name', dt.name)
    FROM deck_tags dt JOIN selected_deck d ON d.id = dt.deck_id
    UNION ALL
    SELECT 4, g.id, '', json_object('id', g.id, 'name', g.name,
      'type', g.link_type, 'note', g.note)
    FROM deck_card_groups g JOIN selected_deck d ON d.id = g.deck_id
    UNION ALL
    SELECT 5, gm.group_id, CAST(gm.deck_card_id AS TEXT),
      json_object('card', gm.deck_card_id, 'position', gm.position)
    FROM deck_card_group_members gm JOIN deck_card_groups g ON g.id = gm.group_id
      JOIN selected_deck d ON d.id = g.deck_id
    ORDER BY section, entity_id, sort_key
  `).all(id);
  if (!rows.length || rows[0].section !== 0) throw new HttpError(404, 'Deck niet gevonden.');
  return { revision: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}
