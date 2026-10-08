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
import {
  exportCollectionCsv,
  importCollectionList,
  previewCollectionImport
} from '../services/import-export-service.js';

export const collectionReadRouter = express.Router();
export const collectionWriteRouter = express.Router();

function collectionInput(body, { allowZero = false } = {}) {
  return {
    quantity: positiveInteger(body.quantity ?? 1, 'Aantal', { allowZero }),
    finish: oneOf(body.finish, ['nonfoil', 'foil', 'etched'], 'Afwerking', 'nonfoil'),
    language: (optionalString(body.language, 10, 'en') || 'en').toLowerCase(),
    condition: oneOf(body.condition, ['mint', 'near_mint', 'excellent', 'good', 'light_played', 'played', 'poor'], 'Conditie', 'near_mint'),
    location: optionalString(body.location, 200),
    notes: optionalString(body.notes, 5000),
    purchasePrice: optionalNumber(body.purchasePrice, 'Aankoopprijs'),
    reconcileWanted: booleanValue(body.reconcileWanted, true),
    sourceWantedId: body.sourceWantedId ? positiveInteger(body.sourceWantedId, 'Wanted-ID') : null
  };
}

function collectionImportInput(body) {
  return {
    finish: oneOf(body.finish, ['nonfoil', 'foil', 'etched'], 'Afwerking', 'nonfoil'),
    language: (optionalString(body.language, 10, 'en') || 'en').toLowerCase(),
    condition: oneOf(body.condition, ['mint', 'near_mint', 'excellent', 'good', 'light_played', 'played', 'poor'], 'Conditie', 'near_mint'),
    location: optionalString(body.location, 200),
    notes: optionalString(body.notes, 5000),
    reconcileWanted: booleanValue(body.reconcileWanted, true)
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
  const hasDeck = body.deckId !== undefined && body.deckId !== null && String(body.deckId).trim() !== '';
  const deck = requireDeck || hasDeck ? collectionDeckInput(body) : null;
  const collection = collectionInput(body);
  const card = await ensureCard(body);

  if (deck) {
    const result = addCollectionAndDeck(card, collection, deck);
    if (!result.collectionItem?.id || !result.deckCard?.id) {
      throw new HttpError(500, 'De gecombineerde collectie- en decktoevoeging kon niet worden bevestigd.');
    }
    return res.status(201).json({ data: result });
  }

  const item = addCollectionItem({ cardId: card.id, ...collection });
  return res.status(201).json({ data: item });
}

collectionWriteRouter.post('/', (req, res) => createCollection(req, res));

collectionWriteRouter.post('/import/preview', async (req, res) => {
  const body = req.body || {};
  res.json({ data: await previewCollectionImport(body.text, collectionImportInput(body)) });
});

collectionWriteRouter.post('/import', async (req, res) => {
  const body = req.body || {};
  const previewToken = optionalString(body.previewToken, 128);
  if (!previewToken) throw new HttpError(400, 'Controleer de importlijst voordat je deze toevoegt.');
  const result = await importCollectionList(body.text, collectionImportInput(body), previewToken);
  res.status(201).json({ data: result });
});

// Dedicated endpoint used by the interface. Requiring deck fields prevents a
// collection-only success when an outdated backend is still running.
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
  const body = req.body || {};
  // Only omission means "keep the finish". An explicitly empty finish must
  // never silently change an owned foil into the default nonfoil variant.
  if (Object.hasOwn(body, 'finish')) oneOf(body.finish, ['nonfoil', 'foil', 'etched'], 'Afwerking');
  const merged = {
    quantity: body.quantity ?? current.quantity,
    finish: body.finish ?? current.finish,
    language: body.language ?? current.language,
    condition: body.condition ?? current.condition,
    location: body.location ?? current.location,
    notes: body.notes ?? current.notes,
    purchasePrice: body.purchasePrice !== undefined ? body.purchasePrice : current.purchasePrice,
    reconcileWanted: false
  };
  res.json({ data: updateCollectionItem(id, {
    ...collectionInput(merged, { allowZero: true }),
    expectedRevision: body.expectedRevision
  }) });
});

collectionWriteRouter.delete('/:id', (req, res) => {
  res.json({ data: deleteCollectionItem(positiveInteger(req.params.id, 'Collectie-ID'), {
    expectedRevision: req.body?.expectedRevision
  }) });
});
