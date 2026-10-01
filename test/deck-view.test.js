import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deckCardActionDescriptors,
  deckCardListActionDescriptors,
  deckDetailQueryString,
  normalizeDeckVisualColumns,
  renderDeckDetail
} from '../public/js/views/deck-detail.js';

function deckCard({ deckCardId, cardId, name, cardTypes, typeLine, oracleText = '', printedText = '', quantity = 1, role = 'main', wantedGap = 0, supertypes = [] }) {
  return {
    id: deckCardId,
    role,
    quantity,
    tags: [],
    note: '',
    relations: [],
    coverage: {
      globalShortage: 0,
      assumedAvailable: false,
      missingFromCollection: 0,
      wantedGap,
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
      supertypes,
      manaCost: '{1}',
      oracleText,
      printedText,
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
    deckCard({ deckCardId: 51, cardId: 11, name: 'Artifact Creature', cardTypes: ['Artifact', 'Creature'], typeLine: 'Artifact Creature', oracleText: '{T}: Add {G}.', quantity: 2 }),
    deckCard({ deckCardId: 52, cardId: 12, name: 'Test Instant', cardTypes: ['Instant'], typeLine: 'Instant' }),
    deckCard({ deckCardId: 53, cardId: 11, name: 'Artifact Creature', cardTypes: ['Artifact', 'Creature'], typeLine: 'Artifact Creature', role: 'sideboard' })
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify({
    data: String(url).endsWith('/cards') ? cards : deck
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const view = await renderDeckDetail({
      params: { id: '7' },
      query: new URLSearchParams('view=cards&cardColumns=5')
    });

    assert.match(view.html, /data-deck-view="cards"[^>]+aria-pressed="true"/);
    assert.match(view.html, /id="deck-card-list" class="card-list" hidden/);
    assert.match(view.html, /data-deck-type-group="Creature"[\s\S]*?<h3>Creatures<\/h3>/);
    assert.match(view.html, /data-deck-type-group="Instant"[\s\S]*?<h3>Instants<\/h3>/);
    assert.match(view.html, /id="deck-cards-per-row"[\s\S]*?<option value="5" selected>5<\/option>/);
    assert.match(view.html, /id="deck-card-visual" class="deck-visual-groups" data-columns="5"/);
    assert.match(view.html, /data-card-preview-id="11"/);
    assert.doesNotMatch(view.html, /data-deck-card-context-actions/);
    assert.doesNotMatch(view.html, /•••/);
    assert.match(view.html, /aria-keyshortcuts="Shift\+F10"/);
    assert.match(view.html, /aria-label="Toon grotere versie van Artifact Creature, 2 exemplaren"/);
    assert.match(view.html, /class="deck-visual-card-quantity" aria-hidden="true">2&times;<\/span>/);
    assert.match(view.html, /class="button secondary small open-deck-card-actions"/);
    assert.match(view.html, /aria-label="Acties voor Artifact Creature">Acties<\/button>/);
    assert.match(view.html, /class="deck-card-rules-text oracle-text">[\s\S]*?aria-label="Tappen"[\s\S]*?aria-label="Groen mana"/);
    assert.doesNotMatch(view.html, /class="[^\"]*manage-deck-relations/);
    assert.doesNotMatch(view.html, /class="[^\"]*remove-deck-card/);
    assert.doesNotMatch(view.html, />Meer<\/button>/);
    assert.doesNotMatch(view.html, /class="[^"]*deck-card-to-wanted/);
    assert.doesNotMatch(view.html, /class="[^"]*edit-deck-card-insights/);
    assert.doesNotMatch(view.html, /class="[^"]*edit-deck-card(?:\s|")/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('deckkolommen accepteren alleen auto of één tot en met acht', () => {
  assert.equal(normalizeDeckVisualColumns('auto'), 'auto');
  assert.equal(normalizeDeckVisualColumns('1'), '1');
  assert.equal(normalizeDeckVisualColumns('8'), '8');
  assert.equal(normalizeDeckVisualColumns('0'), 'auto');
  assert.equal(normalizeDeckVisualColumns('9'), 'auto');
  assert.equal(normalizeDeckVisualColumns('vier'), 'auto');
});

test('deckquery bewaart filters, kaartview en kolomkeuze samen', () => {
  assert.equal(deckDetailQueryString({
    cardSearch: '  Llanowar Elves  ',
    role: 'sideboard',
    cardType: 'Creature',
    view: 'cards',
    cardColumns: '7'
  }), 'cardSearch=Llanowar+Elves&role=sideboard&cardType=Creature&view=cards&cardColumns=7');
  assert.equal(deckDetailQueryString({ cardColumns: '9' }), '');
});

test('kaartacties verschillen correct voor Wanted en gegroepeerde basic lands', () => {
  const regular = deckCard({
    deckCardId: 61,
    cardId: 21,
    name: 'Wanted Creature',
    cardTypes: ['Creature'],
    typeLine: 'Creature',
    wantedGap: 2
  });
  assert.deepEqual(deckCardActionDescriptors(regular).map((action) => action.key), [
    'wanted', 'edit', 'insights', 'relations', 'remove'
  ]);
  assert.equal(deckCardActionDescriptors(regular)[0].label, '2 naar Wanted');
  assert.equal(deckCardActionDescriptors(regular).at(-1).destructive, true);
  assert.deepEqual(deckCardListActionDescriptors(regular).map((action) => action.key), [
    'wanted', 'edit', 'insights', 'relations', 'remove'
  ]);

  const forestA = deckCard({
    deckCardId: 71,
    cardId: 31,
    name: 'Forest',
    cardTypes: ['Land'],
    supertypes: ['Basic'],
    typeLine: 'Basic Land — Forest'
  });
  const forestB = deckCard({
    deckCardId: 72,
    cardId: 32,
    name: 'Forest',
    cardTypes: ['Land'],
    supertypes: ['Basic'],
    typeLine: 'Basic Land — Forest'
  });
  const groupedForest = {
    ...forestA,
    groupedBasicLand: true,
    displayMembers: [forestA, forestB]
  };
  assert.deepEqual(deckCardActionDescriptors(groupedForest).map((action) => action.key), ['printings', 'insights']);
  assert.equal(deckCardActionDescriptors(groupedForest)[0].write, false);
  assert.deepEqual(deckCardListActionDescriptors(groupedForest).map((action) => action.key), ['printings', 'insights']);

  const singleForest = { ...forestA, groupedBasicLand: true, displayMembers: [forestA] };
  assert.deepEqual(deckCardActionDescriptors(singleForest).map((action) => action.key), [
    'edit', 'insights', 'relations', 'remove'
  ]);
});
