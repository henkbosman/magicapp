import { normalizeSearchText, safeJsonParse } from '../lib/text.js';

const CARD_TYPES = new Set([
  'Artifact',
  'Battle',
  'Conspiracy',
  'Creature',
  'Dungeon',
  'Enchantment',
  'Instant',
  'Kindred',
  'Land',
  'Phenomenon',
  'Plane',
  'Planeswalker',
  'Scheme',
  'Sorcery',
  'Tribal',
  'Vanguard'
]);

const SUPERTYPES = new Set(['Basic', 'Legendary', 'Snow', 'World', 'Ongoing', 'Elite', 'Host']);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function splitTypeLine(typeLine = '') {
  const parts = String(typeLine).split(/\s*\/\/\s*/);
  const cardTypes = [];
  const supertypes = [];
  const subtypes = [];

  for (const part of parts) {
    const [left = '', right = ''] = part.split(/\s+[—-]\s+/, 2);
    for (const token of left.trim().split(/\s+/).filter(Boolean)) {
      if (CARD_TYPES.has(token)) cardTypes.push(token);
      if (SUPERTYPES.has(token)) supertypes.push(token);
    }
    subtypes.push(...right.trim().split(/\s+/).filter(Boolean));
  }

  return {
    cardTypes: unique(cardTypes),
    supertypes: unique(supertypes),
    subtypes: unique(subtypes)
  };
}

function imageFields(card) {
  const front = card.image_uris || card.card_faces?.[0]?.image_uris || {};
  const back = card.card_faces?.[1]?.image_uris || {};
  return {
    imageSmall: front.small || null,
    imageNormal: front.normal || front.large || null,
    imageLarge: front.large || front.normal || null,
    imagePng: front.png || null,
    backImageSmall: back.small || null,
    backImageNormal: back.normal || back.large || null,
    backImageLarge: back.large || back.normal || null,
    backImagePng: back.png || null
  };
}

function combineFaceField(card, field, separator = ' // ') {
  if (card[field] !== undefined && card[field] !== null && card[field] !== '') return card[field];
  const values = (card.card_faces || []).map((face) => face[field]).filter((value) => value !== undefined && value !== null && value !== '');
  return values.join(separator);
}

function combineFaceText(card, field) {
  if (card[field]) return card[field];
  return (card.card_faces || [])
    .map((face) => {
      const text = face[field];
      if (!text) return '';
      return `${face.name}\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

export function mapScryfallCard(card) {
  const typeLines = unique([card.type_line, ...(card.card_faces || []).map((face) => face.type_line)]);
  const parsedTypes = typeLines.map(splitTypeLine);
  const images = imageFields(card);

  return {
    scryfallId: card.id,
    oracleId: card.oracle_id || card.card_faces?.[0]?.oracle_id || null,
    name: card.name,
    searchName: normalizeSearchText([card.name, card.printed_name, ...(card.card_faces || []).flatMap((face) => [face.name, face.printed_name])].filter(Boolean).join(' ')),
    printedName: card.printed_name || null,
    manaCost: combineFaceField(card, 'mana_cost'),
    manaValue: Number(card.cmc || 0),
    colors: unique(card.colors || (card.card_faces || []).flatMap((face) => face.colors || [])),
    colorIdentity: unique(card.color_identity || []),
    producedMana: unique(card.produced_mana || []),
    typeLine: card.type_line || typeLines.join(' // '),
    cardTypes: unique(parsedTypes.flatMap((item) => item.cardTypes)),
    supertypes: unique(parsedTypes.flatMap((item) => item.supertypes)),
    subtypes: unique(parsedTypes.flatMap((item) => item.subtypes)),
    oracleText: combineFaceText(card, 'oracle_text'),
    printedText: combineFaceText(card, 'printed_text'),
    power: combineFaceField(card, 'power') || null,
    toughness: combineFaceField(card, 'toughness') || null,
    loyalty: combineFaceField(card, 'loyalty') || null,
    defense: combineFaceField(card, 'defense') || null,
    keywords: unique([...(card.keywords || []), ...(card.card_faces || []).flatMap((face) => face.keywords || [])]),
    setName: card.set_name || '',
    setCode: card.set || '',
    collectorNumber: card.collector_number || '',
    rarity: card.rarity || '',
    releasedAt: card.released_at || null,
    artist: card.artist || (card.card_faces || []).map((face) => face.artist).filter(Boolean).join(' / ') || null,
    language: card.lang || 'en',
    layout: card.layout || 'normal',
    legalities: card.legalities || {},
    ...images,
    finishes: unique(card.finishes || [card.nonfoil ? 'nonfoil' : null, card.foil ? 'foil' : null, card.etched ? 'etched' : null]),
    prices: card.prices || {},
    cardFaces: card.card_faces || [],
    scryfallUri: card.scryfall_uri || null,
    raw: card
  };
}

export function cardRowToApi(row) {
  if (!row) return null;
  const cardId = row.card_record_id !== undefined && row.card_record_id !== null
    ? row.card_record_id
    : row.id;
  return {
    id: Number(cardId),
    scryfallId: row.scryfall_id,
    oracleId: row.oracle_id,
    cardKey: row.oracle_id || row.scryfall_id,
    name: row.name,
    printedName: row.printed_name,
    manaCost: row.mana_cost,
    manaValue: Number(row.mana_value || 0),
    colors: safeJsonParse(row.colors_json, []),
    colorIdentity: safeJsonParse(row.color_identity_json, []),
    producedMana: safeJsonParse(row.produced_mana_json, []),
    typeLine: row.type_line,
    cardTypes: safeJsonParse(row.card_types_json, []),
    supertypes: safeJsonParse(row.supertypes_json, []),
    subtypes: safeJsonParse(row.subtypes_json, []),
    oracleText: row.oracle_text,
    printedText: row.printed_text,
    power: row.power,
    toughness: row.toughness,
    loyalty: row.loyalty,
    defense: row.defense,
    keywords: safeJsonParse(row.keywords_json, []),
    setName: row.set_name,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    releasedAt: row.released_at,
    artist: row.artist,
    language: row.language,
    layout: row.layout,
    legalities: safeJsonParse(row.legalities_json, {}),
    images: {
      small: row.image_small,
      normal: row.image_normal,
      large: row.image_large,
      png: row.image_png,
      backSmall: row.back_image_small,
      backNormal: row.back_image_normal,
      backLarge: row.back_image_large,
      backPng: row.back_image_png
    },
    finishes: safeJsonParse(row.finishes_json, []),
    prices: safeJsonParse(row.prices_json, {}),
    cardFaces: safeJsonParse(row.card_faces_json, []),
    scryfallUri: row.scryfall_uri,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function scryfallSummary(card) {
  const mapped = mapScryfallCard(card);
  return {
    scryfallId: mapped.scryfallId,
    oracleId: mapped.oracleId,
    name: mapped.name,
    printedName: mapped.printedName,
    setName: mapped.setName,
    setCode: mapped.setCode,
    collectorNumber: mapped.collectorNumber,
    rarity: mapped.rarity,
    releasedAt: mapped.releasedAt,
    language: mapped.language,
    finishes: mapped.finishes,
    prices: mapped.prices,
    image: mapped.imageSmall || mapped.imageNormal,
    imageNormal: mapped.imageNormal || mapped.imageSmall,
    typeLine: mapped.typeLine,
    manaCost: mapped.manaCost,
    layout: mapped.layout
  };
}
