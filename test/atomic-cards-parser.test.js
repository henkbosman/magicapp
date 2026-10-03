import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AtomicCardsParseError,
  parseAtomicCards
} from '../src/lib/atomic-cards-parser.js';
import {
  colorMask,
  detectCardCatalogFeatures,
  mapAtomicCardToCatalogRecord,
  normalizeLegalities,
  normalizeSearchText
} from '../src/lib/card-catalog-features.js';

async function* byteChunks(value, sizes = [1]) {
  const bytes = Buffer.from(value, 'utf8');
  let offset = 0;
  let sizeIndex = 0;
  while (offset < bytes.length) {
    const size = sizes[sizeIndex % sizes.length];
    yield bytes.subarray(offset, Math.min(offset + size, bytes.length));
    offset += size;
    sizeIndex += 1;
  }
}

test('AtomicCards parser handles every kind of chunk boundary and awaits groups', async () => {
  const document = JSON.stringify({
    meta: { version: '5.2.1+2026', note: 'bomen 🌳' },
    data: {
      'Café "Mage"': [{
        name: 'Café "Mage"',
        text: 'When this enters, create a token named "Twig".',
        nested: { array: [1, { braces: '} ] \\" still text' }] }
      }],
      'Æther Adept': [{ name: 'Æther Adept', colors: ['U'] }]
    }
  });
  const calls = [];
  let callbackActive = false;

  const summary = await parseAtomicCards(byteChunks(document, [1, 2, 3, 5]), {
    async onCardGroup(name, cards) {
      assert.equal(callbackActive, false);
      callbackActive = true;
      await new Promise((resolve) => setImmediate(resolve));
      calls.push([name, cards]);
      callbackActive = false;
    }
  });

  assert.equal(summary.meta.note, 'bomen 🌳');
  assert.equal(summary.groupCount, 2);
  assert.equal(summary.cardCount, 2);
  assert.deepEqual(calls.map(([name]) => name), ['Café "Mage"', 'Æther Adept']);
  assert.equal(calls[0][1][0].nested.array[1].braces, '} ] \\" still text');
});

test('AtomicCards parser permits top-level order differences and a UTF-8 BOM', async () => {
  const groups = [];
  const document = `\uFEFF${JSON.stringify({ data: { Forest: [{ name: 'Forest' }] }, meta: { date: '2026-10-03' } })}`;
  const summary = await parseAtomicCards(byteChunks(document, [2, 1, 4]), {
    onCardGroup(name, cards) {
      groups.push({ name, cards });
    }
  });
  assert.equal(summary.meta.date, '2026-10-03');
  assert.equal(groups[0].name, 'Forest');
});

test('AtomicCards parser rejects malformed and structurally invalid input', async () => {
  await assert.rejects(
    parseAtomicCards(byteChunks('{"meta":{},"data":{"Broken":[{"name":"Broken"}]}', [3])),
    (error) => error instanceof AtomicCardsParseError && error.code === 'INVALID_ATOMIC_CARDS_JSON'
  );
  await assert.rejects(
    parseAtomicCards('{"meta":{},"data":[]}'),
    (error) => error instanceof AtomicCardsParseError
  );
  await assert.rejects(
    parseAtomicCards('{"meta":{},"data":{"Broken":{"name":"Broken"}}}'),
    (error) => error instanceof AtomicCardsParseError && error.code === 'INVALID_ATOMIC_CARDS_STRUCTURE'
  );
  await assert.rejects(
    parseAtomicCards('{"meta":{},"data":{"Broken":[null]}}'),
    (error) => error instanceof AtomicCardsParseError && error.code === 'INVALID_ATOMIC_CARDS_STRUCTURE'
  );
  await assert.rejects(
    parseAtomicCards('{"meta":{}}'),
    (error) => error instanceof AtomicCardsParseError && error.code === 'INVALID_ATOMIC_CARDS_STRUCTURE'
  );
});

test('AtomicCards parser enforces bounded groups and nesting', async () => {
  const document = JSON.stringify({ meta: {}, data: { A: [{ name: 'A' }, { name: 'A' }] } });
  await assert.rejects(
    parseAtomicCards(document, { limits: { maxCardsPerGroup: 1 } }),
    (error) => error instanceof AtomicCardsParseError && error.code === 'ATOMIC_CARDS_LIMIT_EXCEEDED'
  );
  await assert.rejects(
    parseAtomicCards(document, { limits: { maxCardGroupBytes: 10 } }),
    (error) => error instanceof AtomicCardsParseError && error.code === 'ATOMIC_CARDS_LIMIT_EXCEEDED'
  );
  await assert.rejects(
    parseAtomicCards('{"meta":{"nested":{"again":true}},"data":{}}', { limits: { maxNestingDepth: 1 } }),
    (error) => error instanceof AtomicCardsParseError && error.code === 'ATOMIC_CARDS_LIMIT_EXCEEDED'
  );
});

test('feature mapper normalizes a green landfall creature-token card', () => {
  const record = mapAtomicCardToCatalogRecord({
    uuid: 'atomic-1',
    name: 'Felidar Retreat Example',
    manaCost: '{3}{G}',
    manaValue: 4,
    colors: ['Green', 'G'],
    colorIdentity: ['G'],
    type: 'Legendary Enchantment — Retreat',
    text: 'Landfall — Whenever a land enters the battlefield under your control, create a 2/2 green Cat Beast creature token.',
    keywords: ['Landfall', 'landfall'],
    legalities: { commander: 'Legal', modern: 'Not Legal' },
    identifiers: { scryfallOracleId: 'oracle-1' }
  }, { sourceKey: 'Felidar Retreat Example', variantIndex: 0 });

  assert.equal(record.id, 'oracle-1');
  assert.equal(record.catalogKey, 'oracle-1');
  assert.deepEqual(record.colors, ['G']);
  assert.equal(record.colorMask, 16);
  assert.deepEqual(record.types, ['Enchantment']);
  assert.deepEqual(record.subtypes, ['Retreat']);
  assert.equal(record.effects.hasLandfall, true);
  assert.equal(record.effects.createsCreatureToken, true);
  assert.deepEqual(record.effects.tokenStats, [{ power: '2', toughness: '2', tokenType: 'Cat Beast' }]);
  assert.equal(record.tokenPower, '2');
  assert.equal(record.tokenToughness, '2');
  assert.match(record.searchText, /landfall/);
  assert.equal(record.legalities.modern, 'not_legal');
  assert.equal(record.scryfallOracleId, 'oracle-1');
});

test('catalog key prefers Oracle identity over printing UUID and name fallback', () => {
  const firstPrinting = mapAtomicCardToCatalogRecord({
    uuid: 'printing-a',
    name: 'Shared Card',
    identifiers: { scryfallOracleId: 'shared-oracle' }
  }, { sourceKey: 'Shared Card', variantIndex: 0 });
  const secondPrinting = mapAtomicCardToCatalogRecord({
    uuid: 'printing-b',
    name: 'Shared Card',
    identifiers: { scryfallOracleId: 'shared-oracle' }
  }, { sourceKey: 'Shared Card', variantIndex: 1 });
  const differentIdentity = mapAtomicCardToCatalogRecord({
    uuid: 'printing-c',
    name: 'Shared Card',
    identifiers: { scryfallOracleId: 'other-oracle' }
  }, { sourceKey: 'Shared Card', variantIndex: 2 });
  const uuidFallback = mapAtomicCardToCatalogRecord({
    uuid: 'uuid-only',
    name: 'No Oracle Id'
  }, { sourceKey: 'No Oracle Id', variantIndex: 0 });
  const sourceFallback = mapAtomicCardToCatalogRecord({ name: 'No Id' }, {
    sourceKey: 'No Id',
    variantIndex: 3
  });

  assert.equal(firstPrinting.catalogKey, 'shared-oracle');
  assert.equal(secondPrinting.catalogKey, firstPrinting.catalogKey);
  assert.notEqual(differentIdentity.catalogKey, firstPrinting.catalogKey);
  assert.equal(uuidFallback.catalogKey, 'uuid-only');
  assert.equal(sourceFallback.catalogKey, 'No Id::3');
});

test('feature detector distinguishes own tutors and useful deck-building effects', () => {
  const landTutor = detectCardCatalogFeatures({
    text: 'Sacrifice this permanent: Search your library for a basic land card, put it onto the battlefield, then shuffle. Draw a card.'
  });
  assert.equal(landTutor.isTutor, true);
  assert.equal(landTutor.tutorsBasicLand, true);
  assert.equal(landTutor.tutorsLand, true);
  assert.deepEqual(landTutor.tutorTargets, ['basic_land', 'land']);
  assert.equal(landTutor.tutorsCreature, false);
  assert.equal(landTutor.sacrifice, true);
  assert.equal(landTutor.drawsCards, true);

  const generalTutor = detectCardCatalogFeatures({
    text: 'Search your library for a card with mana value 3 or less, reveal it, put it into your hand, then shuffle.'
  });
  assert.equal(generalTutor.isTutor, true);
  assert.equal(generalTutor.tutorsAnyCard, true);

  const opponentSearch = detectCardCatalogFeatures({
    text: 'Target opponent searches their library for a creature card, reveals it, then shuffles.'
  });
  assert.equal(opponentSearch.isTutor, false);
  assert.equal(opponentSearch.tutorsCreature, false);

  const creatureTutor = detectCardCatalogFeatures({
    text: 'Search your library for an artifact or creature card, reveal it, put it into your hand, then shuffle.'
  });
  assert.equal(creatureTutor.tutorsCreature, true);
  assert.equal(creatureTutor.tutorsArtifact, true);
  assert.equal(creatureTutor.tutorsAnyCard, false);
  assert.deepEqual(creatureTutor.tutorTargets, ['creature', 'artifact']);

  const spellTutor = detectCardCatalogFeatures({
    text: 'Search your library for an enchantment, instant, sorcery, or planeswalker card, reveal it, then shuffle.'
  });
  assert.equal(spellTutor.tutorsEnchantment, true);
  assert.equal(spellTutor.tutorsInstant, true);
  assert.equal(spellTutor.tutorsSorcery, true);
  assert.equal(spellTutor.tutorsPlaneswalker, true);
  assert.deepEqual(spellTutor.tutorTargets, ['enchantment', 'instant', 'sorcery', 'planeswalker']);
});

test('feature detector finds mana, removal, graveyard, sacrifice, draw and counters', () => {
  const features = detectCardCatalogFeatures({
    text: '{T}: Add {G}. Sacrifice a creature: Draw two cards. Return target creature to its owner\'s hand. Return a permanent card from your graveyard to your hand. Put two +1/+1 counters on target creature.',
    producedMana: ['{G}', 'C']
  });
  assert.equal(features.producesMana, true);
  assert.equal(features.drawsCards, true);
  assert.equal(features.removal, true);
  assert.equal(features.graveyard, true);
  assert.equal(features.sacrifice, true);
  assert.equal(features.counters, true);
  assert.deepEqual(features.tags, ['mana_production', 'card_draw', 'removal', 'graveyard', 'sacrifice', 'counters']);
});

test('feature detector recognizes temporary and static power/toughness pumps', () => {
  const temporary = detectCardCatalogFeatures({
    text: 'Target creature gets +2/+2 and gains trample until end of turn.'
  });
  const anthem = detectCardCatalogFeatures({
    text: 'Other creatures you control get +1/+1.'
  });
  const negative = detectCardCatalogFeatures({
    text: 'Put two +1/+1 counters on target creature.'
  });
  assert.equal(temporary.pump, true);
  assert.ok(temporary.tags.includes('pump'));
  assert.equal(anthem.pump, true);
  assert.equal(negative.pump, false);
});

test('normalizers are deterministic and accent-insensitive', () => {
  assert.equal(normalizeSearchText('Æther Café — +1/+1'), 'æther cafe - +1/+1');
  assert.equal(colorMask(['Blue', 'G', 'U']), 18);
  assert.deepEqual(normalizeLegalities({ Legacy: 'Banned', 'Pauper Commander': 'Not Legal' }), {
    legacy: 'banned',
    pauper_commander: 'not_legal'
  });
});
