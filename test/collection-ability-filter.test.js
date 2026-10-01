import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-collection-ability-'));
process.env.DATA_DIR = testDataDir;
process.env.DATABASE_FILE = 'test.sqlite';

const cardRepository = await import('../src/services/card-repository.js');
const cardInsightService = await import('../src/services/card-insight-service.js');
const database = await import('../src/db/database.js');

function createCard({ id, oracleId = id, name, oracleText = '', producedMana = [], keywords = [], typeLine = 'Creature — Test' }) {
  return cardRepository.upsertScryfallCard({
    id,
    oracle_id: oracleId,
    name,
    mana_cost: '',
    cmc: 1,
    colors: [],
    color_identity: [],
    produced_mana: producedMana,
    type_line: typeLine,
    oracle_text: oracleText,
    keywords,
    set: 'tst',
    set_name: 'Test Set',
    collector_number: id.slice(-2),
    rarity: 'common',
    lang: 'en',
    layout: 'normal',
    games: ['paper'],
    legalities: {},
    finishes: ['nonfoil'],
    prices: {}
  });
}

function addToCollection(card) {
  cardRepository.addCollectionItem({
    cardId: card.id,
    quantity: 1,
    finish: 'nonfoil',
    language: 'en',
    condition: 'near_mint',
    location: '',
    notes: '',
    purchasePrice: null,
    reconcileWanted: false,
    sourceWantedId: null
  });
}

const llanowar = createCard({
  id: '00000000-0000-4000-8000-000000000021',
  name: 'Llanowar Elves',
  producedMana: ['G']
});
const flying = createCard({
  id: '00000000-0000-4000-8000-000000000022',
  name: 'Flying Test',
  keywords: ['Flying']
});
const manualProducer = createCard({
  id: '00000000-0000-4000-8000-000000000023',
  name: 'Manual Producer'
});
const disabledProducer = createCard({
  id: '00000000-0000-4000-8000-000000000024',
  name: 'Disabled Producer',
  producedMana: ['C']
});
const oracleProducer = createCard({
  id: '00000000-0000-4000-8000-000000000025',
  name: 'Oracle Producer',
  oracleText: '{T}: Add {B}.'
});
const counterCard = createCard({
  id: '00000000-0000-4000-8000-000000000026',
  name: 'Counter Test',
  oracleText: 'Add a +1/+1 counter on target creature.'
});
const landTutor = createCard({
  id: '00000000-0000-4000-8000-000000000027',
  name: 'Basic Land Tutor',
  oracleText: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.'
});
const creatureTutor = createCard({
  id: '00000000-0000-4000-8000-000000000028',
  name: 'Creature Tutor',
  oracleText: 'Search your library for a creature card, reveal it, put it into your hand, then shuffle.'
});
const anyCardTutor = createCard({
  id: '00000000-0000-4000-8000-000000000029',
  name: 'Any Card Tutor',
  oracleText: 'Search your library for a card, put that card into your hand, then shuffle.'
});
const opponentsTutor = createCard({
  id: '00000000-0000-4000-8000-000000000030',
  name: 'Opponent Tutor',
  oracleText: "Target opponent searches their library for a creature card, reveals it, then shuffles."
});
const manualLandOverride = createCard({
  id: '00000000-0000-4000-8000-000000000031',
  name: 'Manual Land Override',
  oracleText: 'Search your library for a creature card, reveal it, put it into your hand, then shuffle.'
});
const disabledLandTutor = createCard({
  id: '00000000-0000-4000-8000-000000000032',
  name: 'Disabled Land Tutor',
  oracleText: 'Search your library for a Forest card, put it onto the battlefield tapped, then shuffle.'
});
const sharedTutorOracleId = '00000000-0000-4000-8000-000000000130';
const sharedTutorA = createCard({
  id: '00000000-0000-4000-8000-000000000033',
  oracleId: sharedTutorOracleId,
  name: 'Shared Manual Tutor'
});
const sharedTutorB = createCard({
  id: '00000000-0000-4000-8000-000000000034',
  oracleId: sharedTutorOracleId,
  name: 'Shared Manual Tutor'
});
const auraQualifierTutor = createCard({
  id: '00000000-0000-4000-8000-000000000035',
  name: 'Aura Qualifier Tutor',
  oracleText: 'Search your library for an Aura card with mana value 2 or less and with enchant creature, reveal it, put it into your hand, then shuffle.'
});
const genericCreatureQualifierTutor = createCard({
  id: '00000000-0000-4000-8000-000000000036',
  name: 'Generic Creature Qualifier Tutor',
  oracleText: "Search your library for a card with mana value less than or equal to target creature's power, reveal it, put it into your hand, then shuffle."
});
const mixedArtifactCreatureTutor = createCard({
  id: '00000000-0000-4000-8000-000000000037',
  name: 'Mixed Artifact Creature Tutor',
  oracleText: 'Search your library for an artifact or creature card, reveal it, put it into your hand, then shuffle.'
});
const genericLandTutor = createCard({
  id: '00000000-0000-4000-8000-000000000038',
  name: 'Generic Land Tutor',
  oracleText: 'Search your library for a land card, reveal it, put it into your hand, then shuffle.'
});

for (const card of [
  llanowar,
  flying,
  manualProducer,
  disabledProducer,
  oracleProducer,
  counterCard,
  landTutor,
  creatureTutor,
  anyCardTutor,
  opponentsTutor,
  manualLandOverride,
  disabledLandTutor,
  sharedTutorA,
  sharedTutorB,
  auraQualifierTutor,
  genericCreatureQualifierTutor,
  mixedArtifactCreatureTutor,
  genericLandTutor
]) addToCollection(card);
cardInsightService.updateCardUserMetadata(manualProducer.id, {
  manaMode: 'manual',
  manaProduction: [{ mana: 'R', amount: 1, variable: false }]
});
cardInsightService.updateCardUserMetadata(disabledProducer.id, {
  manaMode: 'manual',
  manaProduction: []
});
cardInsightService.updateCardUserMetadata(manualLandOverride.id, {
  searchMode: 'manual',
  librarySearchTargets: ['land']
});
cardInsightService.updateCardUserMetadata(disabledLandTutor.id, {
  searchMode: 'manual',
  librarySearchTargets: []
});
cardInsightService.updateCardUserMetadata(sharedTutorA.id, {
  searchMode: 'manual',
  librarySearchTargets: ['creature']
});

after(() => {
  database.closeDatabase();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('collectie-abilityfilter gebruikt mana-productie en handmatige correcties coherent', () => {
  const manaOption = cardRepository.collectionFilterOptions().abilities
    .find((entry) => entry.name === 'Mana produceren');
  assert.deepEqual(manaOption, { name: 'Mana produceren', cardCount: 3 });

  const manaItems = cardRepository.listCollection({ ability: 'Mana produceren', limit: 100 }).items;
  assert.deepEqual(manaItems.map((item) => item.card.name).sort(), [
    'Llanowar Elves',
    'Manual Producer',
    'Oracle Producer'
  ]);

  const flyingItems = cardRepository.listCollection({ ability: 'Flying', limit: 100 }).items;
  assert.deepEqual(flyingItems.map((item) => item.card.name), ['Flying Test']);
});

test('collectie-abilityfilters herkennen land- en creaturetutors zonder tekst-foutpositieven', () => {
  const abilities = cardRepository.collectionFilterOptions().abilities;
  assert.deepEqual(abilities.find((entry) => entry.name === 'Tutor land'), {
    name: 'Tutor land',
    cardCount: 3
  });
  assert.deepEqual(abilities.find((entry) => entry.name === 'Tutor creature'), {
    name: 'Tutor creature',
    cardCount: 3
  });

  const landItems = cardRepository.listCollection({ ability: 'Tutor land', limit: 100 }).items;
  assert.deepEqual(landItems.map((item) => item.card.name).sort(), [
    'Basic Land Tutor',
    'Generic Land Tutor',
    'Manual Land Override'
  ]);

  const creatureItems = cardRepository.listCollection({ ability: 'Tutor creature', limit: 100 }).items;
  assert.deepEqual(creatureItems.map((item) => item.card.name).sort(), [
    'Creature Tutor',
    'Mixed Artifact Creature Tutor',
    'Shared Manual Tutor',
    'Shared Manual Tutor'
  ]);
  assert.equal(creatureItems.some((item) => item.card.name === 'Opponent Tutor'), false);
  assert.equal(creatureItems.some((item) => item.card.name === 'Any Card Tutor'), false);
});

test('tutordoelen komen alleen uit de gezochte typefrase en niet uit latere beperkingen', () => {
  const cardsByName = new Map(cardRepository.listCollection({ limit: 100 }).items
    .map((item) => [item.card.name, item.card]));

  assert.deepEqual(
    cardsByName.get('Aura Qualifier Tutor').insights.librarySearch.targets,
    ['enchantment']
  );
  assert.deepEqual(
    cardsByName.get('Generic Creature Qualifier Tutor').insights.librarySearch.targets,
    ['other']
  );
  assert.deepEqual(
    cardsByName.get('Mixed Artifact Creature Tutor').insights.librarySearch.targets,
    ['creature', 'artifact']
  );

  const creatureNames = cardRepository.listCollection({ ability: 'Tutor creature', limit: 100 }).items
    .map((item) => item.card.name);
  assert.equal(creatureNames.includes('Aura Qualifier Tutor'), false);
  assert.equal(creatureNames.includes('Generic Creature Qualifier Tutor'), false);
  assert.equal(creatureNames.includes('Mixed Artifact Creature Tutor'), true);
});

test('handmatige tutorcorrecties gelden voor alle printings met dezelfde Oracle-identiteit', () => {
  const sharedItems = cardRepository.listCollection({ ability: 'Tutor creature', limit: 100 }).items
    .filter((item) => item.card.cardKey === sharedTutorOracleId);
  assert.equal(sharedItems.length, 2);
  assert.deepEqual(sharedItems.map((item) => item.card.insights.librarySearch.source), ['manual', 'manual']);

  const creatureItems = cardRepository.listCollection({ ability: 'Tutor creature', limit: 100 }).items;
  assert.equal(creatureItems.some((item) => item.card.name === 'Manual Land Override'), false);
  const landItems = cardRepository.listCollection({ ability: 'Tutor land', limit: 100 }).items;
  assert.equal(landItems.some((item) => item.card.name === 'Disabled Land Tutor'), false);
});
