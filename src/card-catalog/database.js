import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { HttpError } from '../lib/http-error.js';

export const CARD_CATALOG_SCHEMA_VERSION = 10000;

const catalogPath = config.cardCatalogDatabasePath;
const previousPath = `${catalogPath}.previous`;
let catalogDb = null;
let catalogOpenError = '';

fs.mkdirSync(config.dataDir, { recursive: true });

function scalar(row) {
  return row ? Object.values(row)[0] : undefined;
}

function safeClose(database) {
  if (!database) return;
  try {
    database.close();
  } catch {
    // Best effort: the process can still replace/recover the immutable file.
  }
}

function syncDirectory(directory) {
  try {
    const descriptor = fs.openSync(directory, 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    // Directory fsync is not available on every supported platform.
  }
}

function openReadOnly(filePath, { integrity = false } = {}) {
  const database = new DatabaseSync(filePath, { readOnly: true, timeout: 5000 });
  try {
    database.exec(`
      PRAGMA query_only = ON;
      PRAGMA trusted_schema = OFF;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
    const schemaVersion = Number(scalar(database.prepare('PRAGMA user_version').get()) || 0);
    if (schemaVersion !== CARD_CATALOG_SCHEMA_VERSION) {
      throw new Error(`Niet-ondersteunde catalogusschemaversie ${schemaVersion}.`);
    }

    const requiredTables = new Set([
      'catalog_meta',
      'cards',
      'cards_fts',
      'card_keywords',
      'card_abilities',
      'card_types',
      'card_subtypes',
      'card_supertypes',
      'card_printings',
      'card_legalities',
      'card_effects',
      'card_tokens',
      'card_tutor_targets'
    ]);
    for (const row of database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
      requiredTables.delete(row.name);
    }
    if (requiredTables.size) {
      throw new Error(`Catalogustabellen ontbreken: ${[...requiredTables].join(', ')}.`);
    }

    const count = Number(database.prepare('SELECT COUNT(*) AS count FROM cards').get().count || 0);
    if (count < 1) throw new Error('De kaartcatalogus bevat geen kaarten.');

    if (integrity) {
      const quickCheck = String(scalar(database.prepare('PRAGMA quick_check(1)').get()) || '');
      if (quickCheck !== 'ok') throw new Error(`Integriteitscontrole mislukt: ${quickCheck || 'onbekend'}.`);
      const foreignKeyIssue = database.prepare('PRAGMA foreign_key_check').get();
      if (foreignKeyIssue) throw new Error('De kaartcatalogus bevat ongeldige interne relaties.');
    }
    return database;
  } catch (error) {
    safeClose(database);
    throw error;
  }
}

function recoverPreviousCatalog() {
  if (!fs.existsSync(previousPath)) return false;
  let previous = null;
  try {
    previous = openReadOnly(previousPath, { integrity: true });
    safeClose(previous);
    previous = null;
    if (fs.existsSync(catalogPath)) {
      const corruptPath = `${catalogPath}.corrupt-${Date.now()}`;
      fs.renameSync(catalogPath, corruptPath);
    }
    fs.renameSync(previousPath, catalogPath);
    syncDirectory(path.dirname(catalogPath));
    return true;
  } catch (error) {
    safeClose(previous);
    catalogOpenError = `Herstelbestand kon niet worden geopend: ${error.message}`;
    return false;
  }
}

function initializeCatalogConnection() {
  if (!fs.existsSync(catalogPath) && fs.existsSync(previousPath)) recoverPreviousCatalog();
  if (!fs.existsSync(catalogPath)) return;

  try {
    catalogDb = openReadOnly(catalogPath, { integrity: true });
    catalogOpenError = '';
  } catch (error) {
    catalogOpenError = error.message;
    if (recoverPreviousCatalog()) {
      try {
        catalogDb = openReadOnly(catalogPath, { integrity: true });
        catalogOpenError = '';
      } catch (recoveryError) {
        catalogOpenError = recoveryError.message;
      }
    }
  }
}

initializeCatalogConnection();

export function withCardCatalog(work) {
  if (!catalogDb) {
    throw new HttpError(503, 'De MTGJSON-kaartcatalogus is nog niet beschikbaar. Importeer AtomicCards via Onderhoud.');
  }
  return work(catalogDb);
}

export function cardCatalogStatus() {
  if (!catalogDb) {
    return {
      available: false,
      databaseFile: path.basename(catalogPath),
      databaseSizeBytes: fs.existsSync(catalogPath) ? fs.statSync(catalogPath).size : 0,
      cardCount: 0,
      sourceVersion: '',
      sourceDate: '',
      importedAt: '',
      error: catalogOpenError || undefined
    };
  }

  try {
    const metadata = Object.fromEntries(
      catalogDb.prepare('SELECT key, value FROM catalog_meta').all().map((row) => [row.key, row.value])
    );
    return {
      available: true,
      databaseFile: path.basename(catalogPath),
      databaseSizeBytes: fs.statSync(catalogPath).size,
      cardCount: Number(metadata.card_count || catalogDb.prepare('SELECT COUNT(*) AS count FROM cards').get().count || 0),
      sourceVersion: metadata.source_version || '',
      sourceDate: metadata.source_date || '',
      importedAt: metadata.imported_at || ''
    };
  } catch (error) {
    catalogOpenError = error.message;
    return {
      available: false,
      databaseFile: path.basename(catalogPath),
      databaseSizeBytes: fs.existsSync(catalogPath) ? fs.statSync(catalogPath).size : 0,
      cardCount: 0,
      sourceVersion: '',
      sourceDate: '',
      importedAt: '',
      error: 'De kaartcatalogus kon niet worden gelezen.'
    };
  }
}

export function validateCardCatalogFile(filePath, { integrity = true } = {}) {
  const database = openReadOnly(filePath, { integrity });
  try {
    const count = Number(database.prepare('SELECT COUNT(*) AS count FROM cards').get().count || 0);
    const metadata = Object.fromEntries(
      database.prepare('SELECT key, value FROM catalog_meta').all().map((row) => [row.key, row.value])
    );
    if (!metadata.source_version || !metadata.source_date || !metadata.imported_at) {
      throw new Error('De kaartcatalogus bevat geen volledige bronmetadata.');
    }
    return { count, metadata };
  } finally {
    safeClose(database);
  }
}

export function activateCardCatalog(filePath) {
  const candidatePath = path.resolve(filePath);
  if (path.dirname(candidatePath) !== path.dirname(path.resolve(catalogPath))) {
    throw new Error('De tijdelijke catalogus moet in dezelfde directory staan als de actieve catalogus.');
  }
  // The worker already performs quick_check and foreign_key_check after the
  // build. Keep the main-thread swap validation intentionally lightweight.
  const validation = validateCardCatalogFile(candidatePath, { integrity: false });

  safeClose(catalogDb);
  catalogDb = null;
  const hadCurrent = fs.existsSync(catalogPath);
  let currentMoved = false;
  let candidateMoved = false;

  try {
    if (fs.existsSync(previousPath)) fs.rmSync(previousPath, { force: true });
    if (hadCurrent) {
      fs.renameSync(catalogPath, previousPath);
      currentMoved = true;
    }
    fs.renameSync(candidatePath, catalogPath);
    candidateMoved = true;
    syncDirectory(path.dirname(catalogPath));
    catalogDb = openReadOnly(catalogPath);
    catalogOpenError = '';
    syncDirectory(path.dirname(catalogPath));
    return validation;
  } catch (error) {
    safeClose(catalogDb);
    catalogDb = null;
    try {
      if (candidateMoved && fs.existsSync(catalogPath)) fs.rmSync(catalogPath, { force: true });
      if (currentMoved && fs.existsSync(previousPath)) fs.renameSync(previousPath, catalogPath);
      if (fs.existsSync(catalogPath)) {
        catalogDb = openReadOnly(catalogPath);
        catalogOpenError = '';
      } else {
        catalogOpenError = 'Na een mislukte activatie is geen eerdere kaartcatalogus beschikbaar.';
      }
    } catch (recoveryError) {
      catalogOpenError = `Activeren en herstellen mislukt: ${recoveryError.message}`;
    }
    throw error;
  }
}

export function closeCardCatalogDatabase() {
  safeClose(catalogDb);
  catalogDb = null;
}
