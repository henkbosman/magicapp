import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readChecksumResponse } from '../src/card-catalog/import-worker.js';

const encoder = new TextEncoder();

function streamingResponse(parts, headers) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    }
  }), { headers });
}

test('checksumresponse wordt begrensd en over chunks gevalideerd', async () => {
  const checksum = 'A'.repeat(64);
  const response = streamingResponse([
    checksum.slice(0, 17),
    checksum.slice(17),
    '  AtomicCards.json.gz\n'
  ]);

  assert.equal(await readChecksumResponse(response), checksum.toLowerCase());

  const boundary = streamingResponse([checksum, ' '.repeat(192)]);
  assert.equal(await readChecksumResponse(boundary), checksum.toLowerCase());

  let cancelled = false;
  const oversized = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('x'.repeat(257)));
    },
    cancel() {
      cancelled = true;
      return new Promise(() => {});
    }
  }));
  await assert.rejects(
    readChecksumResponse(oversized),
    { message: 'De checksumresponse is onverwacht groot.' }
  );
  assert.equal(cancelled, true);
});

test('checksumresponse breekt een inactieve stream af', async () => {
  let cancelled = false;
  const abortController = new AbortController();
  const response = new Response(new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    }
  }));

  await assert.rejects(
    readChecksumResponse(response, { abortController, inactivityTimeoutMs: 10 }),
    (error) => error.code === 'FETCH_TIMEOUT' && error.message === 'Download inactivity timeout'
  );
  assert.equal(abortController.signal.aborted, true);
  assert.equal(cancelled, true);
});
