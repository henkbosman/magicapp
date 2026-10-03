import { HttpError } from './http-error.js';

// Keep API validation shared between the primary-database context and the
// independent catalog repository. Saved links may still use excludeDeckId;
// both parameters now select deck membership only, never exclude cards.
export function discoverySelectedDeckId(input = {}) {
  const value = Object.hasOwn(input, 'deckId') ? input.deckId : input.excludeDeckId;
  if (value === undefined || value === null || value === '') return null;
  if (!['number', 'string'].includes(typeof value)) {
    throw new HttpError(400, 'Het geselecteerde deck moet een geldig positief deck-ID hebben.');
  }
  const text = String(value).trim();
  if (!text) return null;
  const id = Number(text);
  if (!/^\d+$/u.test(text) || !Number.isSafeInteger(id) || id < 1) {
    throw new HttpError(400, 'Het geselecteerde deck moet een geldig positief deck-ID hebben.');
  }
  return id;
}
