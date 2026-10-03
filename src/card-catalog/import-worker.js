import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, statfs } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { buildCardCatalogDatabase } from './builder.js';

export const CARD_CATALOG_SOURCE_URL = 'https://mtgjson.com/api/v5/AtomicCards.json.gz';
export const CARD_CATALOG_CHECKSUM_URL = `${CARD_CATALOG_SOURCE_URL}.sha256`;

const MAX_COMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
const MIN_FREE_BYTES = 1024 * 1024 * 1024;
const HEADER_TIMEOUT_MS = 30_000;
const INACTIVITY_TIMEOUT_MS = 60_000;
const MAX_CHECKSUM_BYTES = 256;

function progress(values) {
  parentPort?.postMessage({ type: 'progress', ...values });
}

function safeFailure(error) {
  const known = {
    CHECKSUM_MISMATCH: 'De controlecode van het gedownloade MTGJSON-bestand klopt niet.',
    DOWNLOAD_TOO_LARGE: 'Het MTGJSON-bestand is groter dan de toegestane limiet.',
    INVALID_GZIP: 'De MTGJSON-download is geen geldig gzip-bestand.',
    INSUFFICIENT_STORAGE: 'Er is onvoldoende vrije schijfruimte voor de kaartcatalogus.',
    FETCH_TIMEOUT: 'MTGJSON reageerde niet binnen de toegestane tijd.'
  };
  return known[error?.code]
    || (String(error?.code || '').startsWith('ATOMIC_CARDS_') ? error.message : '')
    || 'De MTGJSON-bron kon niet veilig worden verwerkt.';
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function checkedFetch(url, timeoutMs = HEADER_TIMEOUT_MS, controller = new AbortController()) {
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: '*/*',
        'User-Agent': `MagicCollectionManager/${workerData?.applicationVersion || 'local'} (MTGJSON catalog import)`
      }
    });
    if (response.status !== 200) throw new Error(`MTGJSON antwoordde met HTTP ${response.status}.`);
    return response;
  } catch (error) {
    if (error?.name === 'AbortError') throw codedError('FETCH_TIMEOUT', 'Download timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function releaseReader(reader) {
  try {
    reader.releaseLock();
  } catch {
    // A timed-out read may still be settling after the request was aborted.
  }
}

function cancelReader(reader) {
  try {
    const cancellation = reader.cancel();
    void Promise.resolve(cancellation)
      .catch(() => {})
      .finally(() => releaseReader(reader));
  } catch {
    // Aborting the request already releases most implementations.
  }
  releaseReader(reader);
}

export async function readChecksumResponse(response, {
  abortController,
  inactivityTimeoutMs = INACTIVITY_TIMEOUT_MS
} = {}) {
  let reader = null;
  let bodyComplete = false;
  const chunks = [];
  let received = 0;

  try {
    reader = response.body?.getReader() || null;
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_CHECKSUM_BYTES) {
      throw new Error('De checksumresponse is onverwacht groot.');
    }

    if (reader) {
      while (true) {
        let timer;
        let timeoutError = null;
        let part;
        try {
          part = await Promise.race([
            reader.read(),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                timeoutError = codedError('FETCH_TIMEOUT', 'Download inactivity timeout');
                try {
                  abortController?.abort();
                } finally {
                  reject(timeoutError);
                }
              }, inactivityTimeoutMs);
            })
          ]);
        } catch (error) {
          if (timeoutError) throw timeoutError;
          throw error;
        } finally {
          clearTimeout(timer);
        }

        if (part.done) break;
        received += part.value.byteLength;
        if (received > MAX_CHECKSUM_BYTES) {
          throw new Error('De checksumresponse is onverwacht groot.');
        }
        chunks.push(Buffer.from(part.value));
      }
    }
    bodyComplete = true;
  } finally {
    if (!bodyComplete) {
      abortController?.abort();
      if (reader) cancelReader(reader);
    } else if (reader) {
      releaseReader(reader);
    }
  }

  const text = Buffer.concat(chunks, received).toString('utf8');
  const match = text.trim().match(/^([a-f0-9]{64})(?:\s+.*)?$/iu);
  if (!match) throw new Error('MTGJSON leverde geen geldige SHA-256-controlecode.');
  return match[1].toLowerCase();
}

async function expectedChecksum() {
  const controller = new AbortController();
  try {
    const response = await checkedFetch(CARD_CATALOG_CHECKSUM_URL, HEADER_TIMEOUT_MS, controller);
    return await readChecksumResponse(response, { abortController: controller });
  } finally {
    controller.abort();
  }
}

async function ensureDiskSpace(directory, currentCatalogPath) {
  const stats = await statfs(directory);
  const available = Number(stats.bavail) * Number(stats.bsize);
  const currentSize = fs.existsSync(currentCatalogPath) ? fs.statSync(currentCatalogPath).size : 0;
  const required = Math.max(MIN_FREE_BYTES, currentSize * 3 + 512 * 1024 * 1024);
  if (!Number.isFinite(available) || available < required) {
    throw codedError('INSUFFICIENT_STORAGE', `Required ${required}, available ${available}`);
  }
}

async function writeAll(file, chunk) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset, null);
    if (!bytesWritten) throw new Error('De MTGJSON-download kon niet naar schijf worden geschreven.');
    offset += bytesWritten;
  }
}

async function downloadSource(downloadPath, checksum) {
  const controller = new AbortController();
  let reader = null;
  let completed = false;
  try {
    const headerTimer = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS);
    headerTimer.unref?.();
    let response;
    try {
      response = await fetch(CARD_CATALOG_SOURCE_URL, {
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/gzip, application/octet-stream',
          'User-Agent': `MagicCollectionManager/${workerData?.applicationVersion || 'local'} (MTGJSON catalog import)`
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw codedError('FETCH_TIMEOUT', 'Download timeout');
      throw error;
    } finally {
      clearTimeout(headerTimer);
    }
    if (response.status !== 200 || !response.body) throw new Error(`MTGJSON antwoordde met HTTP ${response.status}.`);

    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_COMPRESSED_BYTES) throw codedError('DOWNLOAD_TOO_LARGE', 'Compressed size limit exceeded');
    progress({
      phase: 'downloading',
      totalBytes: declaredSize || null,
      message: 'AtomicCards wordt veilig gedownload…'
    });

    const file = await open(downloadPath, 'wx', 0o600);
    const digest = createHash('sha256');
    reader = response.body.getReader();
    let received = 0;
    let signature = Buffer.alloc(0);
    let lastProgressAt = 0;
    try {
      while (true) {
        const inactivity = setTimeout(() => controller.abort(), INACTIVITY_TIMEOUT_MS);
        inactivity.unref?.();
        let part;
        try {
          part = await reader.read();
        } catch (error) {
          if (controller.signal.aborted) throw codedError('FETCH_TIMEOUT', 'Download inactivity timeout');
          throw error;
        } finally {
          clearTimeout(inactivity);
        }
        if (part.done) break;
        const chunk = Buffer.from(part.value);
        received += chunk.byteLength;
        if (received > MAX_COMPRESSED_BYTES) throw codedError('DOWNLOAD_TOO_LARGE', 'Compressed size limit exceeded');
        if (signature.byteLength < 2) signature = Buffer.concat([signature, chunk.subarray(0, 2 - signature.byteLength)]);
        digest.update(chunk);
        await writeAll(file, chunk);
        if (Date.now() - lastProgressAt >= 250) {
          lastProgressAt = Date.now();
          progress({
            phase: 'downloading',
            downloadedBytes: received,
            totalBytes: declaredSize || null,
            message: 'AtomicCards wordt veilig gedownload…'
          });
        }
      }
      await file.sync();
    } finally {
      await file.close();
    }

    if (signature[0] !== 0x1f || signature[1] !== 0x8b) throw codedError('INVALID_GZIP', 'Invalid gzip signature');
    const actual = digest.digest('hex');
    if (actual !== checksum) throw codedError('CHECKSUM_MISMATCH', `Expected ${checksum}, received ${actual}`);
    progress({
      phase: 'verifying',
      downloadedBytes: received,
      totalBytes: declaredSize || received,
      message: 'De download wordt gecontroleerd…'
    });
    completed = true;
    return received;
  } finally {
    controller.abort();
    if (reader) {
      if (!completed) {
        try {
          await reader.cancel();
        } catch {
          // Aborting the fetch already releases most implementations.
        }
      }
      try {
        reader.releaseLock();
      } catch {
        // The stream may already have released its reader after completion.
      }
    }
  }
}

async function runImport() {
  const { downloadPath, databasePath, catalogPath } = workerData;
  await ensureDiskSpace(path.dirname(databasePath), catalogPath);
  progress({ phase: 'checking', message: 'Officiële MTGJSON-controlecode wordt opgehaald…' });
  const checksum = await expectedChecksum();
  await downloadSource(downloadPath, checksum);
  progress({ phase: 'verifying', message: 'Download is gecontroleerd; kaarten worden verwerkt…' });

  const compressedStream = createReadStream(downloadPath);
  const gunzip = createGunzip();
  compressedStream.on('error', (error) => gunzip.destroy(error));
  compressedStream.pipe(gunzip);
  const result = await buildCardCatalogDatabase({
    source: gunzip,
    databasePath,
    sourceUrl: CARD_CATALOG_SOURCE_URL,
    sourceSha256: checksum,
    limits: {
      maxDocumentBytes: MAX_DECOMPRESSED_BYTES,
      maxCards: 100_000
    },
    onProgress(update) {
      progress({
        ...update,
        message: update.phase === 'indexing'
          ? 'Zoekindexen worden opgebouwd…'
          : 'Kaartrecords worden geïmporteerd…'
      });
    }
  });
  fs.rmSync(downloadPath, { force: true });
  parentPort.postMessage({ type: 'ready', ...result });
}

if (!isMainThread) {
  runImport().catch((error) => {
    for (const filePath of [workerData?.downloadPath, workerData?.databasePath]) {
      if (!filePath) continue;
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // The parent process performs a second best-effort cleanup.
      }
    }
    parentPort.postMessage({
      type: 'failed',
      error: safeFailure(error),
      technical: `${error?.code || error?.name || 'Error'}: ${error?.message || String(error)}`
    });
  });
}
