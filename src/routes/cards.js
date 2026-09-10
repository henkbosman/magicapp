import express from 'express';
import { db } from '../db/database.js';
import { assert } from '../lib/http-error.js';
import { normalizeSearchText } from '../lib/text.js';
import { positiveInteger, requiredString } from '../lib/validation.js';
import {
  getCardByScryfallId,
  getCardWithUsage,
  searchCards,
  upsertScryfallCard
} from '../services/card-repository.js';
import { ensureCard } from '../services/card-cache-service.js';
import { scryfallService } from '../services/scryfall-service.js';
import { loadGroupedPrintingsByName } from '../services/printing-catalog-service.js';
import { serveScryfallImage } from '../services/image-cache-service.js';
import { updateCardUserMetadata } from '../services/card-insight-service.js';

export const cardsReadRouter = express.Router();
export const cardsWriteRouter = express.Router();

cardsReadRouter.get('/search', (req, res) => {
  const query = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
  res.json({ data: searchCards(query, limit) });
});

cardsReadRouter.get('/autocomplete', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) return res.json({ data: [], offline: false });
  const normalized = normalizeSearchText(query);
  const local = db.prepare(`
    SELECT DISTINCT name FROM cards WHERE search_name LIKE ?
    ORDER BY CASE WHEN search_name LIKE ? THEN 0 ELSE 1 END, name COLLATE NOCASE LIMIT 20
  `).all(`%${normalized}%`, `${normalized}%`).map((row) => row.name);

  try {
    const remote = await scryfallService.autocomplete(query);
    res.json({ data: [...new Set([...local, ...remote])].slice(0, 20), offline: false });
  } catch (error) {
    if (local.length) {
      return res.json({ data: local, offline: true, warning: error.message });
    }
    throw error;
  }
});

cardsReadRouter.get('/printings', async (req, res) => {
  const name = requiredString(req.query.name, 'Kaartnaam', 300);
  const result = await loadGroupedPrintingsByName(name);
  res.json(result);
});

cardsReadRouter.get('/image-cache', async (req, res) => {
  const url = requiredString(req.query.url, 'Afbeeldings-URL', 2000);
  await serveScryfallImage(res, url);
});

cardsReadRouter.get('/preview/:scryfallId', async (req, res) => {
  const scryfallId = requiredString(req.params.scryfallId, 'Scryfall-ID', 100);
  let card = getCardByScryfallId(scryfallId);
  if (!card) {
    card = upsertScryfallCard(await scryfallService.getById(scryfallId));
  }
  res.json({ data: getCardWithUsage(card.id) });
});


cardsReadRouter.get('/:id/image', async (req, res) => {
  const card = getCardWithUsage(positiveInteger(req.params.id, 'Kaart-ID'));
  const face = req.query.face === 'back' ? 'back' : 'front';
  const size = ['small', 'normal', 'large', 'png'].includes(req.query.size) ? req.query.size : 'normal';
  const key = face === 'back' ? `back${size[0].toUpperCase()}${size.slice(1)}` : size;
  const url = card.images[key] || (face === 'front' ? card.images.normal : card.images.backNormal);
  assert(url, 404, 'Voor deze kaartzijde is geen afbeelding beschikbaar.');

  const extension = size === 'png' || new URL(url).pathname.endsWith('.png') ? 'png' : 'jpg';
  const preferredName = `${card.scryfallId}-${face}-${size}.${extension}`;
  await serveScryfallImage(res, url, { preferredName });
});

cardsReadRouter.get('/:id', (req, res) => {
  res.json({ data: getCardWithUsage(positiveInteger(req.params.id, 'Kaart-ID')) });
});

cardsWriteRouter.post('/cache', async (req, res) => {
  const card = await ensureCard(req.body || {});
  res.status(201).json({ data: getCardWithUsage(card.id) });
});

cardsWriteRouter.patch('/:id/metadata', (req, res) => {
  const cardId = positiveInteger(req.params.id, 'Kaart-ID');
  res.json({ data: updateCardUserMetadata(cardId, req.body || {}) });
});

cardsWriteRouter.post('/:id/refresh', async (req, res) => {
  const card = getCardWithUsage(positiveInteger(req.params.id, 'Kaart-ID'));
  const refreshed = upsertScryfallCard(await scryfallService.getById(card.scryfallId, { force: true }));
  res.json({ data: getCardWithUsage(refreshed.id) });
});
