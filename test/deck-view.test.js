import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  compareDeckCards,
  deckCardActionDescriptors,
  deckCardListActionDescriptors,
  deckDetailQueryString,
  groupDeckCards,
  normalizeDeckCardGroup,
  normalizeDeckCardSort,
  normalizeDeckVisualColumns,
  primaryDeckCardAbility,
  renderDeckDetail
} from '../public/js/views/deck-detail.js';

function deckCard({ deckCardId, cardId, name, cardTypes, typeLine, oracleText = '', printedText = '', quantity = 1, role = 'main', wantedGap = 0, supertypes = [], manaValue = 1, keywords = [], insights }) {
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
      keywords,
      insights,
      manaCost: '{1}',
      manaValue,
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
    deckCard({ deckCardId: 51, cardId: 11, name: 'Artifact Creature', cardTypes: ['Artifact', 'Creature'], typeLine: 'Artifact Creature', oracleText: 'Flying\n{T}: Add {G}.', keywords: ['Trample', 'Flying'], quantity: 2 }),
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
    assert.match(view.html, /id="deck-filter-toggle"[\s\S]*?<label class="deck-list-order-control" for="deck-card-sort">[\s\S]*?<select id="deck-card-sort">[\s\S]*?<option value="mana" selected>Mana kosten<\/option>/);
    assert.match(view.html, /<label class="deck-list-order-control" for="deck-card-group">[\s\S]*?<select id="deck-card-group">[\s\S]*?<option value="type" selected>Type<\/option>/);
    assert.match(view.html, /id="deck-card-list"[\s\S]*?data-deck-card-group[\s\S]*?data-deck-type-group="Creature"/);
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

    const abilityView = await renderDeckDetail({
      params: { id: '7' },
      query: new URLSearchParams('cardSort=name&cardGroup=ability')
    });
    assert.match(abilityView.html, /id="deck-card-sort">[\s\S]*?<option value="name" selected>Naam kaart<\/option>/);
    assert.match(abilityView.html, /id="deck-card-group">[\s\S]*?<option value="ability" selected>Ability<\/option>/);
    assert.equal((abilityView.html.match(/data-deck-ability-group="Flying"/g) || []).length, 2);
    assert.equal((abilityView.html.match(/data-deck-ability-group="Geen ability"/g) || []).length, 2);
    assert.doesNotMatch(abilityView.html, /data-deck-type-group=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('kaarten-per-rij-keuze staat compact naast de filterknop en kan responsief omslaan', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.deck-filter-controls\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
  assert.match(styles, /\.deck-list-order-control\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
  assert.match(styles, /\.deck-list-order-control select\s*\{[^}]*min-width:\s*128px;[^}]*height:\s*42px;/s);
  assert.match(styles, /\.deck-cards-per-row-control\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
  assert.match(styles, /\.deck-cards-per-row-control select\s*\{[^}]*width:\s*76px;[^}]*height:\s*42px;/s);
});

test('decklijst geeft de naam flexibele ruimte en lijnt mana aan de rechterrand uit', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.deck-card-title-row > div\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  assert.match(styles, /\.deck-card-name-mana\s*\{[^}]*width:\s*100%;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) max-content;/s);
  assert.match(styles, /\.deck-card-mana-slot\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/s);
  assert.match(styles, /\.deck-card-mana-slot \.mana-cost\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*justify-content:\s*flex-end;/s);
  assert.match(styles, /@media \(min-width:\s*641px\) and \(max-width:\s*1279px\)[\s\S]*?#deck-card-list \.deck-card-row/);
  assert.doesNotMatch(styles, /#deck-card-list\s*>\s*\.deck-card-row/);
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

test('decksortering en -groepering normaliseren naar veilige standaardwaarden', () => {
  assert.equal(normalizeDeckCardSort(), 'mana');
  assert.equal(normalizeDeckCardSort('mana'), 'mana');
  assert.equal(normalizeDeckCardSort('name'), 'name');
  assert.equal(normalizeDeckCardSort('onbekend'), 'mana');
  assert.equal(normalizeDeckCardGroup(), 'type');
  assert.equal(normalizeDeckCardGroup('type'), 'type');
  assert.equal(normalizeDeckCardGroup('ability'), 'ability');
  assert.equal(normalizeDeckCardGroup('onbekend'), 'type');
});

test('deckquery bewaart filters, kaartview en kolomkeuze samen', () => {
  assert.equal(deckDetailQueryString({
    cardSearch: '  Llanowar Elves  ',
    role: 'sideboard',
    cardType: 'Creature',
    view: 'cards',
    cardColumns: '7',
    cardSort: 'name',
    cardGroup: 'ability'
  }), 'cardSearch=Llanowar+Elves&role=sideboard&cardType=Creature&view=cards&cardColumns=7&cardSort=name&cardGroup=ability');
  assert.equal(deckDetailQueryString({ view: 'cards' }), 'view=cards');
  assert.equal(deckDetailQueryString({ cardColumns: '5', cardSort: 'mana', cardGroup: 'type' }), '');
  assert.equal(deckDetailQueryString({ cardColumns: '9', cardSort: 'anders', cardGroup: 'anders' }), '');
});

test('deckkaarten sorteren deterministisch op mana of Nederlandse kaartnaam', () => {
  const zebra = deckCard({ deckCardId: 83, cardId: 43, name: 'Zebra 10', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 0 });
  const beta = deckCard({ deckCardId: 82, cardId: 42, name: 'Bèta', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 2 });
  const alpha = deckCard({ deckCardId: 81, cardId: 41, name: 'Alpha', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 4 });
  const cards = [alpha, zebra, beta];

  assert.deepEqual([...cards].sort((left, right) => compareDeckCards(left, right, 'mana')).map((item) => item.card.name), ['Zebra 10', 'Bèta', 'Alpha']);
  assert.deepEqual([...cards].sort((left, right) => compareDeckCards(left, right, 'name')).map((item) => item.card.name), ['Alpha', 'Bèta', 'Zebra 10']);
  assert.deepEqual(cards.map((item) => item.card.name), ['Alpha', 'Zebra 10', 'Bèta']);

  const sameMana = [
    deckCard({ deckCardId: 92, cardId: 52, name: 'Kaart 10', cardTypes: ['Instant'], typeLine: 'Instant', manaValue: 3 }),
    deckCard({ deckCardId: 91, cardId: 51, name: 'Kaart 2', cardTypes: ['Instant'], typeLine: 'Instant', manaValue: 3 })
  ];
  assert.deepEqual([...sameMana].sort((left, right) => compareDeckCards(left, right, 'mana')).map((item) => item.card.name), ['Kaart 2', 'Kaart 10']);

  const tieBreakers = [
    deckCard({ deckCardId: 113, cardId: 73, name: 'Gelijk', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 2, role: 'sideboard' }),
    deckCard({ deckCardId: 112, cardId: 72, name: 'Gelijk', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 2, role: 'main' }),
    deckCard({ deckCardId: 111, cardId: 71, name: 'Gelijk', cardTypes: ['Creature'], typeLine: 'Creature', manaValue: 2, role: 'main' })
  ];
  assert.deepEqual([...tieBreakers].sort((left, right) => compareDeckCards(left, right, 'mana')).map((item) => item.id), [111, 112, 113]);
});

test('typegroepering behoudt de vaste typevolgorde en sorteert binnen iedere groep', () => {
  const input = [
    deckCard({ deckCardId: 123, cardId: 83, name: 'Zeta Instant', cardTypes: ['Instant'], typeLine: 'Instant', manaValue: 4 }),
    deckCard({ deckCardId: 124, cardId: 84, name: 'Mysterie', cardTypes: [], typeLine: 'Card', manaValue: 0 }),
    deckCard({ deckCardId: 122, cardId: 82, name: 'Beta Land', cardTypes: ['Land'], typeLine: 'Land', manaValue: 0 }),
    deckCard({ deckCardId: 121, cardId: 81, name: 'Alpha Creature', cardTypes: ['Artifact', 'Creature'], typeLine: 'Artifact Creature', manaValue: 3 })
  ];
  const groups = groupDeckCards(input, { groupBy: 'type', sortBy: 'name' });
  assert.deepEqual(groups.map((group) => group.value), ['Creature', 'Land', 'Instant', 'Overig']);
  assert.deepEqual(input.map((item) => item.id), [123, 124, 122, 121]);
});

test('abilitygroepering kiest per kaart één primaire keyword en zet kaarten zonder ability als laatste', () => {
  const flyingFirst = deckCard({
    deckCardId: 101,
    cardId: 61,
    name: 'Flying First',
    cardTypes: ['Creature'],
    typeLine: 'Creature',
    oracleText: 'FLYING\nThis creature has trample while attacking.',
    keywords: ['Trample', 'Flying'],
    manaValue: 3
  });
  const alphabeticalFallback = deckCard({
    deckCardId: 102,
    cardId: 62,
    name: 'Fallback',
    cardTypes: ['Creature'],
    typeLine: 'Creature',
    oracleText: 'Geen van de keywords staat letterlijk in deze tekst.',
    keywords: ['Ward', 'Deathtouch'],
    manaValue: 2
  });
  const none = deckCard({ deckCardId: 103, cardId: 63, name: 'Vanilla', cardTypes: ['Creature'], typeLine: 'Creature', keywords: [], manaValue: 1 });

  assert.equal(primaryDeckCardAbility(flyingFirst.card), 'Flying');
  assert.equal(primaryDeckCardAbility(alphabeticalFallback.card), 'Deathtouch');
  assert.equal(primaryDeckCardAbility(none.card), 'Geen ability');

  const groups = groupDeckCards([none, flyingFirst, alphabeticalFallback], { groupBy: 'ability', sortBy: 'mana' });
  assert.deepEqual(groups.map((group) => group.label), ['Deathtouch', 'Flying', 'Geen ability']);
  assert.deepEqual(groups.flatMap((group) => group.items.map((item) => item.id)), [102, 101, 103]);
  assert.equal(new Set(groups.flatMap((group) => group.items.map((item) => item.id))).size, 3);
});

test('abilitygroepering gebruikt bestaande functionele inzichten als vaste fallback zonder duplicaten', () => {
  const manaProducer = deckCard({
    deckCardId: 104,
    cardId: 64,
    name: 'Elf Mana Producer',
    cardTypes: ['Creature'],
    typeLine: 'Creature — Elf Druid',
    oracleText: '{T}: Add {G}.',
    insights: {
      manaProduction: { entries: [{ mana: 'G', amount: 1, variable: false }] },
      librarySearch: { targets: ['land', 'creature'] }
    }
  });
  const basicLandTutor = deckCard({
    deckCardId: 105,
    cardId: 65,
    name: 'Basic Land Tutor',
    cardTypes: ['Sorcery'],
    typeLine: 'Sorcery',
    insights: {
      manaProduction: { entries: [] },
      librarySearch: { targets: ['basic_land', 'creature'] }
    }
  });
  const creatureTutor = deckCard({
    deckCardId: 106,
    cardId: 66,
    name: 'Creature Tutor',
    cardTypes: ['Sorcery'],
    typeLine: 'Sorcery',
    insights: {
      manaProduction: { entries: [] },
      librarySearch: { targets: ['creature'] }
    }
  });
  const keywordFirst = deckCard({
    deckCardId: 107,
    cardId: 67,
    name: 'Keyword Producer',
    cardTypes: ['Creature'],
    typeLine: 'Creature',
    oracleText: 'Flying\n{T}: Add {G}.',
    keywords: ['Flying'],
    insights: {
      manaProduction: { entries: [{ mana: 'G', amount: 1, variable: false }] },
      librarySearch: { targets: ['land'] }
    }
  });
  const manualEmpty = deckCard({
    deckCardId: 108,
    cardId: 68,
    name: 'Handmatig Leeg',
    cardTypes: ['Creature'],
    typeLine: 'Creature',
    oracleText: '{T}: Add {G}. Search your library for a creature card.',
    insights: {
      manaProduction: { source: 'manual', entries: [] },
      librarySearch: { source: 'manual', targets: [] }
    }
  });

  assert.equal(primaryDeckCardAbility(manaProducer.card), 'Mana produceren');
  assert.equal(primaryDeckCardAbility(basicLandTutor.card), 'Tutor land');
  assert.equal(primaryDeckCardAbility(creatureTutor.card), 'Tutor creature');
  assert.equal(primaryDeckCardAbility(keywordFirst.card), 'Flying');
  assert.equal(primaryDeckCardAbility(manualEmpty.card), 'Geen ability');

  const cards = [manualEmpty, creatureTutor, keywordFirst, basicLandTutor, manaProducer];
  const groups = groupDeckCards(cards, { groupBy: 'ability', sortBy: 'name' });
  assert.deepEqual(groups.map((group) => group.label), [
    'Flying',
    'Mana produceren',
    'Tutor creature',
    'Tutor land',
    'Geen ability'
  ]);
  assert.deepEqual(
    [...groups.flatMap((group) => group.items.map((item) => item.id))].sort((left, right) => left - right),
    [104, 105, 106, 107, 108]
  );
});

test('deckfilters doorzoeken geneste lijstgroepen en werken groepsaantallen in beide views bij', () => {
  const source = readFileSync(new URL('../public/js/views/deck-detail.js', import.meta.url), 'utf8');
  assert.match(source, /querySelectorAll\('#deck-card-list \[data-deck-filter-card\]'\)/);
  assert.doesNotMatch(source, /querySelectorAll\('#deck-card-list > \[data-deck-filter-card\]'\)/);
  assert.match(source, /querySelectorAll\('#deck-card-list \[data-deck-card-group\], #deck-card-visual \[data-deck-card-group\]'\)/);
  assert.match(source, /visible \+= Number\(row\.dataset\.quantity \|\| 0\)/);
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
