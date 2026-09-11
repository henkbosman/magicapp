import express from 'express';
import {
  addCollectionItem,
  collectionFilterOptions,
  deleteCollectionItem,
  getCardWithUsage,
  getCollectionItem,
  listCollection,
  updateCollectionItem
} from '../services/card-repository.js';
import { ensureCard } from '../services/card-cache-service.js';
import { booleanValue, oneOf, optionalNumber, optionalString, positiveInteger } from '../lib/validation.js';
import { transaction } from '../db/database.js';
import { addDeckCard } from '../services/deck-service.js';
import { HttpError } from '../lib/http-error.js';
import { exportCollectionCsv, importCollectionCsv } from '../services/import-export-service.js';

export const collectionReadRouter = express.Router();
export const collectionWriteRouter = express.Router();

function collectionInput(body, { allowZero = false } = {}) {
  return {
    quantity: positiveInteger(body.quantity ?? 1, 'Aantal', { allowZero }),
    finish: oneOf(body.finish, ['nonfoil', 'foil', 'etched'], 'Afwerking', 'nonfoil'),
    language: optionalString(body.language, 10, 'en') || 'en',
    condition: oneOf(body.condition, ['mint', 'near_mint', 'excellent', 'good', 'light_played', 'played', 'poor'], 'Conditie', 'near_mint'),
    location: optionalString(body.location, 200),
    notes: optionalString(body.notes, 5000),
    purchasePrice: optionalNumber(body.purchasePrice, 'Aankoopprijs'),
    reconcileWanted: booleanValue(body.reconcileWanted, true),
    sourceWantedId: body.sourceWantedId ? positiveInteger(body.sourceWantedId, 'Wanted-ID') : null
  };
}


const DECK_ROLES = ['commander', 'partner', 'companion', 'main', 'sideboard', 'maybeboard'];

function collectionDeckInput(body) {
  const tags = body.tags ?? [];
  return {
    deckId: positiveInteger(body.deckId, 'Deck-ID'),
    quantity: positiveInteger(body.deckQuantity ?? body.quantity ?? 1, 'Aantal in deck'),
    role: oneOf(body.role, DECK_ROLES, 'Rol', 'main'),
    note: optionalString(body.note, 5000),
    tags: Array.isArray(tags) ? tags : String(tags).split(',').map((tag) => tag.trim())
  };
}

collectionReadRouter.get('/options', (req, res) => res.json({ data: collectionFilterOptions() }));

collectionReadRouter.get('/export.csv', (req, res) => {
  const csv = exportCollectionCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="collection.csv"');
  res.send(`\uFEFF${csv}`);
});

collectionWriteRouter.post('/import.csv', async (req, res) => {
  const result = await importCollectionCsv(req.body?.csv);
  res.status(201).json({ data: result });
});

collectionReadRouter.get('/', (req, res) => {
  res.json({ data: listCollection(req.query) });
});

function addCollectionAndDeck(card, collection, deck) {
  return transaction(() => {
    const collectionItem = addCollectionItem({ cardId: card.id, ...collection });
    const deckCard = addDeckCard(deck.deckId, {
      cardId: card.id,
      quantity: deck.quantity,
      role: deck.role,
      note: deck.note,
      tags: deck.tags
    });
    return {
      collectionItem: getCollectionItem(collectionItem.id),
      deckCard
    };
  });
}

async function createCollection(req, res, { requireDeck = false } = {}) {
  const body = req.body || {};
  const card = await ensureCard(body);
  const collection = collectionInput(body);
  const hasDeck = body.deckId !== undefined && body.deckId !== null && String(body.deckId).trim() !== '';

  if (requireDeck || hasDeck) {
    const deck = collectionDeckInput(body);
    return res.status(201).json({ data: addCollectionAndDeck(card, collection, deck) });
  }

  const item = addCollectionItem({ cardId: card.id, ...collection });
  return res.status(201).json({ data: item });
}

collectionWriteRouter.post('/', (req, res) => createCollection(req, res));

// Backwards-compatible alias. The application itself uses POST /collection
// with deckId so proxies that only allow the established collection route work too.
collectionWriteRouter.post('/with-deck', (req, res) => createCollection(req, res, { requireDeck: true }));

collectionReadRouter.get('/card/:cardId', (req, res) => {
  const card = getCardWithUsage(positiveInteger(req.params.cardId, 'Kaart-ID'));
  const items = listCollection({ cardKey: card.cardKey, limit: 1000 }).items;
  res.json({ data: { card, items } });
});

collectionReadRouter.get('/:id', (req, res) => {
  const item = getCollectionItem(positiveInteger(req.params.id, 'Collectie-ID'));
  if (!item) throw new HttpError(404, 'Collectieregel niet gevonden.');
  res.json({ data: item });
});

collectionWriteRouter.patch('/:id', (req, res) => {
  const id = positiveInteger(req.params.id, 'Collectie-ID');
  const current = getCollectionItem(id);
  if (!current) throw new HttpError(404, 'Collectieregel niet gevonden.');
  const merged = {
    quantity: req.body.quantity ?? current.quantity,
    finish: req.body.finish ?? current.finish,
    language: req.body.language ?? current.language,
    condition: req.body.condition ?? current.condition,
    location: req.body.location ?? current.location,
    notes: req.body.notes ?? current.notes,
    purchasePrice: req.body.purchasePrice !== undefined ? req.body.purchasePrice : current.purchasePrice,
    reconcileWanted: false
  };
  res.json({ data: updateCollectionItem(id, collectionInput(merged, { allowZero: true })) });
});

collectionWriteRouter.delete('/:id', (req, res) => {
  res.json({ data: deleteCollectionItem(positiveInteger(req.params.id, 'Collectie-ID')) });
});
