import { db, transaction } from '../db/database.js';
import { deckTagKey } from '../lib/deck-tags.js';
import { HttpError } from '../lib/http-error.js';
import { positiveInteger, requiredString } from '../lib/validation.js';

function requireTagDeck(deckId) {
  const id = positiveInteger(deckId, 'Deck-ID');
  if (!db.prepare('SELECT id FROM decks WHERE id = ?').get(id)) {
    throw new HttpError(404, 'Deck niet gevonden.');
  }
  return id;
}

function checkedTagName(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Tagnaam moet tekst zijn.');
  const name = requiredString(value, 'Tagnaam', 60).normalize('NFC');
  if (/[\u0000-\u001f\u007f]/u.test(name)) throw new HttpError(400, 'Tagnaam bevat ongeldige tekens.');
  return name;
}

function requireTag(deckId, tagId) {
  const row = db.prepare('SELECT id, deck_id, name, name_key FROM deck_tags WHERE id = ? AND deck_id = ?')
    .get(positiveInteger(tagId, 'Tag-ID'), deckId);
  if (!row) throw new HttpError(404, 'Functionele tag niet gevonden in dit deck.');
  return row;
}

function assignedRows(deckId) {
  return db.prepare(`
    SELECT dct.deck_card_id, dct.tag FROM deck_card_tags dct
    JOIN deck_cards dc ON dc.id = dct.deck_card_id WHERE dc.deck_id = ?
  `).all(deckId);
}

export function listDeckTags(deckId) {
  const id = requireTagDeck(deckId);
  const counts = new Map();
  for (const row of assignedRows(id)) {
    const key = deckTagKey(row.tag);
    if (!counts.has(key)) counts.set(key, new Set());
    counts.get(key).add(Number(row.deck_card_id));
  }
  return db.prepare('SELECT id, name, name_key FROM deck_tags WHERE deck_id = ?').all(id)
    .map((row) => ({ id: Number(row.id), name: row.name, cardCount: counts.get(row.name_key)?.size || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base', numeric: true }) || a.id - b.id);
}

export function createDeckTag(deckId, value) {
  const name = checkedTagName(value);
  return transaction(() => {
    const id = requireTagDeck(deckId);
    const key = deckTagKey(name);
    if (db.prepare('SELECT id FROM deck_tags WHERE deck_id = ? AND name_key = ?').get(id, key)) {
      throw new HttpError(409, 'Deze functionele tag bestaat al in dit deck.');
    }
    const result = db.prepare('INSERT INTO deck_tags (deck_id, name, name_key) VALUES (?, ?, ?)').run(id, name, key);
    return { id: Number(result.lastInsertRowid), name, cardCount: 0 };
  });
}

export function renameDeckTag(deckId, tagId, value) {
  const name = checkedTagName(value);
  return transaction(() => {
    const id = requireTagDeck(deckId);
    const current = requireTag(id, tagId);
    const key = deckTagKey(name);
    const conflict = db.prepare('SELECT id FROM deck_tags WHERE deck_id = ? AND name_key = ?').get(id, key);
    if (conflict && Number(conflict.id) !== Number(current.id)) {
      throw new HttpError(409, 'Deze functionele tag bestaat al in dit deck.');
    }
    // Legacy assignments can differ in case or Unicode representation. Match
    // their canonical key, while restricting every write to this deck's rows.
    const affected = assignedRows(id).filter((row) => deckTagKey(row.tag) === current.name_key);
    const remove = db.prepare('DELETE FROM deck_card_tags WHERE deck_card_id = ? AND tag = ?');
    const add = db.prepare('INSERT OR IGNORE INTO deck_card_tags (deck_card_id, tag) VALUES (?, ?)');
    for (const row of affected) remove.run(row.deck_card_id, row.tag);
    for (const row of affected) add.run(row.deck_card_id, name);
    db.prepare('UPDATE deck_tags SET name = ?, name_key = ? WHERE id = ? AND deck_id = ?')
      .run(name, key, current.id, id);
    return { id: Number(current.id), name, cardCount: new Set(affected.map((row) => Number(row.deck_card_id))).size };
  });
}

export function deleteDeckTag(deckId, tagId) {
  return transaction(() => {
    const id = requireTagDeck(deckId);
    const current = requireTag(id, tagId);
    const affected = assignedRows(id).filter((row) => deckTagKey(row.tag) === current.name_key);
    const remove = db.prepare('DELETE FROM deck_card_tags WHERE deck_card_id = ? AND tag = ?');
    for (const row of affected) remove.run(row.deck_card_id, row.tag);
    db.prepare('DELETE FROM deck_tags WHERE id = ? AND deck_id = ?').run(current.id, id);
    return { id: Number(current.id), name: current.name, deleted: true };
  });
}

// Call inside the transaction that adds or updates the card. Stable IDs follow
// renames; a deleted or foreign-deck selection must never recreate a tag.
export function resolveDeckTagSelection(deckId, input = {}, { allowCreate = false } = {}) {
  const id = requireTagDeck(deckId);
  const hasIds = Object.hasOwn(input, 'tagIds');
  if (hasIds && Object.hasOwn(input, 'tags')) throw new HttpError(400, 'Gebruik tagIds of tags, niet beide.');
  const registry = db.prepare('SELECT id, name, name_key FROM deck_tags WHERE deck_id = ?').all(id);
  if (hasIds) {
    if (!Array.isArray(input.tagIds)) throw new HttpError(400, 'Functionele tag-ID’s moeten als lijst worden aangeleverd.');
    const byId = new Map(registry.map((row) => [Number(row.id), row.name]));
    return [...new Set(input.tagIds.map((value) => positiveInteger(value, 'Tag-ID')))].map((tagId) => {
      if (!byId.has(tagId)) {
        throw new HttpError(409, 'Een gekozen functionele tag bestaat niet meer in dit deck. Vernieuw de tags en kies opnieuw.');
      }
      return byId.get(tagId);
    });
  }
  const tags = input.tags ?? [];
  if (!Array.isArray(tags)) throw new HttpError(400, 'Functionele tags moeten als lijst worden aangeleverd.');
  const byKey = new Map(registry.map((row) => [row.name_key, row.name]));
  const names = new Map();
  for (const value of tags) {
    const rawName = allowCreate ? String(value ?? '').trim().slice(0, 60) : value;
    if (typeof rawName === 'string' && !rawName.trim()) continue;
    const name = checkedTagName(rawName);
    const key = deckTagKey(name);
    if (!byKey.has(key)) {
      if (!allowCreate) {
        throw new HttpError(409, `De functionele tag “${name}” bestaat niet in dit deck. Maak de tag eerst aan via Deckacties.`);
      }
      db.prepare('INSERT INTO deck_tags (deck_id, name, name_key) VALUES (?, ?, ?)').run(id, name, key);
      byKey.set(key, name);
    }
    names.set(key, byKey.get(key));
  }
  return [...names.values()];
}

export function copyDeckTags(sourceDeckId, targetDeckId) {
  db.prepare(`INSERT INTO deck_tags (deck_id, name, name_key)
    SELECT ?, name, name_key FROM deck_tags WHERE deck_id = ? ORDER BY id`).run(targetDeckId, sourceDeckId);
}
