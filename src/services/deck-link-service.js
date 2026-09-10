import { db, transaction } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';

function requireDeckRow(deckId) {
  const deck = db.prepare('SELECT id, name FROM decks WHERE id = ?').get(deckId);
  if (!deck) throw new HttpError(404, 'Deck niet gevonden.');
  return deck;
}

function normalizeDeckCardIds(values) {
  const source = Array.isArray(values) ? values : [];
  const ids = [...new Set(source.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (ids.length < 2) throw new HttpError(400, 'Een combo of synergie moet minimaal twee kaarten bevatten.');
  return ids;
}

function requireDeckCardRows(deckId, values) {
  const ids = normalizeDeckCardIds(values);
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT dc.id AS deck_card_id, dc.deck_id, dc.card_id, dc.quantity, dc.role,
      c.name AS card_name
    FROM deck_cards dc
    JOIN cards c ON c.id = dc.card_id
    WHERE dc.deck_id = ? AND dc.id IN (${placeholders})
  `).all(deckId, ...ids);
  if (rows.length !== ids.length) {
    throw new HttpError(400, 'Een of meer gekozen kaarten staan niet in dit deck.');
  }
  const byId = new Map(rows.map((row) => [Number(row.deck_card_id), row]));
  return ids.map((id) => byId.get(id));
}

function memberRowToApi(row) {
  return {
    deckCardId: Number(row.deck_card_id),
    cardId: Number(row.card_id),
    name: row.card_name,
    quantity: Number(row.quantity),
    role: row.role,
    position: Number(row.position || 0)
  };
}

function selectGroups(where, params = []) {
  const groupRows = db.prepare(`
    SELECT g.*
    FROM deck_card_groups g
    ${where}
    ORDER BY
      CASE g.link_type WHEN 'combo' THEN 0 ELSE 1 END,
      g.name COLLATE NOCASE,
      g.id
  `).all(...params);

  if (!groupRows.length) return [];
  const ids = groupRows.map((row) => Number(row.id));
  const placeholders = ids.map(() => '?').join(', ');
  const membersByGroup = new Map();
  const memberRows = db.prepare(`
    SELECT m.group_id, m.deck_card_id, m.position,
      dc.card_id, dc.quantity, dc.role,
      c.name AS card_name
    FROM deck_card_group_members m
    JOIN deck_cards dc ON dc.id = m.deck_card_id
    JOIN cards c ON c.id = dc.card_id
    WHERE m.group_id IN (${placeholders})
    ORDER BY m.group_id, m.position, c.name COLLATE NOCASE, m.deck_card_id
  `).all(...ids);

  for (const row of memberRows) {
    const groupId = Number(row.group_id);
    if (!membersByGroup.has(groupId)) membersByGroup.set(groupId, []);
    membersByGroup.get(groupId).push(memberRowToApi(row));
  }

  return groupRows.map((row) => {
    const members = membersByGroup.get(Number(row.id)) || [];
    return {
      id: Number(row.id),
      deckId: Number(row.deck_id),
      name: row.name,
      type: row.link_type,
      note: row.note,
      memberCount: members.length,
      members,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });
}

export function listDeckCardLinks(deckId) {
  requireDeckRow(deckId);
  return selectGroups('WHERE g.deck_id = ?', [deckId]);
}

export function deckCardRelationMap(deckId) {
  const map = new Map();
  for (const group of listDeckCardLinks(deckId)) {
    for (const member of group.members) {
      if (!map.has(member.deckCardId)) map.set(member.deckCardId, []);
      map.get(member.deckCardId).push(group);
    }
  }
  return map;
}

export function getDeckCardLink(deckId, linkId) {
  requireDeckRow(deckId);
  return selectGroups('WHERE g.deck_id = ? AND g.id = ?', [deckId, linkId])[0] || null;
}

function insertMembers(groupId, memberRows) {
  const insert = db.prepare(`
    INSERT INTO deck_card_group_members (group_id, deck_card_id, position)
    VALUES (?, ?, ?)
  `);
  memberRows.forEach((member, index) => insert.run(groupId, member.deck_card_id, index));
}

export function createDeckCardLink(deckId, input) {
  requireDeckRow(deckId);
  const members = requireDeckCardRows(deckId, input.deckCardIds);
  const id = transaction(() => {
    const result = db.prepare(`
      INSERT INTO deck_card_groups (deck_id, name, link_type, note)
      VALUES (?, ?, ?, ?)
    `).run(deckId, input.name, input.type, input.note);
    const groupId = Number(result.lastInsertRowid);
    insertMembers(groupId, members);
    return groupId;
  });
  return getDeckCardLink(deckId, id);
}

export function updateDeckCardLink(deckId, linkId, input) {
  const current = getDeckCardLink(deckId, linkId);
  if (!current) throw new HttpError(404, 'Combo of synergie niet gevonden.');
  const members = requireDeckCardRows(deckId, input.deckCardIds);
  transaction(() => {
    db.prepare(`
      UPDATE deck_card_groups
      SET name = ?, link_type = ?, note = ?
      WHERE id = ? AND deck_id = ?
    `).run(input.name, input.type, input.note, linkId, deckId);
    db.prepare('DELETE FROM deck_card_group_members WHERE group_id = ?').run(linkId);
    insertMembers(linkId, members);
  });
  return getDeckCardLink(deckId, linkId);
}

export function deleteDeckCardLink(deckId, linkId) {
  const current = getDeckCardLink(deckId, linkId);
  if (!current) throw new HttpError(404, 'Combo of synergie niet gevonden.');
  db.prepare('DELETE FROM deck_card_groups WHERE id = ? AND deck_id = ?').run(linkId, deckId);
  return current;
}

export function cleanupDeckCardLinkGroups(deckId) {
  return Number(db.prepare(`
    DELETE FROM deck_card_groups
    WHERE deck_id = ?
      AND (SELECT COUNT(*) FROM deck_card_group_members m WHERE m.group_id = deck_card_groups.id) < 2
  `).run(deckId).changes || 0);
}

export function reassignDeckCardLinks(deckId, oldDeckCardId, newDeckCardId) {
  if (Number(oldDeckCardId) === Number(newDeckCardId)) return;
  const memberships = db.prepare(`
    SELECT group_id, position
    FROM deck_card_group_members
    WHERE deck_card_id = ?
  `).all(oldDeckCardId);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO deck_card_group_members (group_id, deck_card_id, position)
    VALUES (?, ?, ?)
  `);
  for (const membership of memberships) {
    insert.run(membership.group_id, newDeckCardId, membership.position);
  }
  db.prepare('DELETE FROM deck_card_group_members WHERE deck_card_id = ?').run(oldDeckCardId);
  cleanupDeckCardLinkGroups(deckId);
}

export function copyDeckCardLinks(sourceDeckId, targetDeckId, deckCardIdMap) {
  const sourceGroups = listDeckCardLinks(sourceDeckId);
  const insertGroup = db.prepare(`
    INSERT INTO deck_card_groups (deck_id, name, link_type, note)
    VALUES (?, ?, ?, ?)
  `);
  for (const group of sourceGroups) {
    const memberIds = group.members
      .map((member) => deckCardIdMap.get(member.deckCardId))
      .filter(Boolean);
    if (memberIds.length < 2) continue;
    const groupResult = insertGroup.run(targetDeckId, group.name, group.type, group.note);
    const targetGroupId = Number(groupResult.lastInsertRowid);
    const members = memberIds.map((deckCardId) => ({ deck_card_id: deckCardId }));
    insertMembers(targetGroupId, members);
  }
}
