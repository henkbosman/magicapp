import { HttpError } from './http-error.js';

// Keep API validation shared between the primary-database context and the
// independent catalog repository. An empty selection means no exclusion.
export function discoveryExcludedDeckId(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!['number', 'string'].includes(typeof value)) {
    throw new HttpError(400, 'Het uit te sluiten deck moet een geldig positief deck-ID hebben.');
  }
  const text = String(value).trim();
  if (!text) return null;
  const id = Number(text);
  if (!/^\d+$/u.test(text) || !Number.isSafeInteger(id) || id < 1) {
    throw new HttpError(400, 'Het uit te sluiten deck moet een geldig positief deck-ID hebben.');
  }
  return id;
}
