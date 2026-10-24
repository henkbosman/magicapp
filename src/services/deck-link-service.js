import { db, transaction } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';
import { oneOf, optionalString, positiveInteger, requiredString } from '../lib/validation.js';

function requireDeckRow(deckId) {
  deckId = positiveInteger(deckId, 'Deck-ID');
  const deck = db.prepare('SELECT id, name FROM decks WHERE id = ?').get(deckId);
  if (!deck) throw new HttpError(404, 'Deck niet gevonden.');
  return deck;
}

function normalizeDeckCardIds(values, type) {
  if (!Array.isArray(values)) throw new HttpError(400, 'Deckkaart-ID’s moeten als lijst worden aangeleverd.');
  const ids = [...new Set(values.map((value) => positiveInteger(value, 'Deckkaart-ID')))];
  if (type === 'combo' && ids.length < 2) throw new HttpError(400, 'Een combo moet minimaal twee kaarten bevatten.');
  return ids;
}

function requireDeckCardRows(deckId, values, type) {
  const ids = normalizeDeckCardIds(values, type);
  if (!ids.length) return [];
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

function linkInput(input, current = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Geef de eigenschappen van de combo of synergie als object op.');
  }
  let rawIds = input.deckCardIds;
  if (rawIds === undefined && (input.firstDeckCardId !== undefined || input.secondDeckCardId !== undefined)) {
    rawIds = [input.firstDeckCardId, input.secondDeckCardId];
  }
  const replaceMembers = rawIds !== undefined;
  if (!replaceMembers) rawIds = (current.members || []).map((member) => member.deckCardId);
  const type = oneOf(input.type ?? current.type, ['synergy', 'combo'], 'Koppelingstype', 'synergy');
  return {
    name: requiredString(input.name ?? current.name, 'Naam van combo of synergie', 200),
    type,
    note: optionalString(input.note ?? current.note, 2000),
    deckCardIds: normalizeDeckCardIds(rawIds, type),
    replaceMembers
  };
}

function requireUniqueSynergyName(deckId, input, current = null) {
  if (input.type !== 'synergy') return;
  const key = (value) => value.trim().normalize('NFC').toLocaleLowerCase('nl');
  // Historical groups with duplicate names remain editable; a metadata-only
  // update must not retroactively invalidate an unchanged group identity.
  if (current?.type === 'synergy' && key(current.name) === key(input.name)) return;
  const conflict = db.prepare("SELECT id, name FROM deck_card_groups WHERE deck_id = ? AND link_type = 'synergy'")
    .all(deckId).some((row) => Number(row.id) !== current?.id && key(row.name) === key(input.name));
  if (conflict) throw new HttpError(409, 'Deze synergie bestaat al in dit deck.');
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
  linkId = positiveInteger(linkId, 'Koppeling-ID');
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
  return transaction(() => {
    requireDeckRow(deckId);
    const checked = linkInput(input);
    const members = requireDeckCardRows(deckId, checked.deckCardIds, checked.type);
    requireUniqueSynergyName(deckId, checked);
    const result = db.prepare(`
      INSERT INTO deck_card_groups (deck_id, name, link_type, note)
      VALUES (?, ?, ?, ?)
    `).run(deckId, checked.name, checked.type, checked.note);
    const groupId = Number(result.lastInsertRowid);
    insertMembers(groupId, members);
    return getDeckCardLink(deckId, groupId);
  });
}

export function updateDeckCardLink(deckId, linkId, input) {
  return transaction(() => {
    const current = getDeckCardLink(deckId, linkId);
    if (!current) throw new HttpError(404, 'Combo of synergie niet gevonden.');
    const checked = linkInput(input, current);
    const members = requireDeckCardRows(deckId, checked.deckCardIds, checked.type);
    requireUniqueSynergyName(deckId, checked, current);
    db.prepare(`
      UPDATE deck_card_groups
      SET name = ?, link_type = ?, note = ?
      WHERE id = ? AND deck_id = ?
    `).run(checked.name, checked.type, checked.note, linkId, deckId);
    if (checked.replaceMembers) {
      db.prepare('DELETE FROM deck_card_group_members WHERE group_id = ?').run(linkId);
      insertMembers(linkId, members);
    }
    return getDeckCardLink(deckId, linkId);
  });
}

export function deleteDeckCardLink(deckId, linkId) {
  return transaction(() => {
    const current = getDeckCardLink(deckId, linkId);
    if (!current) throw new HttpError(404, 'Combo of synergie niet gevonden.');
    db.prepare('DELETE FROM deck_card_groups WHERE id = ? AND deck_id = ?').run(linkId, deckId);
    return current;
  });
}

export function setDeckCardSynergies(deckId, deckCardId, values) {
  return transaction(() => {
    requireDeckRow(deckId);
    deckCardId = positiveInteger(deckCardId, 'Deckkaart-ID');
    if (!db.prepare('SELECT id FROM deck_cards WHERE id = ? AND deck_id = ?').get(deckCardId, deckId)) {
      throw new HttpError(404, 'Kaartregel in deck niet gevonden.');
    }
    if (!Array.isArray(values)) throw new HttpError(400, 'Synergie-ID’s moeten als lijst worden aangeleverd.');
    const selectedIds = [...new Set(values.map((value) => positiveInteger(value, 'Synergie-ID')))];
    const groups = listDeckCardLinks(deckId).filter((group) => group.type === 'synergy');
    const availableIds = new Set(groups.map((group) => group.id));
    if (selectedIds.some((id) => !availableIds.has(id))) {
      throw new HttpError(409, 'Een gekozen synergie bestaat niet meer in dit deck. Laad de synergieën opnieuw.');
    }
    const selected = new Set(selectedIds);
    const remove = db.prepare('DELETE FROM deck_card_group_members WHERE group_id = ? AND deck_card_id = ?');
    const add = db.prepare(`INSERT INTO deck_card_group_members (group_id, deck_card_id, position)
      SELECT ?, ?, COALESCE(MAX(position), -1) + 1 FROM deck_card_group_members WHERE group_id = ?`);
    for (const group of groups) {
      const assigned = group.members.some((member) => member.deckCardId === deckCardId);
      if (assigned && !selected.has(group.id)) remove.run(group.id, deckCardId);
      else if (!assigned && selected.has(group.id)) add.run(group.id, deckCardId, group.id);
    }
    return listDeckCardLinks(deckId).filter((group) => selected.has(group.id));
  });
}

export function cleanupDeckCardLinkGroups(deckId) {
  return Number(db.prepare(`
    DELETE FROM deck_card_groups
    WHERE deck_id = ? AND link_type = 'combo'
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
  // Merging two members can leave their combo with fewer than two cards.
  // Only those affected groups belong to this operation: an acquisition must
  // not delete unrelated historical groups elsewhere in the same deck.
  const removeCollapsedGroup = db.prepare(`
    DELETE FROM deck_card_groups
    WHERE deck_id = ? AND id = ? AND link_type = 'combo'
      AND (SELECT COUNT(*) FROM deck_card_group_members m WHERE m.group_id = deck_card_groups.id) < 2
  `);
  for (const membership of memberships) {
    removeCollapsedGroup.run(deckId, membership.group_id);
  }
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
    if (group.type === 'combo' && memberIds.length < 2) continue;
    const groupResult = insertGroup.run(targetDeckId, group.name, group.type, group.note);
    const targetGroupId = Number(groupResult.lastInsertRowid);
    const members = memberIds.map((deckCardId) => ({ deck_card_id: deckCardId }));
    insertMembers(targetGroupId, members);
  }
}
