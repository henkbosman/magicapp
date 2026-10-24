import express from 'express';
import { ensureCard } from '../services/card-cache-service.js';
import {
  addDeckCard,
  addMissingToWanted,
  createDeck,
  deleteDeck,
  deleteDeckCard,
  duplicateDeck,
  exportDeck,
  exportDeckDck,
  exportDeckText,
  getDeck,
  getDeckCards,
  getDeckMissing,
  listDecks,
  requireDeck,
  updateDeck,
  updateDeckCard
} from '../services/deck-service.js';
import { calculateDeckStats } from '../services/deck-stats-service.js';
import { importDeckList } from '../services/import-export-service.js';
import { booleanValue, oneOf, optionalString, positiveInteger, requiredString } from '../lib/validation.js';
import { HttpError } from '../lib/http-error.js';
import { createDeckTag, deleteDeckTag, listDeckTags, renameDeckTag } from '../services/deck-tag-service.js';
import { getDeckRevision } from '../services/deck-revision-service.js';
import {
  createDeckCardLink,
  deleteDeckCardLink,
  listDeckCardLinks,
  setDeckCardSynergies,
  updateDeckCardLink
} from '../services/deck-link-service.js';

export const decksReadRouter = express.Router();
export const decksWriteRouter = express.Router();
const ROLES = ['commander', 'partner', 'companion', 'main', 'sideboard', 'maybeboard'];

function deckInput(body, current = {}) {
  return {
    name: requiredString(body.name ?? current.name, 'Naam', 200),
    description: optionalString(body.description ?? current.description, 5000),
    format: oneOf(body.format ?? current.format, ['commander', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'oathbreaker', 'brawl', 'other'], 'Formaat', 'commander'),
    notes: optionalString(body.notes ?? current.notes, 10000)
  };
}

function deckCardInput(body, current = {}) {
  const tagInput = {};
  if (Object.hasOwn(body, 'tagIds')) tagInput.tagIds = body.tagIds;
  if (body.tags !== undefined && body.tags !== null) {
    tagInput.tags = Array.isArray(body.tags) ? body.tags : String(body.tags).split(',').map((tag) => tag.trim());
  }
  return {
    quantity: positiveInteger(body.quantity ?? current.quantity ?? 1, 'Aantal'),
    role: oneOf(body.role ?? current.role, ROLES, 'Rol', 'main'),
    note: optionalString(body.note ?? current.note, 5000),
    ...tagInput,
    strictTags: true
  };
}

decksReadRouter.get('/', (req, res) => res.json({ data: listDecks() }));

decksWriteRouter.post('/', (req, res) => {
  res.status(201).json({ data: createDeck(deckInput(req.body || {})) });
});

decksReadRouter.get('/:id', (req, res) => {
  const deck = getDeck(positiveInteger(req.params.id, 'Deck-ID'));
  if (!deck) throw new HttpError(404, 'Deck niet gevonden.');
  res.json({ data: deck });
});

decksWriteRouter.patch('/:id', (req, res) => {
  const id = positiveInteger(req.params.id, 'Deck-ID');
  const current = requireDeck(id);
  res.json({ data: updateDeck(id, deckInput(req.body || {}, current)) });
});

decksWriteRouter.delete('/:id', (req, res) => res.json({ data: deleteDeck(positiveInteger(req.params.id, 'Deck-ID')) }));

decksWriteRouter.post('/:id/duplicate', (req, res) => {
  const id = positiveInteger(req.params.id, 'Deck-ID');
  const source = requireDeck(id);
  const name = requiredString(req.body?.name || `${source.name} (kopie)`, 'Naam', 200);
  res.status(201).json({ data: duplicateDeck(id, name) });
});

decksReadRouter.get('/:id/cards', (req, res) => {
  res.json({ data: getDeckCards(positiveInteger(req.params.id, 'Deck-ID')) });
});

decksReadRouter.get('/:id/tags', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: listDeckTags(positiveInteger(req.params.id, 'Deck-ID')) });
});

decksWriteRouter.post('/:id/tags', (req, res) => {
  res.status(201).json({ data: createDeckTag(positiveInteger(req.params.id, 'Deck-ID'), req.body?.name) });
});

decksWriteRouter.patch('/:id/tags/:tagId', (req, res) => {
  res.json({ data: renameDeckTag(positiveInteger(req.params.id, 'Deck-ID'),
    positiveInteger(req.params.tagId, 'Tag-ID'), req.body?.name) });
});

decksWriteRouter.delete('/:id/tags/:tagId', (req, res) => {
  res.json({ data: deleteDeckTag(positiveInteger(req.params.id, 'Deck-ID'), positiveInteger(req.params.tagId, 'Tag-ID')) });
});

decksReadRouter.get('/:id/revision', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: getDeckRevision(positiveInteger(req.params.id, 'Deck-ID')) });
});

decksWriteRouter.post('/:id/cards', async (req, res) => {
  const deckId = positiveInteger(req.params.id, 'Deck-ID');
  const card = await ensureCard(req.body || {});
  res.status(201).json({ data: addDeckCard(deckId, { cardId: card.id, ...deckCardInput(req.body || {}) }) });
});

decksWriteRouter.patch('/:id/cards/:deckCardId', (req, res) => {
  const deckId = positiveInteger(req.params.id, 'Deck-ID');
  const deckCardId = positiveInteger(req.params.deckCardId, 'Deckkaart-ID');
  const current = getDeckCards(deckId).find((item) => item.id === deckCardId);
  if (!current) throw new HttpError(404, 'Kaartregel in deck niet gevonden.');
  res.json({ data: updateDeckCard(deckId, deckCardId, deckCardInput(req.body || {}, current)) });
});

decksWriteRouter.delete('/:id/cards/:deckCardId', (req, res) => {
  res.json({ data: deleteDeckCard(positiveInteger(req.params.id, 'Deck-ID'), positiveInteger(req.params.deckCardId, 'Deckkaart-ID')) });
});

decksWriteRouter.put('/:id/cards/:deckCardId/synergies', (req, res) => {
  res.json({ data: setDeckCardSynergies(
    positiveInteger(req.params.id, 'Deck-ID'),
    positiveInteger(req.params.deckCardId, 'Deckkaart-ID'),
    req.body?.synergyIds
  ) });
});

decksReadRouter.get('/:id/links', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: listDeckCardLinks(positiveInteger(req.params.id, 'Deck-ID')) });
});

decksWriteRouter.post('/:id/links', (req, res) => {
  const deckId = positiveInteger(req.params.id, 'Deck-ID');
  res.status(201).json({ data: createDeckCardLink(deckId, req.body || {}) });
});

decksWriteRouter.patch('/:id/links/:linkId', (req, res) => {
  const deckId = positiveInteger(req.params.id, 'Deck-ID');
  const linkId = positiveInteger(req.params.linkId, 'Koppeling-ID');
  res.json({ data: updateDeckCardLink(deckId, linkId, req.body || {}) });
});

decksWriteRouter.delete('/:id/links/:linkId', (req, res) => {
  res.json({ data: deleteDeckCardLink(
    positiveInteger(req.params.id, 'Deck-ID'),
    positiveInteger(req.params.linkId, 'Koppeling-ID')
  ) });
});

decksReadRouter.get('/:id/stats', (req, res) => {
  res.json({ data: calculateDeckStats(positiveInteger(req.params.id, 'Deck-ID'), {
    excludeLandsFromAverage: booleanValue(req.query.excludeLands, true)
  }) });
});



decksReadRouter.get('/:id/missing', (req, res) => res.json({ data: getDeckMissing(positiveInteger(req.params.id, 'Deck-ID')) }));

decksWriteRouter.post('/:id/missing/to-wanted', async (req, res) => {
  res.json({ data: await addMissingToWanted(positiveInteger(req.params.id, 'Deck-ID')) });
});

decksWriteRouter.post('/:id/import', async (req, res) => {
  const result = await importDeckList(positiveInteger(req.params.id, 'Deck-ID'), req.body?.text);
  res.status(201).json({ data: result });
});

decksReadRouter.get('/:id/export.txt', (req, res) => {
  const result = exportDeckText(positiveInteger(req.params.id, 'Deck-ID'), { missingOnly: booleanValue(req.query.missing, false) });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.text);
});

decksReadRouter.get('/:id/export', (req, res) => {
  res.json({ data: exportDeck(positiveInteger(req.params.id, 'Deck-ID'), { format: req.query.format }) });
});

decksReadRouter.get('/:id/export.dck', (req, res) => {
  const result = exportDeckDck(positiveInteger(req.params.id, 'Deck-ID'));
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.text);
});
