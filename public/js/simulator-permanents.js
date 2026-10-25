// Goldfishing objects live only in the active session. Generated cards keep
// their own immutable metadata, never a mutable reference to fetched deck data.
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];
const normalize = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function frontFace(card) {
  return isObject(card?.cardFaces?.[0]) ? card.cardFaces[0] : card;
}

function frontType(card) {
  const face = frontFace(card);
  return String(face?.typeLine || face?.type_line || card?.typeLine || '')
    .split(' // ')[0].split(/[—–]/, 1)[0];
}

export function simulatorItem(instance, byDeckCardId) {
  if (isObject(instance?.card)) return { id: instance.deckCardId ?? null, card: instance.card };
  return byDeckCardId?.get(Number(instance?.deckCardId)) || null;
}

export function isSimulatorCreature(card) {
  return /\bcreature\b/i.test(frontType(card));
}

export function isSimulatorBasicLand(card) {
  const types = frontType(card);
  return /\bbasic\b/i.test(types) && /\bland\b/i.test(types);
}

function orderedColors(colors) {
  const selected = new Set((Array.isArray(colors) ? colors : []).map((color) => String(color).toUpperCase()));
  return COLOR_ORDER.filter((color) => selected.has(color));
}

function semanticTokenIdentity(card) {
  const face = frontFace(card) || {};
  return JSON.stringify([
    'token', normalize(face.name || card.name), normalize(face.typeLine || face.type_line || card.typeLine),
    orderedColors(face.colors ?? card.colors), normalize(face.power ?? card.power),
    normalize(face.toughness ?? card.toughness), normalize(face.oracleText ?? face.oracle_text ?? card.oracleText),
    normalize(face.manaCost ?? face.mana_cost ?? card.manaCost)
  ]);
}

function cardIdentity(card, instance) {
  if (card?.isToken || /^token\b/i.test(frontType(card)) || /^emblem\b/i.test(frontType(card))) {
    return semanticTokenIdentity(card);
  }
  const oracleId = normalize(card?.oracleId || (card?.cardKey !== card?.scryfallId ? card?.cardKey : ''));
  if (oracleId) return `oracle:${oracleId}`;
  const name = normalize(card?.name);
  return name ? `name:${name}` : `instance:${instance?.id}`;
}

function safeCounter(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) ? number : 0;
}

export function simulatorStackKey(instance, card) {
  const counters = instance?.counters || {};
  return JSON.stringify([
    cardIdentity(card, instance), Boolean(instance?.tapped),
    safeCounter(counters.power), safeCounter(counters.toughness), safeCounter(counters.generic)
  ]);
}

function approvedImage(source) {
  if (typeof source !== 'string') return null;
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && url.hostname === 'cards.scryfall.io'
      && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

function tokenImages(token, face, index) {
  const images = {};
  for (const size of ['small', 'normal', 'large', 'png']) {
    const key = index === 0 ? size : `back${size[0].toUpperCase()}${size.slice(1)}`;
    images[size] = approvedImage(face?.image_uris?.[size] || face?.images?.[size])
      || approvedImage(token.images?.[key]);
  }
  images.normal ||= images.large || images.png || images.small;
  images.small ||= images.normal;
  images.large ||= images.normal;
  return images;
}

// A double-faced token printing can have unrelated tokens on its two sides.
// Offer each face separately, with that face's own text, stats and artwork.
export function tokenChoices(tokens) {
  if (!Array.isArray(tokens)) return [];
  return tokens.flatMap((token) => {
    if (!isObject(token) || token.available !== true || !String(token.name || '').trim()) return [];
    const faces = Array.isArray(token.cardFaces) && token.cardFaces.length
      ? token.cardFaces.filter(isObject).slice(0, 2) : [token];
    return faces.map((face, index) => ({
      scryfallId: token.scryfallId || null,
      tokenChoiceId: `${token.scryfallId || normalize(token.name)}:${index}`,
      name: String(face.name || token.name).trim(),
      typeLine: String(face.typeLine || face.type_line || token.typeLine || 'Token'),
      manaCost: String(face.manaCost ?? face.mana_cost ?? token.manaCost ?? ''),
      oracleText: String(face.oracleText ?? face.oracle_text ?? token.oracleText ?? ''),
      colors: orderedColors(face.colors ?? token.colors),
      // The API's combined keywords may also describe the other token face.
      // Face text is authoritative for identity; do not copy those keywords.
      keywords: [...new Set((Array.isArray(face.keywords) ? face.keywords
        : faces.length === 1 && Array.isArray(token.keywords) ? token.keywords : [])
        .filter((entry) => typeof entry === 'string'))],
      power: face.power == null ? (faces.length === 1 ? token.power ?? null : null) : String(face.power),
      toughness: face.toughness == null ? (faces.length === 1 ? token.toughness ?? null : null) : String(face.toughness),
      images: tokenImages(token, face, index),
      available: true,
      isToken: true
    }));
  });
}

function integer(value, minimum, maximum, label) {
  const input = typeof value === 'string' ? value.trim() : value;
  if ((typeof input !== 'number' && (typeof input !== 'string' || !/^[+-]?\d+$/.test(input)))
    || !Number.isSafeInteger(Number(input)) || Number(input) < minimum || Number(input) > maximum) {
    throw new Error(`${label} moet een geheel getal tussen ${minimum} en ${maximum} zijn.`);
  }
  return Number(input) || 0;
}

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => freezeDeep(child, seen));
  return Object.freeze(value);
}

function addGenerated(state, card, count, kind, source = null) {
  const quantity = integer(count, 1, 1000, 'Aantal');
  if (!Array.isArray(state?.zones?.battlefield)) throw new Error('Deze speeltest is niet meer beschikbaar.');
  // Finish validation and allocation before changing any session field.
  const snapshot = freezeDeep(structuredClone(card));
  const usedIds = new Set(Object.values(state.zones).flatMap((zone) => Array.isArray(zone) ? zone.map((entry) => entry.id) : []));
  let sequence = Number.isSafeInteger(state.nextGeneratedId) && state.nextGeneratedId >= 0 ? state.nextGeneratedId : 0;
  const created = [];
  for (let index = 0; index < quantity; index++) {
    let id;
    do {
      if (sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Er kunnen in deze speeltest geen nieuwe instanties worden aangemaakt.');
      id = `generated:${++sequence}`;
    } while (usedIds.has(id));
    usedIds.add(id);
    created.push({
      id, deckCardId: source?.deckCardId ?? null, cardId: snapshot.id ?? null,
      card: snapshot, generated: true, generatedKind: kind, tapped: false,
      counters: { power: 0, toughness: 0, generic: 0 }
    });
  }
  state.zones.battlefield.push(...created);
  state.nextGeneratedId = sequence;
  state.updatedAt = Date.now();
  return created;
}

export function addSimulatorTokens(state, tokenCard, count) {
  if (!isObject(tokenCard) || tokenCard.available !== true || !String(tokenCard.name || '').trim()
    || !(tokenCard.isToken || /^(token|emblem)\b/i.test(frontType(tokenCard)))) {
    throw new Error('Kies een token waarvan de kaartgegevens beschikbaar zijn.');
  }
  return addGenerated(state, tokenCard, count, 'token');
}

export function duplicateSimulatorCreature(state, sourceInstance, count, byDeckCardId) {
  if (!Array.isArray(state?.zones?.battlefield) || !state.zones.battlefield.includes(sourceInstance)) {
    throw new Error('Deze kaart ligt niet meer op tafel.');
  }
  const card = simulatorItem(sourceInstance, byDeckCardId)?.card;
  if (!card || !isSimulatorCreature(card)) throw new Error('Alleen creatures kunnen worden gedupliceerd.');
  return addGenerated(state, card, count, 'copy', sourceInstance);
}

export function setSimulatorCounters(instance, card, values = {}) {
  if (!isObject(instance)) throw new Error('Deze kaart is niet meer beschikbaar.');
  if (!isObject(values)) throw new Error('Geef geldige counterwaarden op.');
  const counters = isSimulatorCreature(card)
    ? {
      power: integer(values.power ?? 0, -9999, 9999, 'Power'),
      toughness: integer(values.toughness ?? 0, -9999, 9999, 'Toughness'), generic: 0
    }
    : { power: 0, toughness: 0, generic: integer(values.generic ?? 0, 0, 9999, 'Counters') };
  instance.counters = counters;
  return counters;
}

export function simulatorCounterLabel(instance, card) {
  const counters = instance?.counters || {};
  if (!isSimulatorCreature(card)) {
    const generic = safeCounter(counters.generic);
    return generic ? String(generic) : '';
  }
  const power = safeCounter(counters.power);
  const toughness = safeCounter(counters.toughness);
  const signed = (value) => value > 0 ? `+${value}` : String(value);
  return power || toughness ? `${signed(power)}/${signed(toughness)}` : '';
}
