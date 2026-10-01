import assert from 'node:assert/strict';
import { test } from 'node:test';

import { preferredPrintingIndex, renderAddCard } from '../public/js/views/add-card.js';

function printing({
  scryfallId,
  collectorNumber,
  cached = false,
  cardId = null,
  variants = []
}) {
  return {
    printingKey: `tst|${collectorNumber}`,
    scryfallId,
    collectorNumber,
    cached,
    cardId,
    variants
  };
}

test('add-pagina heet Kaart opzoeken', async () => {
  const view = await renderAddCard({ query: new URLSearchParams() });

  assert.match(view.html, /<h1>Kaart opzoeken<\/h1>/);
  assert.doesNotMatch(view.html, /<h1>Kaart toevoegen<\/h1>/);
});

test('automatische printingkeuze gebruikt herstel, kaartnummer en lokale voorkeur deterministisch', () => {
  const printings = [
    printing({ scryfallId: 'newest', collectorNumber: '10' }),
    printing({ scryfallId: 'known', collectorNumber: '20', cached: true }),
    printing({
      scryfallId: 'other-language',
      collectorNumber: '10',
      variants: [{ scryfallId: 'restored-variant', cached: false }]
    })
  ];

  assert.equal(preferredPrintingIndex(printings, { scryfallId: 'restored-variant' }), 2);
  assert.equal(preferredPrintingIndex(printings, { collectorNumber: '10' }), 0);
  assert.equal(preferredPrintingIndex(printings), 1);
  assert.equal(preferredPrintingIndex(printings, { collectorNumber: '404' }), -1);
});

test('automatische printingkeuze valt zonder lokale printing terug op de eerste gesorteerde printing', () => {
  const printings = [
    printing({ scryfallId: 'first', collectorNumber: '1' }),
    printing({ scryfallId: 'second', collectorNumber: '2' })
  ];

  assert.equal(preferredPrintingIndex(printings), 0);
  assert.equal(preferredPrintingIndex([]), -1);
  assert.equal(preferredPrintingIndex(null), -1);
});
