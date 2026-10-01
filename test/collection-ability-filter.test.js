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

function createCard({ id, name, oracleText = '', producedMana = [], keywords = [] }) {
  return cardRepository.upsertScryfallCard({
    id,
    oracle_id: id,
    name,
    mana_cost: '',
    cmc: 1,
    colors: [],
    color_identity: [],
    produced_mana: producedMana,
    type_line: 'Creature — Test',
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

for (const card of [llanowar, flying, manualProducer, disabledProducer, oracleProducer, counterCard]) addToCollection(card);
cardInsightService.updateCardUserMetadata(manualProducer.id, {
  manaMode: 'manual',
  manaProduction: [{ mana: 'R', amount: 1, variable: false }]
});
cardInsightService.updateCardUserMetadata(disabledProducer.id, {
  manaMode: 'manual',
  manaProduction: []
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
