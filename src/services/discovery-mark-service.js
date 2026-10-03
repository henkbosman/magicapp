import { db, transaction } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';
import { discoveryMarkIdentity } from '../lib/discovery-mark-identity.js';

function markInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Geef de kaart en markering op.');
  }
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 300) {
    throw new HttpError(400, 'Geef een kaartnaam van maximaal 300 tekens op.');
  }
  if (typeof input.marked !== 'boolean') {
    throw new HttpError(400, 'Gemarkeerd moet true of false zijn.');
  }
  const name = input.name.trim();
  const rawOracleId = input.scryfallOracleId;
  if (rawOracleId !== undefined && rawOracleId !== null && rawOracleId !== '' && (
    typeof rawOracleId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(rawOracleId.trim())
  )) {
    throw new HttpError(400, 'Geef een geldig Scryfall Oracle-ID op.');
  }
  const identity = discoveryMarkIdentity({ name, scryfallOracleId: rawOracleId });
  if (!identity.normalizedName) throw new HttpError(400, 'Geef een geldige kaartnaam op.');
  return { ...identity, name, marked: input.marked };
}

function markResult(row) {
  return {
    markKey: row.mark_key,
    name: row.name,
    scryfallOracleId: row.oracle_id,
    marked: true
  };
}

export function listDiscoveryMarks() {
  return db.prepare(`
    SELECT mark_key, name, oracle_id FROM discovery_marks
    ORDER BY name COLLATE NOCASE, mark_key
  `).all().map(markResult);
}

export function discoveryMarkContext() {
  return { marks: listDiscoveryMarks() };
}

export function setDiscoveryMark(input) {
  const mark = markInput(input);
  return transaction(() => {
    // A fallback can be promoted when a later catalog includes an Oracle ID.
    // Never merge two different known Oracle identities just by their names.
    const matching = db.prepare(`
      SELECT mark_key, oracle_id FROM discovery_marks
      WHERE mark_key = ? OR (normalized_name = ? AND (oracle_id IS NULL OR ? IS NULL))
    `).all(mark.markKey, mark.normalizedName, mark.scryfallOracleId);
    if (!mark.marked) {
      // Without an Oracle ID the current catalog cannot distinguish namesakes;
      // remove every stored alias that makes this name-only card appear marked.
      // With an ID, a different known Oracle identity is always preserved.
      const remove = db.prepare('DELETE FROM discovery_marks WHERE mark_key = ?');
      for (const row of matching) remove.run(row.mark_key);
    } else {
      const remove = db.prepare('DELETE FROM discovery_marks WHERE mark_key = ?');
      for (const row of matching) {
        // Only an explicit Oracle identity may promote a name-only fallback.
        // A name-only request must never merge or remove known identities.
        if (mark.scryfallOracleId && row.mark_key !== mark.markKey && !row.oracle_id) remove.run(row.mark_key);
      }
      db.prepare(`
        INSERT INTO discovery_marks (mark_key, oracle_id, name, normalized_name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(mark_key) DO UPDATE SET
          name = excluded.name,
          normalized_name = excluded.normalized_name,
          updated_at = CURRENT_TIMESTAMP
      `).run(mark.markKey, mark.scryfallOracleId, mark.name, mark.normalizedName);
    }
    return {
      markKey: mark.markKey,
      name: mark.name,
      scryfallOracleId: mark.scryfallOracleId,
      marked: mark.marked
    };
  });
}
