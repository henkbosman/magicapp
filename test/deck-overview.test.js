import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { renderDecks } from '../public/js/views/decks.js';

test('deckoverzicht toont commander en placeholder op verdubbelde afmetingen', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{
      id: 4,
      name: 'Commander deck',
      format: 'commander',
      description: '',
      commander: {
        id: 9,
        name: 'Test Commander',
        images: { small: 'https://example.invalid/commander.jpg' }
      },
      colorIdentity: ['G'],
      totalCards: 100,
      missingQuantity: 0,
      globalShortage: 0
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const view = await renderDecks();
    assert.match(view.html, /class="card-image commander-thumb"/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.deck-card-top\s*\{[^}]*grid-template-columns:\s*104px minmax\(0,1fr\);/s);
  assert.match(styles, /\.commander-thumb\s*\{[^}]*width:\s*104px;[^}]*height:\s*146px;[^}]*object-fit:\s*contain;/s);
  assert.match(styles, /\.card-image-placeholder\.commander-thumb\s*\{[^}]*width:\s*104px;[^}]*height:\s*146px;/s);
});
