import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { config } from '../config.js';
import { HttpError } from '../lib/http-error.js';
import { activateCardCatalog } from './database.js';

const IMPORT_PREFIX = '.card-catalog-import-';
const IMPORT_LOCK_FILE = '.card-catalog-import.lock';
const IMPORT_TIMEOUT_MS = 20 * 60 * 1000;
let activeWorker = null;
let activeFiles = null;
let activeTerminator = null;
let importJob = null;

function publicJob() {
  if (!importJob) return null;
  return {
    id: importJob.id,
    status: importJob.status,
    phase: importJob.phase,
    processed: importJob.processed,
    total: importJob.total,
    downloadedBytes: importJob.downloadedBytes,
    totalBytes: importJob.totalBytes,
    message: importJob.message,
    ...(importJob.error ? { error: importJob.error } : {}),
    startedAt: importJob.startedAt,
    finishedAt: importJob.finishedAt || null
  };
}

function cleanupFiles(files) {
  if (!files) return;
  for (const filePath of Object.values(files)) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Stale import artifacts are also cleaned before the next import.
    }
  }
}

function cleanupStaleImports() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const protectedFiles = new Set([
    path.resolve(config.dataDir, IMPORT_LOCK_FILE),
    path.resolve(config.databasePath),
    path.resolve(`${config.databasePath}-wal`),
    path.resolve(`${config.databasePath}-shm`),
    path.resolve(`${config.databasePath}-journal`),
    path.resolve(config.cardCatalogDatabasePath),
    path.resolve(`${config.cardCatalogDatabasePath}-wal`),
    path.resolve(`${config.cardCatalogDatabasePath}-shm`),
    path.resolve(`${config.cardCatalogDatabasePath}-journal`),
    path.resolve(`${config.cardCatalogDatabasePath}.previous`),
    path.resolve(`${config.cardCatalogDatabasePath}.previous-wal`),
    path.resolve(`${config.cardCatalogDatabasePath}.previous-shm`),
    path.resolve(`${config.cardCatalogDatabasePath}.previous-journal`)
  ]);
  for (const entry of fs.readdirSync(config.dataDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(IMPORT_PREFIX)) continue;
    const candidate = path.resolve(config.dataDir, entry.name);
    if (protectedFiles.has(candidate)) continue;
    try {
      fs.rmSync(candidate, { force: true });
    } catch {
      // A later import can report a concrete write error if cleanup is blocked.
    }
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    return null;
  }
}

function removeStaleImportLock(lockPath) {
  let stat;
  let metadata = null;
  try {
    stat = fs.statSync(lockPath);
    metadata = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
  }

  const alive = processIsAlive(Number(metadata?.pid));
  const sameInactiveProcess = Number(metadata?.pid) === process.pid && !activeWorker;
  const oldMalformedLock = alive === null
    && stat
    && Date.now() - stat.mtimeMs > IMPORT_TIMEOUT_MS + 60_000;
  if (alive !== false && !sameInactiveProcess && !oldMalformedLock) return false;

  try {
    const current = fs.statSync(lockPath);
    if (stat && (current.dev !== stat.dev || current.ino !== stat.ino)) return false;
    fs.rmSync(lockPath, { force: true });
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

function acquireImportLock(id) {
  const lockPath = path.join(config.dataDir, IMPORT_LOCK_FILE);
  fs.mkdirSync(config.dataDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor = null;
    try {
      descriptor = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ id, pid: process.pid, startedAt: new Date().toISOString() }));
      fs.fsyncSync(descriptor);
      const stat = fs.fstatSync(descriptor);
      return { descriptor, id, lockPath, dev: stat.dev, ino: stat.ino };
    } catch (error) {
      if (descriptor !== null) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // The failed lock creation is cleaned below.
        }
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {
          // The original lock error remains the useful failure.
        }
      }
      if (error?.code === 'EEXIST') {
        if (attempt === 0 && removeStaleImportLock(lockPath)) continue;
        throw new HttpError(409, 'Er wordt al een MTGJSON-kaartcatalogus geïmporteerd.');
      }
      throw new HttpError(500, 'De importvergrendeling kon niet worden aangemaakt.');
    }
  }
  throw new HttpError(409, 'Er wordt al een MTGJSON-kaartcatalogus geïmporteerd.');
}

function releaseImportLock(lock) {
  if (!lock) return;
  try {
    fs.closeSync(lock.descriptor);
  } catch {
    // Continue with ownership-checked removal.
  }
  try {
    const current = fs.statSync(lock.lockPath);
    if (current.dev === lock.dev && current.ino === lock.ino) {
      fs.rmSync(lock.lockPath, { force: true });
    }
  } catch {
    // A missing lock is already released; a replacement belongs to another process.
  }
}

function setFailed(message, jobId) {
  if (!importJob || importJob.id !== jobId || importJob.status !== 'running') return;
  importJob = {
    ...importJob,
    status: 'failed',
    phase: 'failed',
    message: 'Importeren is mislukt. De vorige catalogus is behouden.',
    error: message || 'Onbekende importfout.',
    finishedAt: new Date().toISOString()
  };
}

export function cardCatalogImportStatus() {
  return publicJob();
}

export function startCardCatalogImport() {
  if (activeWorker || importJob?.status === 'running') {
    throw new HttpError(409, 'Er wordt al een MTGJSON-kaartcatalogus geïmporteerd.');
  }
  const id = randomUUID();
  const lock = acquireImportLock(id);
  try {
    cleanupStaleImports();
  } catch (error) {
    releaseImportLock(lock);
    throw error;
  }

  const files = {
    downloadPath: path.join(config.dataDir, `${IMPORT_PREFIX}${id}.json.gz`),
    databasePath: path.join(config.dataDir, `${IMPORT_PREFIX}${id}.sqlite`)
  };
  activeFiles = files;
  importJob = {
    id,
    status: 'running',
    phase: 'checking',
    processed: 0,
    total: null,
    downloadedBytes: 0,
    totalBytes: null,
    message: 'Import wordt voorbereid…',
    error: '',
    startedAt: new Date().toISOString(),
    finishedAt: null
  };

  let worker;
  try {
    worker = new Worker(new URL('./import-worker.js', import.meta.url), {
      workerData: {
        id,
        ...files,
        catalogPath: config.cardCatalogDatabasePath,
        applicationVersion: config.applicationVersion
      },
      resourceLimits: { maxOldGenerationSizeMb: 256 }
    });
  } catch (error) {
    console.error('[card-catalog-worker-start]', error);
    setFailed('Het achtergrondproces voor de import kon niet worden gestart.', id);
    cleanupFiles(files);
    releaseImportLock(lock);
    if (activeFiles === files) activeFiles = null;
    throw new HttpError(500, 'De kaartcatalogusimport kon niet worden gestart.');
  }
  activeWorker = worker;
  let finished = false;
  let timeout = null;
  let terminationPromise = null;
  let resourcesReleased = false;
  const ownsActiveJob = () => activeWorker === worker && importJob?.id === id;
  const releaseResources = () => {
    if (resourcesReleased) return;
    resourcesReleased = true;
    cleanupFiles(files);
    releaseImportLock(lock);
    if (ownsActiveJob()) {
      activeWorker = null;
      if (activeFiles === files) activeFiles = null;
      if (activeTerminator === terminateAndFinish) activeTerminator = null;
    }
  };
  const terminateAndFinish = () => {
    if (terminationPromise) return terminationPromise;
    if (finished || !ownsActiveJob()) return Promise.resolve();
    finished = true;
    if (timeout) clearTimeout(timeout);
    terminationPromise = Promise.resolve()
      .then(() => worker.terminate())
      .catch(() => {})
      .finally(releaseResources);
    return terminationPromise;
  };
  activeTerminator = terminateAndFinish;
  timeout = setTimeout(() => {
    if (finished || !ownsActiveJob()) return;
    setFailed('De import duurde langer dan twintig minuten en is afgebroken.', id);
    void terminateAndFinish();
  }, IMPORT_TIMEOUT_MS);
  timeout.unref();

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    releaseResources();
  };

  worker.on('message', (message) => {
    if (finished || !ownsActiveJob() || !message || typeof message !== 'object') return;
    if (message.type === 'progress') {
      importJob = {
        ...importJob,
        phase: message.phase || importJob.phase,
        processed: Number.isFinite(message.processed) ? Number(message.processed) : importJob.processed,
        total: Number.isFinite(message.total) ? Number(message.total) : importJob.total,
        downloadedBytes: Number.isFinite(message.downloadedBytes)
          ? Number(message.downloadedBytes)
          : importJob.downloadedBytes,
        totalBytes: Number.isFinite(message.totalBytes) ? Number(message.totalBytes) : importJob.totalBytes,
        message: message.message || importJob.message
      };
      return;
    }

    if (message.type === 'failed') {
      setFailed(message.error || 'De brondata konden niet worden geïmporteerd.', id);
      console.error('[card-catalog-import]', message.technical || message.error || 'Worker import failed');
      // Hold the import lock until the failed worker has really stopped. This
      // prevents its download reader from overlapping with a new import.
      void terminateAndFinish();
      return;
    }

    if (message.type === 'ready') {
      importJob = {
        ...importJob,
        phase: 'activating',
        message: 'Nieuwe kaartcatalogus wordt geactiveerd…',
        processed: Number(message.cardCount || importJob.processed),
        total: Number(message.cardCount || importJob.total || 0)
      };
      try {
        activateCardCatalog(files.databasePath);
        importJob = {
          ...importJob,
          status: 'completed',
          phase: 'complete',
          message: `${Number(message.cardCount || 0).toLocaleString('nl-NL')} kaartrecords zijn geïmporteerd.`,
          error: '',
          finishedAt: new Date().toISOString()
        };
      } catch (error) {
        console.error('[card-catalog-activate]', error);
        setFailed('De nieuwe catalogus kon niet veilig worden geactiveerd.', id);
      } finally {
        finish();
      }
    }
  });

  worker.on('error', (error) => {
    if (finished || !ownsActiveJob()) return;
    console.error('[card-catalog-worker]', error);
    setFailed('Het achtergrondproces voor de import is onverwacht gestopt.', id);
    void terminateAndFinish();
  });

  worker.on('exit', (code) => {
    if (finished || !ownsActiveJob()) return;
    if (code !== 0 || importJob?.status === 'running') {
      setFailed('Het achtergrondproces voor de import is onverwacht gestopt.', id);
    }
    finish();
  });

  return publicJob();
}

export async function stopCardCatalogImport() {
  if (!activeWorker) return;
  const worker = activeWorker;
  const files = activeFiles;
  const jobId = importJob?.id;
  const terminate = activeTerminator;
  if (importJob?.id === jobId && importJob?.status === 'running') {
    importJob = {
      ...importJob,
      status: 'failed',
      phase: 'failed',
      message: 'Import is door het afsluiten van de server onderbroken.',
      error: 'Server afgesloten tijdens import.',
      finishedAt: new Date().toISOString()
    };
  }
  if (terminate) {
    await terminate();
    return;
  }
  try {
    await worker.terminate();
  } finally {
    cleanupFiles(files);
    if (activeWorker === worker && importJob?.id === jobId) {
      activeWorker = null;
      if (activeFiles === files) activeFiles = null;
      activeTerminator = null;
    }
  }
}
