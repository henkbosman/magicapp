import { cardCatalogStatus, withCardCatalog } from './database.js';
import { HttpError } from '../lib/http-error.js';
import { colorMask, normalizeColors, normalizeSearchText } from '../lib/card-catalog-features.js';

const EFFECT_ALIASES = Object.freeze({
  token: 'creature_token',
  creature_token: 'creature_token',
  tutor: 'tutor',
  mana: 'mana_production',
  mana_production: 'mana_production',
  draw: 'card_draw',
  card_draw: 'card_draw',
  counter: 'counters',
  counters: 'counters',
  removal: 'removal',
  sacrifice: 'sacrifice',
  pump: 'pump',
  graveyard: 'graveyard',
  landfall: 'landfall'
});

const EFFECT_OUTPUT = Object.freeze({
  landfall: { value: 'landfall', label: 'Landfall' },
  creature_token: { value: 'token', label: 'Maakt creature tokens' },
  tutor: { value: 'tutor', label: 'Zoekt in de library' },
  mana_production: { value: 'mana', label: 'Produceert mana' },
  card_draw: { value: 'draw', label: 'Kaarten pakken' },
  counters: { value: 'counter', label: 'Counters' },
  removal: { value: 'removal', label: 'Removal' },
  sacrifice: { value: 'sacrifice', label: 'Sacrifice' },
  pump: { value: 'pump', label: 'Power/toughness verhogen' },
  graveyard: { value: 'graveyard', label: 'Graveyard' }
});

const TUTOR_TARGET_LABELS = Object.freeze({
  any: 'Elke kaart',
  basic_land: 'Basic land',
  land: 'Land',
  creature: 'Creature',
  artifact: 'Artifact',
  enchantment: 'Enchantment',
  instant: 'Instant',
  sorcery: 'Sorcery',
  planeswalker: 'Planeswalker'
});

const MAX_SEARCH_OFFSET = 5000;

export function cardCatalogTotalPages(total, limit) {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(Math.ceil(total / limit), Math.floor(MAX_SEARCH_OFFSET / limit) + 1);
}

function scalar(value, name, maxLength = 200) {
  const raw = Array.isArray(value) ? value[0] : value;
  const result = String(raw ?? '').trim();
  if (result.length > maxLength) throw new HttpError(400, `${name} is te lang.`);
  return result;
}

function finiteNumber(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(number) || number < 0 || number > 1000) {
    throw new HttpError(400, `${name} moet een getal tussen 0 en 1000 zijn.`);
  }
  return number;
}

function integer(value, name, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new HttpError(400, `${name} moet tussen ${minimum} en ${maximum} liggen.`);
  }
  return number;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function escapeLike(value) {
  return String(value).replace(/[\^%_]/gu, (character) => `^${character}`);
}

function facetRows(database, table, { valueColumn = 'value' } = {}) {
  return database.prepare(`
    SELECT facet.${valueColumn} AS value, COUNT(DISTINCT c.catalog_key) AS count
    FROM ${table} facet
    JOIN cards c ON c.id = facet.card_id
    GROUP BY facet.${valueColumn} COLLATE NOCASE
    ORDER BY facet.${valueColumn} COLLATE NOCASE
  `).all().map((row) => ({ value: row.value, label: row.value, count: Number(row.count || 0) }));
}

export function cardCatalogOptions() {
  return withCardCatalog((database) => {
    const rawEffects = facetRows(database, 'card_effects');
    const effectCounts = new Map(rawEffects.map((entry) => [entry.value, entry.count]));
    const effects = Object.entries(EFFECT_OUTPUT)
      .filter(([stored]) => effectCounts.has(stored))
      .map(([stored, output]) => ({ ...output, count: effectCounts.get(stored) }));
    const tutorTargets = facetRows(database, 'card_tutor_targets').map((entry) => ({
      ...entry,
      label: TUTOR_TARGET_LABELS[entry.value] || entry.value
    }));

    return {
      abilities: facetRows(database, 'card_abilities'),
      keywords: facetRows(database, 'card_keywords'),
      types: facetRows(database, 'card_types'),
      subtypes: facetRows(database, 'card_subtypes'),
      effects,
      tutorTargets
    };
  });
}

function normalizedFilters(input = {}) {
  const name = scalar(input.name, 'Naam', 200);
  const text = scalar(input.text, 'Kaarttekst', 500);
  const ability = scalar(input.ability, 'Ability', 120);
  const keyword = scalar(input.keyword, 'Keyword', 120);
  const type = scalar(input.type, 'Type', 120);
  const subtype = scalar(input.subtype, 'Subtype', 120);
  const colorIdentityRaw = scalar(input.colorIdentity, 'Kleuridentiteit', 80);
  const colorTokens = colorIdentityRaw.split(/[\s,;]+/u).filter(Boolean);
  if (colorTokens.some((color) => !/^[WUBRGC]$/iu.test(color))) {
    throw new HttpError(400, 'Kleuridentiteit mag alleen W, U, B, R, G en C bevatten.');
  }
  const colorIdentity = normalizeColors(colorTokens);
  if (colorIdentity.includes('C') && colorIdentity.length > 1) {
    throw new HttpError(400, 'Kleurloos (C) kan niet met andere kleuridentiteiten worden gecombineerd.');
  }
  const colorMode = scalar(input.colorMode, 'Kleurmodus', 20).toLowerCase() || 'subset';
  if (!['exact', 'contains', 'subset'].includes(colorMode)) throw new HttpError(400, 'Ongeldige kleurmodus.');

  const effectInput = scalar(input.effect, 'Effect', 80).toLowerCase();
  const effect = effectInput ? EFFECT_ALIASES[effectInput] : '';
  if (effectInput && !effect) throw new HttpError(400, 'Onbekend kaarteffect.');

  const tutorTarget = scalar(input.tutorTarget, 'Tutor-doel', 80).toLowerCase();
  if (tutorTarget && !Object.hasOwn(TUTOR_TARGET_LABELS, tutorTarget)) {
    throw new HttpError(400, 'Onbekend tutor-doel.');
  }

  const legality = scalar(input.legality, 'Legaliteit', 100).toLowerCase();
  if (legality && !/^[a-z0-9_-]+(?::(?:legal|banned|restricted|not_legal))?$/u.test(legality)) {
    throw new HttpError(400, 'Ongeldige legaliteitsfilter.');
  }

  const sort = scalar(input.sort, 'Sortering', 20).toLowerCase() || 'relevance';
  if (!['relevance', 'name', 'mana'].includes(sort)) throw new HttpError(400, 'Ongeldige sortering.');
  const page = integer(input.page, 'Pagina', 1, 1, 10000);
  const limit = integer(input.limit, 'Limiet', 50, 1, 100);
  if ((page - 1) * limit > MAX_SEARCH_OFFSET) {
    throw new HttpError(400, 'Deze resultaatpagina ligt buiten het toegestane bereik.');
  }

  const manaMin = finiteNumber(input.manaMin, 'Minimale manakosten');
  const manaMax = finiteNumber(input.manaMax, 'Maximale manakosten');
  if (manaMin !== null && manaMax !== null && manaMin > manaMax) {
    throw new HttpError(400, 'Minimale manakosten mogen niet hoger zijn dan maximale manakosten.');
  }

  return {
    name,
    text,
    ability,
    keyword,
    type,
    subtype,
    colorIdentity,
    colorMode,
    manaMin,
    manaMax,
    legality,
    effect,
    effectInput,
    tokenPower: scalar(input.tokenPower, 'Token power', 20),
    tokenToughness: scalar(input.tokenToughness, 'Token toughness', 20),
    tokenType: scalar(input.tokenType, 'Token type', 100),
    tutorTarget,
    sort,
    page,
    limit
  };
}

function queryParts(filters) {
  const conditions = [];
  const params = [];

  if (filters.name) {
    const normalizedName = normalizeSearchText(filters.name);
    if (normalizedName) {
      conditions.push("c.search_name LIKE ? ESCAPE '^'");
      params.push(`%${escapeLike(normalizedName)}%`);
    } else {
      conditions.push('0 = 1');
    }
  }
  if (filters.text) {
    conditions.push("c.oracle_text LIKE ? ESCAPE '^' COLLATE NOCASE");
    params.push(`%${escapeLike(filters.text)}%`);
  }
  for (const [value, table] of [
    [filters.ability, 'card_abilities'],
    [filters.keyword, 'card_keywords'],
    [filters.type, 'card_types'],
    [filters.subtype, 'card_subtypes']
  ]) {
    if (!value) continue;
    conditions.push(`EXISTS (SELECT 1 FROM ${table} facet WHERE facet.card_id = c.id AND facet.value = ? COLLATE NOCASE)`);
    params.push(value);
  }

  if (filters.colorIdentity.length) {
    const containsColorless = filters.colorIdentity.includes('C');
    const colors = filters.colorIdentity.filter((color) => color !== 'C');
    const mask = colorMask(colors);
    if (containsColorless && !colors.length) {
      conditions.push('c.color_identity_mask = 0');
    } else if (filters.colorMode === 'exact') {
      conditions.push('c.color_identity_mask = ?');
      params.push(mask);
    } else if (filters.colorMode === 'contains') {
      conditions.push('(c.color_identity_mask & ?) = ?');
      params.push(mask, mask);
    } else {
      conditions.push('(c.color_identity_mask & ~?) = 0');
      params.push(mask);
    }
  }

  if (filters.manaMin !== null) {
    conditions.push('c.mana_value >= ?');
    params.push(filters.manaMin);
  }
  if (filters.manaMax !== null) {
    conditions.push('c.mana_value <= ?');
    params.push(filters.manaMax);
  }

  if (filters.legality) {
    const [format, requestedStatus = 'legal'] = filters.legality.split(':', 2);
    conditions.push(`EXISTS (
      SELECT 1 FROM card_legalities legality
      WHERE legality.card_id = c.id AND legality.format = ? COLLATE NOCASE AND legality.status = ? COLLATE NOCASE
    )`);
    params.push(format, requestedStatus);
  }

  const needsToken = filters.effect === 'creature_token'
    || filters.tokenPower || filters.tokenToughness || filters.tokenType;
  const needsTutor = filters.effect === 'tutor' || filters.tutorTarget;
  if (filters.effect && !['creature_token', 'tutor'].includes(filters.effect)) {
    conditions.push('EXISTS (SELECT 1 FROM card_effects effect WHERE effect.card_id = c.id AND effect.value = ?)');
    params.push(filters.effect);
  }
  if (needsToken) {
    conditions.push("EXISTS (SELECT 1 FROM card_effects effect WHERE effect.card_id = c.id AND effect.value = 'creature_token')");
  }
  const specificTokenType = filters.tokenType && filters.tokenType.toLowerCase() !== 'creature'
    ? filters.tokenType
    : '';
  if (filters.tokenPower || filters.tokenToughness || specificTokenType) {
    const tokenConditions = ['token.card_id = c.id'];
    if (filters.tokenPower) {
      tokenConditions.push('token.power = ? COLLATE NOCASE');
      params.push(filters.tokenPower);
    }
    if (filters.tokenToughness) {
      tokenConditions.push('token.toughness = ? COLLATE NOCASE');
      params.push(filters.tokenToughness);
    }
    if (specificTokenType) {
      tokenConditions.push("token.token_type LIKE ? ESCAPE '^' COLLATE NOCASE");
      params.push(`%${escapeLike(specificTokenType)}%`);
    }
    conditions.push(`EXISTS (
      SELECT 1 FROM card_tokens token
      WHERE ${tokenConditions.join(' AND ')}
    )`);
  }
  if (needsTutor) {
    conditions.push("EXISTS (SELECT 1 FROM card_effects effect WHERE effect.card_id = c.id AND effect.value = 'tutor')");
  }
  if (filters.tutorTarget) {
    conditions.push(`EXISTS (
      SELECT 1 FROM card_tutor_targets target
      WHERE target.card_id = c.id AND target.value = ? COLLATE NOCASE
    )`);
    params.push(filters.tutorTarget);
  }

  return { conditions, params };
}

function matchReasons(filters) {
  const reasons = [];
  if (filters.name) reasons.push(`Naam bevat “${filters.name}”`);
  if (filters.text) reasons.push(`Kaarttekst bevat “${filters.text}”`);
  if (filters.ability) reasons.push(`Ability: ${filters.ability}`);
  if (filters.keyword) reasons.push(`Keyword: ${filters.keyword}`);
  if (filters.type) reasons.push(`Type: ${filters.type}`);
  if (filters.subtype) reasons.push(`Subtype: ${filters.subtype}`);
  if (filters.colorIdentity.length) reasons.push(`Kleuridentiteit: ${filters.colorIdentity.join('')}`);
  if (filters.effectInput) reasons.push(`Effect: ${filters.effectInput}`);
  if (filters.tokenPower || filters.tokenToughness) {
    reasons.push(`Token: ${filters.tokenPower || '*'}/${filters.tokenToughness || '*'}`);
  }
  if (filters.tokenType) reasons.push(`Tokentype: ${filters.tokenType}`);
  if (filters.tutorTarget) reasons.push(`Tutor-doel: ${TUTOR_TARGET_LABELS[filters.tutorTarget] || filters.tutorTarget}`);
  if (filters.legality) reasons.push(`Legaliteit: ${filters.legality.split(':', 1)[0]}`);
  return reasons;
}

function tokenMatchesFilters(token, filters) {
  if (filters.tokenPower && token.power.toLocaleLowerCase('en-US') !== filters.tokenPower.toLocaleLowerCase('en-US')) return false;
  if (filters.tokenToughness && token.toughness.toLocaleLowerCase('en-US') !== filters.tokenToughness.toLocaleLowerCase('en-US')) return false;
  const requestedType = filters.tokenType.toLocaleLowerCase('en-US');
  if (requestedType && requestedType !== 'creature' && !token.type.toLocaleLowerCase('en-US').includes(requestedType)) return false;
  return true;
}

function resultItem(row, reasons, tokens, filters) {
  const effects = parseJson(row.effects_json, {});
  const selectedToken = tokens.find((token) => tokenMatchesFilters(token, filters)) || tokens[0] || null;
  return {
    catalogId: row.catalog_key,
    name: row.name,
    faceName: row.face_name,
    manaCost: row.mana_cost,
    manaValue: Number(row.mana_value || 0),
    colors: parseJson(row.colors_json, []),
    colorIdentity: parseJson(row.color_identity_json, []),
    typeLine: row.type_line,
    oracleText: row.oracle_text,
    power: row.power,
    toughness: row.toughness,
    loyalty: row.loyalty,
    defense: row.defense,
    layout: row.layout,
    keywords: parseJson(row.keywords_json, []),
    subtypes: parseJson(row.raw_json, {}).subtypes || [],
    legalities: parseJson(row.legalities_json, {}),
    effects: Array.isArray(effects.tags) ? effects.tags : [],
    tokenPower: selectedToken?.power ?? row.token_power,
    tokenToughness: selectedToken?.toughness ?? row.token_toughness,
    tokenType: selectedToken?.type ?? row.token_type,
    tokens,
    tutorTargets: Array.isArray(effects.tutorTargets) ? effects.tutorTargets : [],
    scryfallOracleId: row.scryfall_oracle_id,
    matchReasons: reasons
  };
}

export function searchCardCatalog(input = {}) {
  const filters = normalizedFilters(input);
  const { conditions, params } = queryParts(filters);
  const where = conditions.length ? `WHERE ${conditions.join('\n      AND ')}` : '';
  const offset = (filters.page - 1) * filters.limit;
  const reasons = matchReasons(filters);

  return withCardCatalog((database) => {
    const total = Number(database.prepare(`
      SELECT COUNT(DISTINCT c.catalog_key) AS count
      FROM cards c
      ${where}
    `).get(...params).count || 0);

    const orderParams = [];
    let orderBy = 'name COLLATE NOCASE, mana_value, id';
    if (filters.sort === 'mana') orderBy = 'mana_value, name COLLATE NOCASE, id';
    const normalizedName = normalizeSearchText(filters.name);
    if (filters.sort === 'relevance' && normalizedName) {
      orderBy = `CASE
        WHEN search_name = ? THEN 0
        WHEN search_name LIKE ? ESCAPE '^' THEN 1
        ELSE 2
      END, name COLLATE NOCASE, mana_value, id`;
      const escapedName = escapeLike(normalizedName);
      orderParams.push(escapedName, `${escapedName}%`);
    }

    const rows = database.prepare(`
      WITH matched AS (
        SELECT c.*,
          ROW_NUMBER() OVER (PARTITION BY c.catalog_key ORDER BY c.variant_index, c.id) AS source_rank
        FROM cards c
        ${where}
      )
      SELECT * FROM matched
      WHERE source_rank = 1
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...params, ...orderParams, filters.limit, offset);

    const tokenProfiles = database.prepare(`
      SELECT power, toughness, token_type
      FROM card_tokens
      WHERE card_id = ?
      ORDER BY power COLLATE NOCASE, toughness COLLATE NOCASE, token_type COLLATE NOCASE
    `);
    const source = cardCatalogStatus();
    return {
      items: rows.map((row) => resultItem(
        row,
        reasons,
        tokenProfiles.all(row.id).map((token) => ({
          power: token.power,
          toughness: token.toughness,
          type: token.token_type
        })),
        filters
      )),
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: cardCatalogTotalPages(total, filters.limit),
      source: {
        version: source.sourceVersion,
        date: source.sourceDate,
        importedAt: source.importedAt
      },
      query: filters
    };
  });
}
