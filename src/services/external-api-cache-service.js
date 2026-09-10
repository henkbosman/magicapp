import { db } from '../db/database.js';

function parsePayload(row) {
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json);
  } catch (error) {
    console.warn('[external-api-cache] Ongeldige cache-inhoud verwijderd:', row.cache_key, error.message);
    db.prepare('DELETE FROM external_api_cache WHERE cache_key = ?').run(row.cache_key);
    return null;
  }
}

export function getExternalApiCache(cacheKey, { allowStale = false } = {}) {
  const row = db.prepare(`
    SELECT cache_key, service, payload_json, expires_at, created_at, updated_at, last_accessed_at
    FROM external_api_cache
    WHERE cache_key = ?
  `).get(cacheKey);
  if (!row) return null;

  const value = parsePayload(row);
  if (value === null) return null;

  const fresh = Number(row.expires_at) > Date.now();
  if (!fresh && !allowStale) return null;

  db.prepare(`
    UPDATE external_api_cache
    SET last_accessed_at = CURRENT_TIMESTAMP
    WHERE cache_key = ?
  `).run(cacheKey);

  return {
    key: row.cache_key,
    service: row.service,
    value,
    fresh,
    expiresAt: Number(row.expires_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at
  };
}

export function setExternalApiCache(cacheKey, service, value, ttlMs) {
  const expiresAt = Date.now() + Math.max(Number(ttlMs || 0), 1000);
  db.prepare(`
    INSERT INTO external_api_cache
      (cache_key, service, payload_json, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      service = excluded.service,
      payload_json = excluded.payload_json,
      expires_at = excluded.expires_at,
      updated_at = CURRENT_TIMESTAMP,
      last_accessed_at = CURRENT_TIMESTAMP
  `).run(cacheKey, service, JSON.stringify(value), expiresAt);
  return { cacheKey, expiresAt };
}


export function clearExternalApiCache(service = '') {
  const result = service
    ? db.prepare('DELETE FROM external_api_cache WHERE service = ?').run(service)
    : db.prepare('DELETE FROM external_api_cache').run();
  return Number(result.changes || 0);
}

export function externalApiCacheStats() {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS entries,
      SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END) AS fresh_entries,
      SUM(CASE WHEN expires_at <= ? THEN 1 ELSE 0 END) AS stale_entries,
      COALESCE(SUM(LENGTH(payload_json)), 0) AS payload_bytes
    FROM external_api_cache
  `).get(Date.now(), Date.now());
  return {
    entries: Number(row.entries || 0),
    freshEntries: Number(row.fresh_entries || 0),
    staleEntries: Number(row.stale_entries || 0),
    payloadBytes: Number(row.payload_bytes || 0)
  };
}
