import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data'));
const packageMetadata = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const applicationVersion = String(packageMetadata.version || '2.0.0');
const databasePath = path.join(dataDir, process.env.DATABASE_FILE || 'magic-collection.sqlite');

function cardCatalogFilename(value) {
  const filename = String(value || 'mtgjson-atomic.sqlite').trim();
  if (
    !filename
    || filename === '.'
    || filename === '..'
    || filename.includes('/')
    || filename.includes('\\')
    || path.basename(filename) !== filename
  ) {
    throw new Error('CARD_CATALOG_DATABASE_FILE moet een bestandsnaam binnen DATA_DIR zijn.');
  }
  return filename;
}

const cardCatalogDatabasePath = path.join(dataDir, cardCatalogFilename(process.env.CARD_CATALOG_DATABASE_FILE));

const mainDatabaseFiles = new Set([
  databasePath,
  `${databasePath}-wal`,
  `${databasePath}-shm`,
  `${databasePath}-journal`
].map((filePath) => path.resolve(filePath)));
const cardCatalogFiles = [
  cardCatalogDatabasePath,
  `${cardCatalogDatabasePath}-wal`,
  `${cardCatalogDatabasePath}-shm`,
  `${cardCatalogDatabasePath}-journal`,
  `${cardCatalogDatabasePath}.previous`,
  `${cardCatalogDatabasePath}.previous-wal`,
  `${cardCatalogDatabasePath}.previous-shm`,
  `${cardCatalogDatabasePath}.previous-journal`
].map((filePath) => path.resolve(filePath));

if (cardCatalogFiles.some((filePath) => mainDatabaseFiles.has(filePath))) {
  throw new Error('CARD_CATALOG_DATABASE_FILE en DATABASE_FILE mogen niet met elkaars SQLite-bestanden botsen.');
}

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

function publicOrigin(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('invalid origin');
    }
    return url.origin;
  } catch {
    throw new Error('PUBLIC_ORIGIN moet een volledige http(s)-origin zijn, bijvoorbeeld https://cards.example.nl');
  }
}

export const config = Object.freeze({
  applicationVersion,
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir,
  databasePath,
  cardCatalogDatabasePath,
  imageCacheDir: path.join(dataDir, 'images'),
  port: positiveInteger(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  publicOrigin: publicOrigin(process.env.PUBLIC_ORIGIN),
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
