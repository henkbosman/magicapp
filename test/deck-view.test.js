import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    assert.match(view.html, /<div class="deck-filter-controls">[\s\S]*?id="deck-filter-toggle"[\s\S]*?<label id="deck-cards-per-row-control"[\s\S]*?<select id="deck-cards-per-row"[\s\S]*?<\/label>\s*<\/div>\s*<span id="deck-filter-summary"/);
    assert.match(view.html, /id="deck-cards-per-row"[\s\S]*?<option value="5" selected>5<\/option>/);
    assert.doesNotMatch(view.html, /<option value="auto"|>Automatisch<\/option>/);
    assert.match(view.html, /id="deck-card-visual" class="deck-visual-groups" data-columns="5"/);
    assert.doesNotMatch(view.html, /deck-visual-toolbar/);
    assert.match(view.html, /data-card-preview-id="11"/);
    assert.doesNotMatch(view.html, /data-deck-card-context-actions/);
    assert.doesNotMatch(view.html, /•••/);
    assert.match(view.html, /aria-keyshortcuts="Shift\+F10"/);
    assert.match(view.html, /aria-label="Toon grotere versie van Artifact Creature, 2 exemplaren"/);
    assert.match(view.html, /class="deck-visual-card-quantity" aria-hidden="true">2&times;<\/span>/);
    assert.match(view.html, /class="button secondary small open-deck-card-actions"/);
    assert.match(view.html, /aria-label="Acties voor Artifact Creature">Acties<\/button>/);
    assert.match(view.html, /class="deck-card-rules-text oracle-text">[\s\S]*?aria-label="Tappen"[\s\S]*?aria-label="Groen mana"/);
    assert.match(view.html, /class="deck-card-name-mana">[\s\S]*?class="deck-card-name-slot">[\s\S]*?Artifact Creature[\s\S]*?class="deck-card-mana-slot">[\s\S]*?aria-label="Manakosten \{1\}"/);
    assert.match(view.html, /class="deck-card-name-slot"><strong>2× Artifact Creature<\/strong><\/span>/);
    assert.doesNotMatch(view.html, /class="deck-card-name-preview"/);
    assert.match(view.html, /<button type="button" class="card-thumb-link deck-card-preview-trigger"[^>]+data-card-preview-id="11"/);
    assert.doesNotMatch(view.html, /class="[^\"]*manage-deck-relations/);
    assert.doesNotMatch(view.html, /class="[^\"]*remove-deck-card/);
    assert.doesNotMatch(view.html, />Meer<\/button>/);
    assert.doesNotMatch(view.html, /class="[^"]*deck-card-to-wanted/);
    assert.doesNotMatch(view.html, /class="[^"]*edit-deck-card-insights/);
    assert.doesNotMatch(view.html, /class="[^"]*edit-deck-card(?:\s|")/);

    const listView = await renderDeckDetail({
      params: { id: '7' },
      query: new URLSearchParams()
    });
    assert.match(listView.html, /id="deck-cards-per-row-control"[^>]*\shidden(?:\s|>)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('kaarten-per-rij-keuze staat compact naast de filterknop en kan responsief omslaan', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.deck-filter-controls\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
  assert.match(styles, /\.deck-cards-per-row-control\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
  assert.match(styles, /\.deck-cards-per-row-control select\s*\{[^}]*width:\s*76px;[^}]*height:\s*42px;/s);
});

test('decklijst geeft de naam flexibele ruimte en lijnt mana aan de rechterrand uit', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.deck-card-title-row > div\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  assert.match(styles, /\.deck-card-name-mana\s*\{[^}]*width:\s*100%;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) max-content;/s);
  assert.match(styles, /\.deck-card-mana-slot\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/s);
  assert.match(styles, /\.deck-card-mana-slot \.mana-cost\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*justify-content:\s*flex-end;/s);
  assert.match(styles, /@media \(min-width:\s*641px\) and \(max-width:\s*1279px\)[\s\S]*?#deck-card-list > \.deck-card-row/);
  assert.match(styles, /\.oracle-text \.mana-symbol\s*\{[^}]*vertical-align:\s*-\.2em;/s);
  assert.doesNotMatch(styles, /\.oracle-text \.mana-symbol\.mana-bg-(?:C|generic)\s*\{/);
});

test('deckkolommen gebruiken standaard vijf en accepteren één tot en met acht', () => {
  assert.equal(normalizeDeckVisualColumns(), '5');
  assert.equal(normalizeDeckVisualColumns(null), '5');
  assert.equal(normalizeDeckVisualColumns('auto'), '5');
  assert.equal(normalizeDeckVisualColumns('1'), '1');
  assert.equal(normalizeDeckVisualColumns('5'), '5');
  assert.equal(normalizeDeckVisualColumns('8'), '8');
  assert.equal(normalizeDeckVisualColumns('0'), '5');
  assert.equal(normalizeDeckVisualColumns('9'), '5');
  assert.equal(normalizeDeckVisualColumns('vier'), '5');
});

test('deckquery bewaart filters, kaartview en kolomkeuze samen', () => {
  assert.equal(deckDetailQueryString({
    cardSearch: '  Llanowar Elves  ',
    role: 'sideboard',
    cardType: 'Creature',
    view: 'cards',
    cardColumns: '7'
  }), 'cardSearch=Llanowar+Elves&role=sideboard&cardType=Creature&view=cards&cardColumns=7');
  assert.equal(deckDetailQueryString({ view: 'cards' }), 'view=cards');
  assert.equal(deckDetailQueryString({ cardColumns: '5' }), '');
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
