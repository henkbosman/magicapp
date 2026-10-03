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
  const { discoveryMarkContext } = await import('../services/discovery-mark-service.js');
  res.json({ data: cardCatalogOptions(req.query, discoveryMarkContext()) });
});

cardCatalogReadRouter.get('/search', async (req, res) => {
  const { discoveryMarkContext } = await import('../services/discovery-mark-service.js');
  res.json({ data: searchCardCatalog(req.query, discoveryMarkContext()) });
});

cardCatalogReadRouter.get('/preview', async (req, res) => {
  res.json({ data: await cardCatalogPreview(req.query) });
});
