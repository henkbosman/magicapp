import { getDeckCards, requireDeck } from './deck-service.js';
import { isBasicLand } from '../lib/card-rules.js';
import { listDeckCardLinks } from './deck-link-service.js';

const COUNTED_ROLES = new Set(['commander', 'partner', 'main']);
const PERMANENT_TYPES = new Set(['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker']);
const RELEVANT_KEYWORDS = [
  'Flying', 'Reach', 'Trample', 'Haste', 'Vigilance', 'Deathtouch', 'Lifelink',
  'Hexproof', 'Indestructible', 'Ward', 'Menace', 'First strike', 'Double strike',
  'Defender', 'Flash', 'Protection'
];
const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12
};

function increment(target, key, amount) {
  target[key] = (target[key] || 0) + amount;
}

function emptyManaCurve() {
  return { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7+': 0 };
}

function numericStat(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxAllowedCopies(card) {
  if (card.cardTypes.includes('Land') && card.supertypes.includes('Basic')) return Number.POSITIVE_INFINITY;
  const text = card.oracleText || '';
  if (/a deck can have any number of cards named/i.test(text)) return Number.POSITIVE_INFINITY;
  const numeric = text.match(/a deck can have up to (\d+) cards named/i);
  if (numeric) return Number(numeric[1]);
  const word = text.match(/a deck can have up to ([a-z]+) cards named/i);
  if (word && NUMBER_WORDS[word[1].toLowerCase()]) return NUMBER_WORDS[word[1].toLowerCase()];
  return 1;
}

function commanderIdentity(deck, items) {
  const commanders = items.filter((item) => item.role === 'commander' || item.role === 'partner');
  const identity = new Set(commanders.flatMap((item) => item.card.colorIdentity));
  return { commanders, identity };
}

function validateCommanderDeck(deck, items, totalCards) {
  if (deck.format.toLowerCase() !== 'commander') return [];
  const issues = [];
  const { commanders, identity } = commanderIdentity(deck, items);

  if (!commanders.length) {
    issues.push({ severity: 'error', code: 'missing_commander', message: 'Er is nog geen commander ingesteld.' });
  }
  if (totalCards !== 100) {
    issues.push({ severity: 'warning', code: 'deck_size', message: `Een Commander-deck bevat normaal 100 kaarten; dit deck bevat ${totalCards}.` });
  }

  for (const commander of commanders) {
    const card = commander.card;
    const canBeCommander =
      (card.supertypes.includes('Legendary') && card.cardTypes.includes('Creature')) ||
      /can be your commander/i.test(card.oracleText || '') ||
      /choose a background/i.test(card.oracleText || '') ||
      card.subtypes.includes('Background');
    if (!canBeCommander) {
      issues.push({ severity: 'warning', code: 'commander_type', cardId: card.id, message: `${card.name} lijkt op basis van de lokale kaarttekst geen geldige commander.` });
    }
    if (card.legalities.commander && card.legalities.commander !== 'legal') {
      issues.push({ severity: 'error', code: 'commander_legality', cardId: card.id, message: `${card.name} is niet Commander-legal (${card.legalities.commander}).` });
    }
  }

  if (commanders.length > 1) {
    const combinedText = commanders.map((item) => `${item.card.keywords.join(' ')} ${item.card.oracleText}`).join(' ');
    const pairingHint = /partner|friends forever|doctor's companion|choose a background/i.test(combinedText) || commanders.some((item) => item.card.subtypes.includes('Background'));
    if (!pairingHint) {
      issues.push({ severity: 'warning', code: 'commander_pair', message: 'Er zijn twee commanders ingesteld, maar de lokale kaartdata toont geen duidelijke Partner/Background-constructie.' });
    }
  }

  const quantitiesByKey = new Map();
  for (const item of items) {
    if (!COUNTED_ROLES.has(item.role)) continue;
    if (!quantitiesByKey.has(item.card.cardKey)) quantitiesByKey.set(item.card.cardKey, { quantity: 0, card: item.card });
    quantitiesByKey.get(item.card.cardKey).quantity += item.quantity;
  }

  for (const { quantity, card } of quantitiesByKey.values()) {
    const max = maxAllowedCopies(card);
    if (quantity > max) {
      issues.push({ severity: 'error', code: 'singleton', cardId: card.id, message: `${card.name} staat ${quantity} keer in het deck; op basis van de kaarttekst zijn maximaal ${max} exemplaren toegestaan.` });
    }
    if (card.legalities.commander && card.legalities.commander !== 'legal') {
      issues.push({ severity: 'error', code: 'legality', cardId: card.id, message: `${card.name} is niet Commander-legal (${card.legalities.commander}).` });
    }
    const outsideIdentity = card.colorIdentity.filter((color) => !identity.has(color));
    if (commanders.length && outsideIdentity.length) {
      issues.push({ severity: 'error', code: 'color_identity', cardId: card.id, message: `${card.name} valt buiten de color identity van de commander (${outsideIdentity.join('/')}).` });
    }
  }
  return issues;
}

function countManaSymbols(manaCost, quantity, target) {
  const symbols = String(manaCost || '').match(/\{[^}]+\}/g) || [];
  for (const symbol of symbols) {
    for (const color of Object.keys(COLOR_NAMES)) {
      if (new RegExp(`(^|[/])${color}($|[/}])`).test(symbol.slice(1))) increment(target, color, quantity);
    }
  }
}

export function calculateDeckStats(deckId, { excludeLandsFromAverage = true } = {}) {
  const deck = requireDeck(deckId);
  const allItems = getDeckCards(deckId);
  const items = allItems.filter((item) => COUNTED_ROLES.has(item.role));
  const linkGroups = listDeckCardLinks(deckId);

  const stats = {
    deck,
    totals: {
      cards: 0,
      uniqueCards: new Set(items.map((item) => item.card.cardKey)).size,
      legendary: 0,
      permanents: 0,
      nonPermanents: 0
    },
    types: {},
    manaCurve: emptyManaCurve(),
    manaCurveByColor: {
      W: emptyManaCurve(),
      U: emptyManaCurve(),
      B: emptyManaCurve(),
      R: emptyManaCurve(),
      G: emptyManaCurve(),
      C: emptyManaCurve(),
      M: emptyManaCurve()
    },
    manaValue: { averageExcludingLands: 0, averageIncludingLands: 0, selectedAverage: 0, excludeLandsFromAverage },
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0 },
    colorIdentity: { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0 },
    manaSymbols: { W: 0, U: 0, B: 0, R: 0, G: 0 },
    lands: { total: 0, basic: 0, nonBasic: 0, ratio: 0, produces: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ANY: 0 } },
    functions: {
      manaProducerCardLines: 0,
      manaProducerQuantity: 0,
      variableManaProducers: 0,
      manaByType: {},
      manaProducers: [],
      librarySearchCardLines: 0,
      librarySearchQuantity: 0,
      librarySearchByTarget: {},
      librarySearchCards: []
    },
    creatures: { total: 0, averagePower: null, averageToughness: null, legendary: 0, manaCurve: {}, topSubtypes: [], keywords: {} },
    tags: {},
    coverage: { total: 0, eligibleCards: 0, ownedCards: 0, basicLandsExcluded: 0, physicallyOwned: 0, assumedBasicLands: 0, directlyOwned: 0, missingFromCollection: 0, globalShortage: 0, onWanted: 0, notOnWanted: 0, percentage: 0, conflicts: [] },
    links: {
      totalGroups: 0,
      combos: 0,
      synergies: 0,
      linkedCards: 0,
      unlinkedCards: 0,
      cardsInCombos: 0,
      cardsInSynergies: 0,
      cardsInMultipleGroups: 0,
      memberships: 0,
      averageGroupSize: 0,
      largestGroupSize: 0,
      largestGroupName: '',
      participationPercentage: 0,
      byType: {},
      groupSizes: {},
      groups: []
    },
    validation: []
  };

  let manaTotalAll = 0;
  let manaCountAll = 0;
  let manaTotalNonland = 0;
  let manaCountNonland = 0;
  let powerTotal = 0;
  let powerCount = 0;
  let toughnessTotal = 0;
  let toughnessCount = 0;
  const subtypeCounts = {};
  const coverageByKey = new Map();

  for (const item of items) {
    const { card, quantity } = item;
    const isLand = card.cardTypes.includes('Land');
    const isCreature = card.cardTypes.includes('Creature');
    stats.totals.cards += quantity;
    if (card.supertypes.includes('Legendary')) stats.totals.legendary += quantity;
    if (card.cardTypes.some((type) => PERMANENT_TYPES.has(type))) stats.totals.permanents += quantity;
    else stats.totals.nonPermanents += quantity;

    for (const type of card.cardTypes.length ? card.cardTypes : ['Other']) increment(stats.types, type, quantity);

    const manaValue = Number(card.manaValue || 0);
    const bucket = manaValue >= 7 ? '7+' : String(Math.max(0, Math.floor(manaValue)));
    if (!isLand) {
      increment(stats.manaCurve, bucket, quantity);
      if (!card.colors.length) {
        increment(stats.manaCurveByColor.C, bucket, quantity);
      } else {
        for (const color of card.colors) {
          if (stats.manaCurveByColor[color]) increment(stats.manaCurveByColor[color], bucket, quantity);
        }
        if (card.colors.length > 1) increment(stats.manaCurveByColor.M, bucket, quantity);
      }
    }
    manaTotalAll += manaValue * quantity;
    manaCountAll += quantity;
    if (!isLand) {
      manaTotalNonland += manaValue * quantity;
      manaCountNonland += quantity;
    }

    if (!card.colors.length) increment(stats.colors, 'colorless', quantity);
    else {
      for (const color of card.colors) increment(stats.colors, color, quantity);
      if (card.colors.length > 1) increment(stats.colors, 'multicolor', quantity);
    }
    if (!card.colorIdentity.length) increment(stats.colorIdentity, 'colorless', quantity);
    else {
      for (const color of card.colorIdentity) increment(stats.colorIdentity, color, quantity);
      if (card.colorIdentity.length > 1) increment(stats.colorIdentity, 'multicolor', quantity);
    }
    countManaSymbols(card.manaCost, quantity, stats.manaSymbols);

    const manaEntries = card.insights?.manaProduction?.entries || [];
    const searchTargets = card.insights?.librarySearch?.targets || [];
    if (manaEntries.length) {
      stats.functions.manaProducerCardLines += 1;
      stats.functions.manaProducerQuantity += quantity;
      if (manaEntries.some((entry) => entry.variable)) stats.functions.variableManaProducers += quantity;
      for (const entry of manaEntries) {
        increment(stats.functions.manaByType, entry.mana, Number(entry.amount || 1) * quantity);
      }
      stats.functions.manaProducers.push({
        cardId: card.id,
        name: card.name,
        quantity,
        entries: manaEntries,
        source: card.insights?.manaProduction?.source || 'none',
        note: card.insights?.manaProduction?.note || ''
      });
    }
    if (searchTargets.length) {
      stats.functions.librarySearchCardLines += 1;
      stats.functions.librarySearchQuantity += quantity;
      for (const target of searchTargets) increment(stats.functions.librarySearchByTarget, target, quantity);
      stats.functions.librarySearchCards.push({
        cardId: card.id,
        name: card.name,
        quantity,
        targets: searchTargets,
        source: card.insights?.librarySearch?.source || 'none',
        note: card.insights?.librarySearch?.note || ''
      });
    }

    if (isLand) {
      stats.lands.total += quantity;
      if (card.supertypes.includes('Basic')) stats.lands.basic += quantity;
      else stats.lands.nonBasic += quantity;
      for (const entry of manaEntries) {
        const amount = Number(entry.amount || 1) * quantity;
        const choices = String(entry.mana || '').split('/').filter(Boolean);
        for (const mana of choices) increment(stats.lands.produces, mana, amount);
      }
    }

    if (isCreature) {
      stats.creatures.total += quantity;
      if (card.supertypes.includes('Legendary')) stats.creatures.legendary += quantity;
      increment(stats.creatures.manaCurve, bucket, quantity);
      const power = numericStat(card.power);
      const toughness = numericStat(card.toughness);
      if (power !== null) { powerTotal += power * quantity; powerCount += quantity; }
      if (toughness !== null) { toughnessTotal += toughness * quantity; toughnessCount += quantity; }
      for (const subtype of card.subtypes) increment(subtypeCounts, subtype, quantity);
      for (const keyword of RELEVANT_KEYWORDS) {
        if (card.keywords.some((value) => value.toLowerCase() === keyword.toLowerCase())) increment(stats.creatures.keywords, keyword, quantity);
      }
    }

    for (const tag of item.tags) increment(stats.tags, tag, quantity);

    if (!coverageByKey.has(card.cardKey)) {
      coverageByKey.set(card.cardKey, {
        card,
        basicLand: isBasicLand(card),
        quantity: 0,
        owned: card.usage.owned,
        needed: card.usage.needed,
        wanted: card.usage.wanted
      });
    }
    coverageByKey.get(card.cardKey).quantity += quantity;
  }

  stats.manaValue.averageIncludingLands = manaCountAll ? Number((manaTotalAll / manaCountAll).toFixed(2)) : 0;
  stats.manaValue.averageExcludingLands = manaCountNonland ? Number((manaTotalNonland / manaCountNonland).toFixed(2)) : 0;
  stats.manaValue.selectedAverage = excludeLandsFromAverage ? stats.manaValue.averageExcludingLands : stats.manaValue.averageIncludingLands;
  stats.lands.ratio = stats.totals.cards ? Number(((stats.lands.total / stats.totals.cards) * 100).toFixed(1)) : 0;
  stats.creatures.averagePower = powerCount ? Number((powerTotal / powerCount).toFixed(2)) : null;
  stats.creatures.averageToughness = toughnessCount ? Number((toughnessTotal / toughnessCount).toFixed(2)) : null;
  stats.creatures.topSubtypes = Object.entries(subtypeCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));

  stats.coverage.total = stats.totals.cards;
  for (const row of coverageByKey.values()) {
    const physicallyOwned = Math.min(row.quantity, row.owned);
    const assumedBasicLand = row.basicLand ? Math.max(row.quantity - physicallyOwned, 0) : 0;
    const directlyOwned = row.basicLand ? row.quantity : physicallyOwned;
    const missing = row.basicLand ? 0 : Math.max(row.quantity - row.owned, 0);
    const globalShortage = row.basicLand ? 0 : Math.max(row.needed - row.owned, 0);
    stats.coverage.physicallyOwned += physicallyOwned;
    stats.coverage.assumedBasicLands += assumedBasicLand;
    stats.coverage.directlyOwned += directlyOwned;
    if (row.basicLand) {
      stats.coverage.basicLandsExcluded += row.quantity;
    } else {
      stats.coverage.eligibleCards += row.quantity;
      stats.coverage.ownedCards += physicallyOwned;
    }
    stats.coverage.missingFromCollection += missing;
    stats.coverage.globalShortage += globalShortage;
    stats.coverage.onWanted += Math.min(globalShortage, row.wanted);
    stats.coverage.notOnWanted += Math.max(globalShortage - row.wanted, 0);
    if (globalShortage > 0) {
      stats.coverage.conflicts.push({
        cardId: row.card.id,
        name: row.card.name,
        owned: row.owned,
        neededAllDecks: row.needed,
        shortage: globalShortage
      });
    }
  }
  stats.coverage.percentage = stats.coverage.eligibleCards
    ? Number(((stats.coverage.ownedCards / stats.coverage.eligibleCards) * 100).toFixed(1))
    : stats.coverage.total ? 100 : 0;

  const linkedCardIds = new Set();
  const comboCardIds = new Set();
  const synergyCardIds = new Set();
  const membershipsPerCard = new Map();
  const sizeCounts = new Map();
  for (const group of linkGroups) {
    stats.links.memberships += group.memberCount;
    increment(stats.links.byType, group.type === 'combo' ? 'Combo' : 'Synergie', 1);
    sizeCounts.set(group.memberCount, (sizeCounts.get(group.memberCount) || 0) + 1);
    if (group.type === 'combo') stats.links.combos += 1;
    else stats.links.synergies += 1;
    if (group.memberCount > stats.links.largestGroupSize) {
      stats.links.largestGroupSize = group.memberCount;
      stats.links.largestGroupName = group.name;
    }
    for (const member of group.members) {
      linkedCardIds.add(member.deckCardId);
      if (group.type === 'combo') comboCardIds.add(member.deckCardId);
      else synergyCardIds.add(member.deckCardId);
      membershipsPerCard.set(member.deckCardId, (membershipsPerCard.get(member.deckCardId) || 0) + 1);
    }
  }
  stats.links.totalGroups = linkGroups.length;
  stats.links.linkedCards = linkedCardIds.size;
  stats.links.unlinkedCards = Math.max(allItems.length - linkedCardIds.size, 0);
  stats.links.cardsInCombos = comboCardIds.size;
  stats.links.cardsInSynergies = synergyCardIds.size;
  stats.links.cardsInMultipleGroups = [...membershipsPerCard.values()].filter((count) => count > 1).length;
  stats.links.averageGroupSize = linkGroups.length
    ? Number((stats.links.memberships / linkGroups.length).toFixed(2))
    : 0;
  stats.links.participationPercentage = allItems.length
    ? Number(((linkedCardIds.size / allItems.length) * 100).toFixed(1))
    : 0;
  stats.links.groupSizes = Object.fromEntries([...sizeCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([size, count]) => [`${size} kaarten`, count]));
  stats.links.groups = linkGroups.map((group) => ({
    id: group.id,
    name: group.name,
    type: group.type,
    note: group.note,
    memberCount: group.memberCount,
    members: group.members
  }));

  stats.validation = validateCommanderDeck(deck, items, stats.totals.cards);
  return stats;
}
