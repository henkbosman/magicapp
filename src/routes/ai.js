import express from 'express';
import { positiveInteger } from '../lib/validation.js';
import {
  getAiCard,
  getAiDeckCards,
  listAiCollection,
  listAiDecks
} from '../services/ai-service.js';

export const aiRouter = express.Router();

aiRouter.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return res.status(405).json({ error: { message: 'De AI-API accepteert uitsluitend leesacties.' } });
});

aiRouter.get('/decks', (req, res) => {
  res.json(listAiDecks());
});

aiRouter.get('/decks/:id/cards', (req, res) => {
  res.json(getAiDeckCards(positiveInteger(req.params.id, 'Deck-ID')));
});

aiRouter.get('/cards/:id', (req, res) => {
  res.json(getAiCard(positiveInteger(req.params.id, 'Kaart-ID')));
});

aiRouter.get('/collection', (req, res) => {
  const limit = req.query.limit === undefined || req.query.limit === ''
    ? 25
    : positiveInteger(req.query.limit, 'Limit');
  const offset = req.query.offset === undefined || req.query.offset === ''
    ? 0
    : positiveInteger(req.query.offset, 'Offset', { allowZero: true });
  const deckId = req.query.deckId === undefined || req.query.deckId === ''
    ? null
    : positiveInteger(req.query.deckId, 'Deck-ID');

  res.json(listAiCollection({
    q: req.query.q,
    type: req.query.type,
    subtype: req.query.subtype,
    colors: req.query.colors,
    keyword: req.query.keyword,
    manaValue: req.query.manaValue,
    set: req.query.set,
    rarity: req.query.rarity,
    availability: req.query.availability,
    deckId,
    limit: Math.min(limit, 100),
    offset
  }));
});
