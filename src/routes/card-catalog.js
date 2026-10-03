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

cardCatalogReadRouter.get('/options', async (req, res) => {
  const { cardDiscoveryContext } = await import('../services/card-discovery-context-service.js');
  res.json({ data: cardCatalogOptions(req.query, cardDiscoveryContext(req.query)) });
});

cardCatalogReadRouter.get('/search', async (req, res) => {
  const { cardDiscoveryContext } = await import('../services/card-discovery-context-service.js');
  res.json({ data: searchCardCatalog(req.query, cardDiscoveryContext(req.query)) });
});

cardCatalogReadRouter.get('/preview', async (req, res) => {
  res.json({ data: await cardCatalogPreview(req.query) });
});
