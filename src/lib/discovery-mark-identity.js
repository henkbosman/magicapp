import { normalizeSearchText } from './card-catalog-features.js';

// Oracle IDs survive catalog imports. Names are only a fallback when an Oracle
// ID is absent; catalog row IDs, source order and printings are never identities.
export function discoveryMarkIdentity({ name, scryfallOracleId } = {}) {
  const normalizedName = normalizeSearchText(name);
  const oracleId = String(scryfallOracleId || '').trim().toLowerCase();
  return {
    markKey: oracleId ? `oracle:${oracleId}` : `name:${normalizedName}`,
    normalizedName,
    scryfallOracleId: oracleId || null
  };
}
