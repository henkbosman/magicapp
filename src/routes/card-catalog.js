import express from 'express';
import { cardCatalogStatus } from '../card-catalog/database.js';
import { cardCatalogImportStatus } from '../card-catalog/import-service.js';
import { cardCatalogOptions, searchCardCatalog } from '../card-catalog/repository.js';
import { cardCatalogPreview } from '../card-catalog/preview.js';

export const cardCatalogReadRouter = express.Router();

cardCatalogReadRouter.get('/status', (req, res) => {
  res.json({
    data: {
      ...cardCatalogStatus(),
      importJob: cardCatalogImportStatus()
    }
  });
});

cardCatalogReadRouter.get('/options', (req, res) => {
  res.json({ data: cardCatalogOptions(req.query) });
});

cardCatalogReadRouter.get('/search', (req, res) => {
  res.json({ data: searchCardCatalog(req.query) });
});

cardCatalogReadRouter.get('/preview', async (req, res) => {
  res.json({ data: await cardCatalogPreview(req.query) });
});
