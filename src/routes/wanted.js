import express from 'express';
import { ensureCard } from '../services/card-cache-service.js';
import {
  deleteWanted,
  getWantedItem,
  listWanted,
  setWantedPrinting,
  updateWanted,
  upsertWanted,
  wantedFilterOptions
} from '../services/wanted-service.js';
import { optionalNumber, optionalString, positiveInteger } from '../lib/validation.js';
import { HttpError } from '../lib/http-error.js';
import { exportWantedCsv } from '../services/import-export-service.js';
import {
  ensureWantedPrintingCatalogs,
  resolveSinglePrintingCard
} from '../services/printing-catalog-service.js';

export const wantedReadRouter = express.Router();
export const wantedWriteRouter = express.Router();

function wantedInput(body) {
  const priority = positiveInteger(body.priority ?? 3, 'Prioriteit');
  if (priority > 5) throw new HttpError(400, 'Prioriteit moet tussen 1 en 5 liggen.');
  return {
    quantity: positiveInteger(body.quantity ?? 1, 'Aantal'),
    priority,
    maximumPrice: optionalNumber(body.maximumPrice, 'Maximumprijs'),
    notes: optionalString(body.notes, 5000)
  };
}

wantedReadRouter.get('/options', async (req, res) => {
  const sync = await ensureWantedPrintingCatalogs();
  res.json({
    data: {
      ...wantedFilterOptions(),
      catalogIncomplete: sync.incomplete,
      catalogFailures: sync.failures
    }
  });
});

wantedReadRouter.get('/export.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wanted-list.csv"');
  res.send(`\uFEFF${exportWantedCsv()}`);
});

wantedReadRouter.get('/', (req, res) => {
  // De opties-route vult/ververst de printingcatalogus. De lijst zelf blijft
  // bewust volledig lokaal, zodat live filters nooit externe API-calls doen.
  res.json({ data: listWanted(req.query) });
});

wantedWriteRouter.post('/', async (req, res) => {
  const card = await ensureCard(req.body || {});
  let printingCardId;
  if (req.body?.printingCardId) {
    const printing = await ensureCard({ cardId: req.body.printingCardId });
    printingCardId = printing.id;
  } else {
    try {
      printingCardId = (await resolveSinglePrintingCard(card))?.id;
    } catch (error) {
      console.warn(`[wanted] Automatische printingkeuze voor ${card.name} is overgeslagen: ${error.message}`);
    }
  }
  const rawDeckIds = Array.isArray(req.body?.deckIds)
    ? req.body.deckIds
    : req.body?.deckId ? [req.body.deckId] : [];
  const deckIds = [...new Set(rawDeckIds.map((value) => positiveInteger(value, 'Deck-ID')))];
  const item = upsertWanted({
    cardId: card.id,
    printingCardId,
    deckIds,
    ...wantedInput(req.body || {})
  });
  res.status(201).json({ data: item });
});

wantedWriteRouter.patch('/:id/printing', async (req, res) => {
  const id = positiveInteger(req.params.id, 'Wanted-ID');
  if (!getWantedItem(id)) throw new HttpError(404, 'Wanted-item niet gevonden.');
  if (req.body?.clear === true || req.body?.printingCardId === null) {
    return res.json({ data: setWantedPrinting(id, null) });
  }
  const identifier = req.body?.printingCardId
    ? { cardId: req.body.printingCardId }
    : req.body?.scryfallId
      ? { scryfallId: req.body.scryfallId }
      : req.body?.setCode && req.body?.collectorNumber
        ? { setCode: req.body.setCode, collectorNumber: req.body.collectorNumber, language: req.body.language || '' }
        : null;
  if (!identifier) throw new HttpError(400, 'Kies een printing of geef clear=true op.');
  const printing = await ensureCard(identifier);
  return res.json({ data: setWantedPrinting(id, printing.id) });
});

wantedWriteRouter.patch('/:id', (req, res) => {
  const id = positiveInteger(req.params.id, 'Wanted-ID');
  const current = getWantedItem(id);
  if (!current) throw new HttpError(404, 'Wanted-item niet gevonden.');
  const body = {
    quantity: req.body.quantity ?? current.quantity,
    priority: req.body.priority ?? current.priority,
    maximumPrice: req.body.maximumPrice !== undefined ? req.body.maximumPrice : current.maximumPrice,
    notes: req.body.notes ?? current.notes
  };
  res.json({ data: updateWanted(id, wantedInput(body)) });
});

wantedWriteRouter.delete('/:id', (req, res) => res.json({ data: deleteWanted(positiveInteger(req.params.id, 'Wanted-ID')) }));
