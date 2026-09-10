import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import { config } from '../config.js';
import { db } from '../db/database.js';
import { positiveInteger } from '../lib/validation.js';
import { getCardById, upsertScryfallCard } from '../services/card-repository.js';
import { clearExternalApiCache, externalApiCacheStats } from '../services/external-api-cache-service.js';
import { clearPrintingCatalog, printingCatalogStats } from '../services/printing-catalog-service.js';
import { scryfallService } from '../services/scryfall-service.js';

export const maintenanceReadRouter = express.Router();
export const maintenanceWriteRouter = express.Router();

maintenanceReadRouter.get('/status', (req, res) => {
  const stat = fs.existsSync(config.databasePath) ? fs.statSync(config.databasePath) : null;
  const quickCheck = db.prepare('PRAGMA quick_check').get();
  const foreignKeyIssues = db.prepare('PRAGMA foreign_key_check').all();
  res.json({
    data: {
      applicationVersion: config.applicationVersion,
      nodeVersion: process.version,
      databaseFile: path.basename(config.databasePath),
      databaseSizeBytes: stat?.size || 0,
      imageCacheEnabled: config.cacheImages,
      cachedImages: fs.existsSync(config.imageCacheDir)
        ? fs.readdirSync(config.imageCacheDir).filter((name) => !name.startsWith('.')).length
        : 0,
      externalApiCache: externalApiCacheStats(),
      printingCatalog: printingCatalogStats(),
      databaseIntegrity: quickCheck?.quick_check || Object.values(quickCheck || {})[0] || 'onbekend',
      foreignKeyIssues: foreignKeyIssues.length,
      schemaVersion: Number(Object.values(db.prepare('PRAGMA user_version').get() || { value: 0 })[0] || 0),
      counts: {
        cards: Number(db.prepare('SELECT COUNT(*) AS count FROM cards').get().count),
        collectionItems: Number(db.prepare('SELECT COUNT(*) AS count FROM collection_items').get().count),
        decks: Number(db.prepare('SELECT COUNT(*) AS count FROM decks').get().count),
        wantedItems: Number(db.prepare('SELECT COUNT(*) AS count FROM wanted_items').get().count)
      }
    }
  });
});

maintenanceWriteRouter.post('/refresh-cards', async (req, res) => {
  const staleDays = req.body?.staleDays === undefined ? 0 : positiveInteger(req.body.staleDays, 'Aantal dagen', { allowZero: true });
  const limit = req.body?.limit ? Math.min(positiveInteger(req.body.limit, 'Limiet'), 5000) : 5000;
  const where = staleDays > 0 ? "WHERE datetime(updated_at) <= datetime('now', ?)" : '';
  const params = staleDays > 0 ? [`-${staleDays} days`, limit] : [limit];
  const rows = db.prepare(`SELECT id, scryfall_id, name FROM cards ${where} ORDER BY updated_at ASC LIMIT ?`).all(...params);
  const refreshed = [];
  const failed = [];
  for (const row of rows) {
    try {
      const card = upsertScryfallCard(await scryfallService.getById(row.scryfall_id, { force: true }));
      refreshed.push({ id: card.id, name: card.name });
    } catch (error) {
      failed.push({ id: Number(row.id), name: row.name, error: error.message });
      if (error.status === 429) break;
    }
  }
  res.json({ data: { requested: rows.length, refreshed, failed } });
});

maintenanceWriteRouter.post('/refresh-card/:id', async (req, res) => {
  const local = getCardById(positiveInteger(req.params.id, 'Kaart-ID'));
  if (!local) return res.status(404).json({ error: { message: 'Kaart niet gevonden.' } });
  const updated = upsertScryfallCard(await scryfallService.getById(local.scryfallId, { force: true }));
  res.json({ data: updated });
});


maintenanceWriteRouter.post('/external-cache/clear', (req, res) => {
  const removed = clearExternalApiCache('scryfall');
  const printingCatalog = clearPrintingCatalog();
  res.json({
    data: {
      removed,
      printingCatalogRemoved: printingCatalog,
      cache: externalApiCacheStats(),
      printingCatalog: printingCatalogStats()
    }
  });
});

maintenanceWriteRouter.post('/backup', (req, res) => {
  fs.mkdirSync(path.join(config.dataDir, 'backups'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(config.dataDir, 'backups', `magic-collection-${stamp}.sqlite`);
  const escaped = backupPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  res.download(backupPath, path.basename(backupPath), (error) => {
    if (error) console.error('[backup]', error);
    fs.rm(backupPath, { force: true }, () => {});
  });
});
