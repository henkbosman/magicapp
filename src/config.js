import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data'));
const packageMetadata = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const applicationVersion = String(packageMetadata.version || '2.0.0');

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hoursToMs(value, fallbackHours) {
  const parsed = Number.parseFloat(value ?? '');
  const hours = Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackHours;
  return Math.round(hours * 60 * 60 * 1000);
}

export const config = Object.freeze({
  applicationVersion,
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir,
  databasePath: path.join(dataDir, process.env.DATABASE_FILE || 'magic-collection.sqlite'),
  imageCacheDir: path.join(dataDir, 'images'),
  port: positiveInteger(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  scryfallUserAgent:
    process.env.SCRYFALL_USER_AGENT || `MagicCollectionManager/${applicationVersion} (local personal app)`,
  scryfallTimeoutMs: positiveInteger(process.env.SCRYFALL_TIMEOUT_MS, 15000),
  scryfallRequestDelayMs: nonNegativeInteger(process.env.SCRYFALL_REQUEST_DELAY_MS, 550),
  scryfallAutocompleteCacheTtlMs: hoursToMs(process.env.SCRYFALL_AUTOCOMPLETE_CACHE_TTL_HOURS, 168),
  scryfallPrintingsCacheTtlMs: hoursToMs(process.env.SCRYFALL_PRINTINGS_CACHE_TTL_HOURS, 12),
  scryfallPrintingCatalogTtlMs: hoursToMs(process.env.SCRYFALL_PRINTING_CATALOG_TTL_HOURS, 168),
  scryfallCardCacheTtlMs: hoursToMs(process.env.SCRYFALL_CARD_CACHE_TTL_HOURS, 168),
  cacheImages: String(process.env.CACHE_IMAGES || 'true').toLowerCase() === 'true',
  logLevel: process.env.LOG_LEVEL || 'info'
});
