import { HttpError } from './http-error.js';

export function positiveInteger(value, field = 'waarde', { allowZero = false } = {}) {
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new HttpError(400, `${field} moet een geheel getal van minimaal ${minimum} zijn.`);
  }
  return parsed;
}


export function optionalNumber(value, field, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, `${field} moet een geldig getal zijn.`);
  return parsed;
}

export function requiredString(value, field, maxLength = 500) {
  const result = String(value ?? '').trim();
  if (!result) throw new HttpError(400, `${field} is verplicht.`);
  if (result.length > maxLength) throw new HttpError(400, `${field} is te lang.`);
  return result;
}

export function optionalString(value, maxLength = 5000, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const result = String(value).trim();
  if (result.length > maxLength) throw new HttpError(400, 'Een tekstveld is te lang.');
  return result;
}

export function oneOf(value, allowed, field, fallback) {
  const result = value === undefined || value === null || value === '' ? fallback : String(value);
  if (!allowed.includes(result)) {
    throw new HttpError(400, `${field} heeft een ongeldige waarde.`);
  }
  return result;
}

export function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'ja', 'on'].includes(String(value).toLowerCase());
}
