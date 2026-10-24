import { deckTagKey } from '../lib/deck-tags.js';

// Called inside the existing schema transaction. Assigned tags remain intact;
// only the new per-deck registry is populated, once per canonical tag name.
export function migrateDeckTags(database) {
  const rows = database.prepare(`
    SELECT dc.deck_id, dct.tag FROM deck_card_tags dct
    JOIN deck_cards dc ON dc.id = dct.deck_card_id
    ORDER BY dc.deck_id, dct.tag COLLATE NOCASE, dct.tag, dc.id
  `).all();
  const find = database.prepare('SELECT id FROM deck_tags WHERE deck_id = ? AND name_key = ?');
  const insert = database.prepare('INSERT INTO deck_tags (deck_id, name, name_key) VALUES (?, ?, ?)');
  for (const row of rows) {
    const name = String(row.tag).trim();
    const key = deckTagKey(name);
    if (key && !find.get(row.deck_id, key)) insert.run(row.deck_id, name, key);
  }
}
