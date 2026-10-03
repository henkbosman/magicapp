const COLOR_ORDER = Object.freeze(['W', 'U', 'B', 'R', 'G', 'C']);
const COLOR_BITS = Object.freeze({ W: 1, U: 2, B: 4, R: 8, G: 16 });
const COLOR_ALIASES = Object.freeze({
  W: 'W', WHITE: 'W',
  U: 'U', BLUE: 'U',
  B: 'B', BLACK: 'B',
  R: 'R', RED: 'R',
  G: 'G', GREEN: 'G',
  C: 'C', COLORLESS: 'C', COLOURLESS: 'C'
});
const CARD_TYPES = Object.freeze([
  'Artifact', 'Battle', 'Conspiracy', 'Creature', 'Dungeon', 'Enchantment',
  'Instant', 'Kindred', 'Land', 'Phenomenon', 'Plane', 'Planeswalker',
  'Scheme', 'Sorcery', 'Tribal', 'Vanguard'
]);
const SUPERTYPES = new Set(['Basic', 'Host', 'Legendary', 'Ongoing', 'Snow', 'World']);

function scalarString(value, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function listValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(listValues);
  if (value instanceof Set) return [...value].flatMap(listValues);
  return [value];
}

function uniqueStrings(values, { sort = false } = {}) {
  const seen = new Set();
  const result = [];
  for (const value of listValues(values)) {
    const text = scalarString(value);
    if (!text) continue;
    const key = text.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  if (sort) result.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }));
  return result;
}

export function normalizeSearchText(...values) {
  return listValues(values)
    .map((value) => scalarString(value))
    .filter(Boolean)
    .join(' ')
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .replace(/[‘’`´]/gu, "'")
    .replace(/[‐‑‒–—―]/gu, '-')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}+*/'/-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function normalizeColors(value) {
  const normalized = [];
  for (const raw of listValues(value)) {
    const pieces = scalarString(raw).replace(/[{}]/gu, '').split(/[\s,;/]+/u).filter(Boolean);
    for (const piece of pieces) {
      const color = COLOR_ALIASES[piece.toUpperCase()];
      if (color && !normalized.includes(color)) normalized.push(color);
    }
  }
  return COLOR_ORDER.filter((color) => normalized.includes(color));
}

export function colorMask(value) {
  return normalizeColors(value).reduce((mask, color) => mask | (COLOR_BITS[color] ?? 0), 0);
}

export function normalizeKeywords(value) {
  const expanded = listValues(value).flatMap((item) => {
    const text = scalarString(item);
    return Array.isArray(value) ? [text] : text.split(/[,;\n]+/u);
  });
  return uniqueStrings(expanded, { sort: true });
}

function typeLineParts(typeLine) {
  const [left = '', right = ''] = scalarString(typeLine).split(/\s+[—–-]\s+/u, 2);
  return { left, right };
}

export function normalizeTypes(cardOrTypes, fallbackTypeLine = '') {
  const card = cardOrTypes && typeof cardOrTypes === 'object' && !Array.isArray(cardOrTypes)
    ? cardOrTypes
    : null;
  const explicit = card ? card.types : cardOrTypes;
  const typeLine = card ? card.type ?? card.typeLine ?? fallbackTypeLine : fallbackTypeLine;
  const candidates = uniqueStrings(explicit);
  const left = typeLineParts(typeLine).left;
  for (const knownType of CARD_TYPES) {
    if (new RegExp(`(?:^|\\s)${knownType}(?:$|\\s)`, 'iu').test(left)) candidates.push(knownType);
  }
  const lowered = new Set(candidates.map((type) => type.toLocaleLowerCase('en-US')));
  return CARD_TYPES.filter((type) => lowered.has(type.toLocaleLowerCase('en-US')));
}

export function normalizeSupertypes(card, fallbackTypeLine = '') {
  const typeLine = card?.type ?? card?.typeLine ?? fallbackTypeLine;
  const explicit = uniqueStrings(card?.supertypes);
  const leftWords = typeLineParts(typeLine).left.split(/\s+/u);
  return uniqueStrings([...explicit, ...leftWords.filter((word) => SUPERTYPES.has(word))], { sort: true });
}

export function normalizeSubtypes(card, fallbackTypeLine = '') {
  const typeLine = card?.type ?? card?.typeLine ?? fallbackTypeLine;
  const explicit = uniqueStrings(card?.subtypes);
  const parsed = typeLineParts(typeLine).right.split(/\s+/u).filter(Boolean);
  return uniqueStrings(explicit.length ? explicit : parsed, { sort: true });
}

function normalizeLegalityStatus(value) {
  const normalized = normalizeSearchText(value).replace(/\s+/gu, '_');
  const aliases = {
    legal: 'legal',
    banned: 'banned',
    restricted: 'restricted',
    not_legal: 'not_legal',
    notlegal: 'not_legal'
  };
  return aliases[normalized] ?? normalized;
}

export function normalizeLegalities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([format, status]) => [normalizeSearchText(format).replace(/\s+/gu, '_'), normalizeLegalityStatus(status)])
      .filter(([format, status]) => format && status)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
  );
}

export function normalizeProducedMana(value) {
  return normalizeColors(value);
}

function normalizedOracle(value) {
  return scalarString(value).replace(/\r\n?/gu, '\n');
}

function sentenceSegments(text) {
  return text.split(/(?<=[.!?])\s+|\n+/u).filter(Boolean);
}

function ownLibrarySearchClauses(text) {
  return sentenceSegments(text).filter((segment) => /\bsearch your library\b/iu.test(segment));
}

function keywordIncludes(keywords, pattern) {
  return keywords.some((keyword) => pattern.test(keyword));
}

export function extractCreatureTokenStats(oracleText) {
  const text = normalizedOracle(oracleText);
  const results = [];
  const seen = new Set();
  const actionPattern = /\b(?:create|creates|created|put)\b[^.\n]{0,220}?([+−-]?(?:\d+|x|\*))\s*\/\s*([+−-]?(?:\d+|x|\*))([^.;\n]{0,140}?)\bcreature tokens?\b/giu;
  for (const match of text.matchAll(actionPattern)) {
    const power = match[1].replace('−', '-').toUpperCase();
    const toughness = match[2].replace('−', '-').toUpperCase();
    const descriptor = match[3]
      .replace(/\b(?:a|an|one|two|three|four|five|six|x|tapped|and attacking)\b/giu, ' ')
      .replace(/\b(?:white|blue|black|red|green|colorless|colourless)\b/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const tokenType = descriptor || null;
    const key = `${power}/${toughness}/${tokenType ?? ''}`.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(Object.freeze({ power, toughness, tokenType }));
  }
  return results;
}

function detectTutorTargets(text, keywords) {
  const clauses = ownLibrarySearchClauses(text);
  const cyclingKeywords = keywords.filter((keyword) => /cycling$/iu.test(keyword));
  const hasTypecycling = cyclingKeywords.length > 0;
  const basicLandCycling = cyclingKeywords.some((keyword) => /^basic landcycling$/iu.test(keyword));
  const landCycling = cyclingKeywords.some((keyword) => /(?:land|plains|island|swamp|mountain|forest)cycling$/iu.test(keyword));
  const creatureCycling = cyclingKeywords.some((keyword) => /(?:creature|wizard|goblin|elf|dragon|sliver|rebel)cycling$/iu.test(keyword));
  const isTutor = clauses.length > 0 || hasTypecycling || keywordIncludes(keywords, /^(?:transmute)$/iu);
  const soughtDescriptions = clauses
    .map((clause) => clause.match(/\bfor\b([^.\n]*?)\bcards?\b/iu)?.[1] ?? '')
    .filter(Boolean);
  const soughtHas = (pattern) => soughtDescriptions.some((description) => pattern.test(description));
  const basicLand = basicLandCycling || soughtHas(/\bbasic\s+land\b/iu);
  const land = landCycling || basicLand || soughtHas(/\bland\b|\b(?:plains|island|swamp|mountain|forest|wastes)\b/iu);
  const creature = creatureCycling || soughtHas(/\bcreature\b/iu);
  const artifact = soughtHas(/\bartifact\b/iu);
  const enchantment = soughtHas(/\benchantment\b/iu);
  const instant = soughtHas(/\binstant\b/iu);
  const sorcery = soughtHas(/\bsorcery\b/iu);
  const planeswalker = soughtHas(/\bplaneswalker\b/iu);
  const hasExplicitCardType = land || creature || artifact || enchantment || instant || sorcery || planeswalker;
  const general = clauses.some((clause) => /\bfor\b[^.\n]*\bcards?\b/iu.test(clause)) && !hasExplicitCardType
    || keywordIncludes(keywords, /^transmute$/iu);

  const targets = [];
  if (basicLand) targets.push('basic_land');
  if (land) targets.push('land');
  if (creature) targets.push('creature');
  if (artifact) targets.push('artifact');
  if (enchantment) targets.push('enchantment');
  if (instant) targets.push('instant');
  if (sorcery) targets.push('sorcery');
  if (planeswalker) targets.push('planeswalker');
  if (general || isTutor && targets.length === 0) targets.push('any');
  return {
    isTutor,
    basicLand,
    land,
    creature,
    artifact,
    enchantment,
    instant,
    sorcery,
    planeswalker,
    general,
    targets
  };
}

export function detectCardCatalogFeatures(card = {}) {
  const oracleText = normalizedOracle(card.text ?? card.oracleText);
  const keywords = normalizeKeywords(card.keywords);
  const producedMana = normalizeProducedMana(card.producedMana ?? card.produced_mana);
  const tokenStats = extractCreatureTokenStats(oracleText);
  const tutor = detectTutorTargets(oracleText, keywords);
  const createsCreatureToken = /\b(?:create|creates|created|put)\b[^.\n]{0,300}?\bcreature tokens?\b/iu.test(oracleText)
    || tokenStats.length > 0;
  const hasLandfall = keywordIncludes(keywords, /^landfall$/iu) || /(?:^|\n)\s*landfall\s*[—–-]/imu.test(oracleText);
  const producesMana = producedMana.length > 0
    || /\badd\b[^.\n]{0,100}?(?:\{[WUBRGCX]\}|\bmana\b)/iu.test(oracleText)
    || /\bcreate\b[^.\n]{0,120}?\btreasure tokens?\b/iu.test(oracleText);
  const drawsCards = /\bdraw\b[^.\n]{0,50}?\b(?:a|one|two|three|four|five|six|seven|\d+|x|that many|cards? equal to)?\s*cards?\b/iu.test(oracleText);
  const removal = /\b(?:destroy|exile)\b[^.\n]{0,80}?\b(?:target|all|each|up to)\b|\breturn\b[^.\n]{0,100}?\bto (?:its|their) owner's (?:hand|library)\b|\bcounter target spell\b|\btarget creature\b[^.\n]{0,80}?\bgets? -\d+\/-\d+\b|\bfights?\b[^.\n]{0,80}?\btarget creature\b|\btarget opponent sacrifices?\b[^.\n]{0,60}?\bcreature\b/iu.test(oracleText);
  const graveyard = /\bgraveyards?\b|\b(?:dies|died)\b|\bmill(?:s|ed|ing)?\b/iu.test(oracleText)
    || keywordIncludes(keywords, /^(?:dredge|escape|flashback|jump-start|mill|unearth|delve)$/iu);
  const sacrifice = /\bsacrific(?:e|es|ed|ing)\b/iu.test(oracleText)
    || keywordIncludes(keywords, /^exploit$/iu);
  const counters = /\bproliferate\b|[+−-]\d+\s*\/[+−-]\d+\s+counters?\b|\b(?:charge|loyalty|stun|shield|quest|time|verse|age|oil|poison|experience|energy) counters?\b|\bput\b[^.\n]{0,90}?\bcounters? on\b|\bcounters? on\b/iu.test(oracleText)
    || keywordIncludes(keywords, /^(?:adapt|amass|bolster|evolve|fabricate|graft|mentor|modular|proliferate|reinforce|riot|training|undying)$/iu);
  const pump = /\bgets?\s+\+(?:\d+|x|\*)\s*\/\s*\+(?:\d+|x|\*)\b/iu.test(oracleText);

  const tags = [];
  if (hasLandfall) tags.push('landfall');
  if (createsCreatureToken) tags.push('creature_token');
  if (tutor.isTutor) tags.push('tutor');
  if (tutor.basicLand) tags.push('tutor_basic_land');
  if (tutor.land) tags.push('tutor_land');
  if (tutor.creature) tags.push('tutor_creature');
  if (tutor.artifact) tags.push('tutor_artifact');
  if (tutor.enchantment) tags.push('tutor_enchantment');
  if (tutor.instant) tags.push('tutor_instant');
  if (tutor.sorcery) tags.push('tutor_sorcery');
  if (tutor.planeswalker) tags.push('tutor_planeswalker');
  if (tutor.general) tags.push('tutor_any');
  if (producesMana) tags.push('mana_production');
  if (drawsCards) tags.push('card_draw');
  if (removal) tags.push('removal');
  if (graveyard) tags.push('graveyard');
  if (sacrifice) tags.push('sacrifice');
  if (counters) tags.push('counters');
  if (pump) tags.push('pump');

  return Object.freeze({
    hasLandfall,
    createsCreatureToken,
    tokenStats,
    isTutor: tutor.isTutor,
    tutorsBasicLand: tutor.basicLand,
    tutorsLand: tutor.land,
    tutorsCreature: tutor.creature,
    tutorsArtifact: tutor.artifact,
    tutorsEnchantment: tutor.enchantment,
    tutorsInstant: tutor.instant,
    tutorsSorcery: tutor.sorcery,
    tutorsPlaneswalker: tutor.planeswalker,
    tutorsAnyCard: tutor.general,
    tutorTargets: Object.freeze(tutor.targets),
    producesMana,
    drawsCards,
    removal,
    graveyard,
    sacrifice,
    counters,
    pump,
    tags: Object.freeze(tags)
  });
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function identifier(card, ...names) {
  for (const name of names) {
    const direct = scalarString(card?.[name]);
    if (direct) return direct;
    const nested = scalarString(card?.identifiers?.[name]);
    if (nested) return nested;
  }
  return null;
}

export function mapAtomicCardToCatalogRecord(card, { sourceKey = '', variantIndex = 0 } = {}) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new TypeError('Atomic card must be an object');
  }
  if (!Number.isSafeInteger(variantIndex) || variantIndex < 0) {
    throw new TypeError('variantIndex must be a non-negative safe integer');
  }

  const name = scalarString(card.name, scalarString(sourceKey));
  if (!name) throw new TypeError('Atomic card requires a name or sourceKey');
  const normalizedSourceKey = scalarString(sourceKey, name);
  const oracleText = normalizedOracle(card.text ?? card.oracleText);
  const typeLine = scalarString(card.type ?? card.typeLine);
  const colors = normalizeColors(card.colors);
  const colorIdentity = normalizeColors(card.colorIdentity ?? card.color_identity);
  const keywords = normalizeKeywords(card.keywords);
  const types = normalizeTypes(card, typeLine);
  const subtypes = normalizeSubtypes(card, typeLine);
  const supertypes = normalizeSupertypes(card, typeLine);
  const legalities = normalizeLegalities(card.legalities);
  const producedMana = normalizeProducedMana(card.producedMana ?? card.produced_mana);
  const effects = detectCardCatalogFeatures({ ...card, text: oracleText, keywords, producedMana });
  const firstToken = effects.tokenStats[0] ?? null;
  const scryfallOracleId = identifier(card, 'scryfallOracleId', 'scryfall_oracle_id');
  const uuid = identifier(card, 'uuid', 'mtgjsonV4Id');
  const catalogKey = scryfallOracleId || uuid || `${normalizedSourceKey}::${variantIndex}`;

  return Object.freeze({
    id: catalogKey,
    sourceKey: normalizedSourceKey,
    variantIndex,
    catalogKey,
    name,
    asciiName: scalarString(card.asciiName) || null,
    faceName: scalarString(card.faceName) || null,
    side: scalarString(card.side) || null,
    manaCost: scalarString(card.manaCost ?? card.mana_cost) || null,
    manaValue: numberOrNull(card.manaValue ?? card.convertedManaCost ?? card.cmc),
    colors: Object.freeze(colors),
    colorIdentity: Object.freeze(colorIdentity),
    colorMask: colorMask(colorIdentity.length ? colorIdentity : colors),
    typeLine,
    supertypes: Object.freeze(supertypes),
    types: Object.freeze(types),
    subtypes: Object.freeze(subtypes),
    oracleText,
    power: scalarString(card.power) || null,
    toughness: scalarString(card.toughness) || null,
    loyalty: scalarString(card.loyalty) || null,
    defense: scalarString(card.defense) || null,
    layout: scalarString(card.layout) || null,
    keywords: Object.freeze(keywords),
    legalities: Object.freeze(legalities),
    producedMana: Object.freeze(producedMana),
    effects,
    tokenPower: firstToken?.power ?? null,
    tokenToughness: firstToken?.toughness ?? null,
    tokenType: firstToken?.tokenType ?? null,
    tutorTarget: effects.tutorTargets.join(',') || null,
    scryfallOracleId,
    searchText: normalizeSearchText(
      name,
      card.asciiName,
      card.faceName,
      typeLine,
      oracleText,
      keywords,
      types,
      subtypes,
      effects.tags
    ),
    raw: card
  });
}
