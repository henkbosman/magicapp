import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderDeckDetail } from '../public/js/views/deck-detail.js';

function deckCard({ deckCardId, cardId, name, cardTypes, typeLine, quantity = 1 }) {
  return {
    id: deckCardId,
    role: 'main',
    quantity,
    tags: [],
    note: '',
    relations: [],
    coverage: {
      globalShortage: 0,
      assumedAvailable: false,
      missingFromCollection: 0,
      wantedGap: 0,
      onWanted: false
    },
    card: {
      id: cardId,
      name,
      printedName: '',
      typeLine,
      setName: 'Test Set',
      setCode: 'tst',
      collectorNumber: String(cardId),
      language: 'en',
      cardTypes,
      manaCost: '{1}',
      images: { small: 'https://example.invalid/small.jpg', normal: 'https://example.invalid/normal.jpg' },
      usage: { owned: quantity, needed: quantity }
    }
  };
}

test('deckkaartweergave groepeert hoofdtypes en opent in de gekozen view', async () => {
  const deck = {
    id: 7,
    name: 'Testdeck',
    format: 'commander',
    description: '',
    notes: '',
    commander: null,
    secondCommander: null
  };
  const cards = [
    deckCard({ deckCardId: 51, cardId: 11, name: 'Artifact Creature', cardTypes: ['Artifact', 'Creature'], typeLine: 'Artifact Creature', quantity: 2 }),
    deckCard({ deckCardId: 52, cardId: 12, name: 'Test Instant', cardTypes: ['Instant'], typeLine: 'Instant' })
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify({
    data: String(url).endsWith('/cards') ? cards : deck
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const view = await renderDeckDetail({
      params: { id: '7' },
      query: new URLSearchParams('view=cards')
    });

    assert.match(view.html, /data-deck-view="cards"[^>]+aria-pressed="true"/);
    assert.match(view.html, /id="deck-card-list" class="card-list" hidden/);
    assert.match(view.html, /data-deck-type-group="Creature"[\s\S]*?<h3>Creatures<\/h3>/);
    assert.match(view.html, /data-deck-type-group="Instant"[\s\S]*?<h3>Instants<\/h3>/);
    assert.match(view.html, /data-card-preview-id="11"/);
    assert.match(view.html, /aria-label="Toon grotere versie van Artifact Creature, 2 exemplaren"/);
    assert.match(view.html, /class="deck-visual-card-quantity" aria-hidden="true">2&times;<\/span>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
