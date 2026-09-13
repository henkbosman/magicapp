import process from 'node:process';
import express from 'express';
import { config } from './src/config.js';
import { closeDatabase } from './src/db/database.js';
import { HttpError } from './src/lib/http-error.js';
import { cardsReadRouter, cardsWriteRouter } from './src/routes/cards.js';
import { collectionReadRouter, collectionWriteRouter } from './src/routes/collection.js';
import { dashboardReadRouter } from './src/routes/dashboard.js';
import { decksReadRouter, decksWriteRouter } from './src/routes/decks.js';
import { maintenanceReadRouter, maintenanceWriteRouter } from './src/routes/maintenance.js';
import { wantedReadRouter, wantedWriteRouter } from './src/routes/wanted.js';
import { aiRouter } from './src/routes/ai.js';

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https://*.scryfall.io; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
  );
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: false, limit: '8mb' }));

const readApi = express.Router();
readApi.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return res.status(405).json({ error: { message: 'Deze API-zone accepteert uitsluitend leesacties.' } });
});
readApi.get('/health', (req, res) => res.json({ status: 'ok', version: config.applicationVersion }));
readApi.use('/dashboard', dashboardReadRouter);
readApi.use('/cards', cardsReadRouter);
readApi.use('/collection', collectionReadRouter);
readApi.use('/decks', decksReadRouter);
readApi.use('/wanted', wantedReadRouter);
readApi.use('/maintenance', maintenanceReadRouter);

const writeApi = express.Router();
writeApi.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  return res.status(405).json({ error: { message: 'Deze API-zone accepteert uitsluitend schrijfacties.' } });
});
writeApi.post('/health', (req, res) => res.json({ status: 'ok', writeAvailable: true, version: config.applicationVersion }));
writeApi.use('/cards', cardsWriteRouter);
writeApi.use('/collection', collectionWriteRouter);
writeApi.use('/decks', decksWriteRouter);
writeApi.use('/wanted', wantedWriteRouter);
writeApi.use('/maintenance', maintenanceWriteRouter);

app.use('/api/read', readApi);
app.use('/api/write', writeApi);
app.use('/api/ai', aiRouter);

app.use(express.static(config.publicDir, {
  etag: true,
  maxAge: 0,
  setHeaders(res, filePath) {
    if (/\.(?:css|js|html|md)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    if (/\.md$/i.test(filePath)) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    }
  }
}));

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile('index.html', { root: config.publicDir });
  }
  next();
});

app.use((req, res) => {
  res.status(404).json({ error: { message: 'Endpoint niet gevonden.' } });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) console.error('[request-error]', error);
  res.status(status).json({
    error: {
      message: status === 500 ? 'Er is een onverwachte fout opgetreden.' : error.message,
      details: error instanceof HttpError ? error.details : undefined
    }
  });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`Magic Collection Manager ${config.applicationVersion} draait op http://localhost:${config.port}`);
  console.log(`Database: ${config.databasePath}`);
});

function shutdown(signal) {
  console.log(`\n${signal} ontvangen; server wordt afgesloten.`);
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
