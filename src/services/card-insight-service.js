import { db } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';
import { safeJsonParse } from '../lib/text.js';
import { cardRowToApi } from './card-mapper.js';

const MANA_CODES = new Set(['W', 'U', 'B', 'R', 'G', 'C', 'ANY']);
const SEARCH_TARGETS = new Set([
  'land', 'basic_land', 'creature', 'artifact', 'enchantment',
  'instant', 'sorcery', 'planeswalker', 'battle', 'any', 'other'
]);
const NUMBER_WORDS = Object.freeze({
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10
});

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cardKeyForRow(row) {
  return row?.oracle_id || row?.scryfall_id || null;
}

function numberFromText(value, fallback = 1) {
  const text = String(value || '').toLowerCase();
  const numeric = text.match(/\b(\d+)\b/);
  if (numeric) return Math.max(1, Number(numeric[1]));
  for (const [word, number] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return number;
  }
  return fallback;
}

function normalizeManaCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (MANA_CODES.has(code)) return code;
  const choices = unique(code.split('/').map((part) => part.trim()).filter((part) => MANA_CODES.has(part) && part !== 'ANY'));
  if (choices.length >= 2) return choices.join('/');
  return null;
}

export function normalizeManaProduction(entries) {
  if (!Array.isArray(entries)) throw new HttpError(400, 'Mana-productie moet als lijst worden aangeleverd.');
  if (entries.length > 20) throw new HttpError(400, 'Maximaal twintig mana-productieregels zijn toegestaan.');
  const normalized = [];
  for (const raw of entries) {
    const mana = normalizeManaCode(raw?.mana);
    if (!mana) throw new HttpError(400, 'Kies een geldige manasoort.');
    const amount = Number(raw?.amount ?? 1);
    if (!Number.isInteger(amount) || amount < 1 || amount > 99) {
      throw new HttpError(400, 'De hoeveelheid geproduceerde mana moet tussen 1 en 99 liggen.');
    }
    normalized.push({
      mana,
      amount,
      variable: Boolean(raw?.variable)
    });
  }
  return normalized;
}

export function normalizeLibrarySearchTargets(values) {
  if (!Array.isArray(values)) throw new HttpError(400, 'Zoekdoelen moeten als lijst worden aangeleverd.');
  return unique(values.map((value) => String(value || '').trim().toLowerCase()))
    .filter((value) => SEARCH_TARGETS.has(value));
}

function addManaEntry(entries, entry) {
  const key = `${entry.mana}|${entry.amount}|${entry.variable ? 1 : 0}`;
  if (!entries.some((candidate) => `${candidate.mana}|${candidate.amount}|${candidate.variable ? 1 : 0}` === key)) {
    entries.push(entry);
  }
}

function deriveManaFromText(card) {
  const text = String(card.oracleText || '');
  const entries = [];
  const detectedText = [];
  const clauses = [...text.matchAll(/\badd\s+([^\n.]+)/gi)].map((match) => match[0].trim());

  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    const variable = /\bfor each\b|\bequal to\b|\bthat much\b|\bwhere x\b|\bx mana\b/.test(lower);
    if (/any (?:one )?colou?r|any type of mana|any combination of colou?rs/.test(lower)) {
      const amountMatch = lower.match(/add\s+((?:\d+)|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten))\s+mana/);
      addManaEntry(entries, { mana: 'ANY', amount: numberFromText(amountMatch?.[1], 1), variable });
      detectedText.push(clause);
      continue;
    }

    const tokens = [...clause.matchAll(/\{([WUBRGC])\}/gi)].map((match) => match[1].toUpperCase());
    if (!tokens.length) continue;
    const distinct = unique(tokens);
    const choice = /\bor\b/i.test(clause) && distinct.length > 1;
    if (choice) {
      addManaEntry(entries, { mana: distinct.join('/'), amount: 1, variable });
    } else {
      const counts = new Map();
      for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
      for (const [mana, amount] of counts) addManaEntry(entries, { mana, amount, variable });
    }
    detectedText.push(clause);
  }

  if (!entries.length && Array.isArray(card.producedMana) && card.producedMana.length) {
    const colors = unique(card.producedMana.map((value) => String(value).toUpperCase()).filter((value) => MANA_CODES.has(value)));
    const variable = clauses.some((clause) => /\bfor each\b|\bequal to\b|\bthat much\b|\bwhere x\b|\bx mana\b|\ban amount of mana\b/i.test(clause));
    const amountClause = clauses.find((clause) => /\badd\b/i.test(clause)) || '';
    const amountMatch = amountClause.match(/add\s+((?:\d+)|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten))\s+mana/i);
    const amount = numberFromText(amountMatch?.[1], 1);
    if (colors.length === 1) addManaEntry(entries, { mana: colors[0], amount, variable });
    else if (colors.length > 1) addManaEntry(entries, { mana: colors.join('/'), amount, variable });
    return { source: entries.length ? 'scryfall' : 'none', entries, detectedText: clauses };
  }

  return { source: entries.length ? 'oracle' : 'none', entries, detectedText };
}

function deriveLibrarySearchFromText(card) {
  const text = String(card.oracleText || '');
  if (!/search your library/i.test(text)) return { source: 'none', targets: [], detectedText: [] };

  const targets = [];
  const detectedText = [];
  const clauses = [...text.matchAll(/search your library(?: and\/or your graveyard)? for ([^\n.]+)/gi)];
  for (const match of clauses) {
    const clause = match[0].trim();
    const descriptor = String(match[1] || '').toLowerCase();
    detectedText.push(clause);

    const clauseTargets = [];
    if (/basic land|\bplains\b|\bisland\b|\bswamp\b|\bmountain\b|\bforest\b/.test(descriptor)) clauseTargets.push('basic_land');
    else if (/\bland\b/.test(descriptor)) clauseTargets.push('land');
    if (/\bcreature\b/.test(descriptor)) clauseTargets.push('creature');
    if (/\bartifact\b|\bequipment\b|\bvehicle\b/.test(descriptor)) clauseTargets.push('artifact');
    if (/\benchantment\b|\baura\b|\bbackground\b/.test(descriptor)) clauseTargets.push('enchantment');
    if (/\binstant\b/.test(descriptor)) clauseTargets.push('instant');
    if (/\bsorcery\b/.test(descriptor)) clauseTargets.push('sorcery');
    if (/\bplaneswalker\b/.test(descriptor)) clauseTargets.push('planeswalker');
    if (/\bbattle\b/.test(descriptor)) clauseTargets.push('battle');

    if (!clauseTargets.length) {
      const namedOrQualified = /card named|cards? with|cards? that|with the same name|named |from outside|of your choice/.test(descriptor);
      const genericCard = /^(?:up to\s+)?(?:a|an|one|two|three|four|five|any(?: number of)?)?\s*cards?\b/.test(descriptor);
      clauseTargets.push(/\bcards?\b/.test(descriptor) && genericCard && !namedOrQualified ? 'any' : 'other');
    }
    targets.push(...clauseTargets);
  }
  if (!targets.length) targets.push('other');
  return { source: 'oracle', targets: unique(targets), detectedText };
}

export function metadataMapForKeys(keys) {
  const uniqueKeys = unique(keys);
  const map = new Map();
  if (!uniqueKeys.length) return map;
  const placeholders = uniqueKeys.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT * FROM card_user_metadata WHERE card_key IN (${placeholders})
  `).all(...uniqueKeys);
  for (const row of rows) map.set(row.card_key, row);
  return map;
}

function insightsForCard(card, metadataRow = null) {
  const autoMana = deriveManaFromText(card);
  const autoSearch = deriveLibrarySearchFromText(card);
  const hasManualMana = metadataRow?.mana_production_json !== null && metadataRow?.mana_production_json !== undefined;
  const hasManualSearch = metadataRow?.library_search_targets_json !== null && metadataRow?.library_search_targets_json !== undefined;
  const manualMana = hasManualMana ? safeJsonParse(metadataRow.mana_production_json, []) : null;
  const manualSearch = hasManualSearch ? safeJsonParse(metadataRow.library_search_targets_json, []) : null;

  return {
    manaProduction: {
      source: hasManualMana ? 'manual' : autoMana.source,
      automaticSource: autoMana.source,
      entries: hasManualMana ? normalizeStoredMana(manualMana) : autoMana.entries,
      note: metadataRow?.mana_production_note || '',
      detectedText: hasManualMana ? [] : autoMana.detectedText,
      automaticEntries: autoMana.entries
    },
    librarySearch: {
      source: hasManualSearch ? 'manual' : autoSearch.source,
      automaticSource: autoSearch.source,
      targets: hasManualSearch ? normalizeStoredTargets(manualSearch) : autoSearch.targets,
      note: metadataRow?.library_search_note || '',
      detectedText: hasManualSearch ? [] : autoSearch.detectedText,
      automaticTargets: autoSearch.targets
    }
  };
}

function normalizeStoredMana(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => ({
    mana: normalizeManaCode(entry?.mana) || 'C',
    amount: Math.max(1, Number.parseInt(entry?.amount || 1, 10)),
    variable: Boolean(entry?.variable)
  }));
}

function normalizeStoredTargets(value) {
  if (!Array.isArray(value)) return [];
  return unique(value.map((entry) => String(entry || '').toLowerCase()).filter((entry) => SEARCH_TARGETS.has(entry)));
}

export function enrichCardsWithInsights(cards) {
  const source = Array.isArray(cards) ? cards : [];
  const map = metadataMapForKeys(source.map((card) => card?.cardKey));
  return source.map((card) => ({
    ...card,
    insights: insightsForCard(card, map.get(card.cardKey) || null)
  }));
}

export function enrichCardWithInsights(card) {
  if (!card) return null;
  return enrichCardsWithInsights([card])[0];
}

export function updateCardUserMetadata(cardId, input = {}) {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!row) throw new HttpError(404, 'Kaart niet gevonden.');
  const card = cardRowToApi(row);
  const key = cardKeyForRow(row);
  const existing = db.prepare('SELECT * FROM card_user_metadata WHERE card_key = ?').get(key) || {};

  const manaMode = input.manaMode === undefined ? (existing.mana_production_json == null ? 'automatic' : 'manual') : String(input.manaMode);
  const searchMode = input.searchMode === undefined ? (existing.library_search_targets_json == null ? 'automatic' : 'manual') : String(input.searchMode);
  if (!['automatic', 'manual'].includes(manaMode)) throw new HttpError(400, 'Ongeldige modus voor mana-productie.');
  if (!['automatic', 'manual'].includes(searchMode)) throw new HttpError(400, 'Ongeldige modus voor deckzoekfuncties.');

  const manaJson = manaMode === 'automatic'
    ? null
    : JSON.stringify(normalizeManaProduction(input.manaProduction ?? safeJsonParse(existing.mana_production_json, [])));
  const searchJson = searchMode === 'automatic'
    ? null
    : JSON.stringify(normalizeLibrarySearchTargets(input.librarySearchTargets ?? safeJsonParse(existing.library_search_targets_json, [])));
  const manaNote = String(input.manaProductionNote ?? existing.mana_production_note ?? '').trim().slice(0, 1000);
  const searchNote = String(input.librarySearchNote ?? existing.library_search_note ?? '').trim().slice(0, 1000);

  db.prepare(`
    INSERT INTO card_user_metadata (
      card_key, mana_production_json, mana_production_note,
      library_search_targets_json, library_search_note
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(card_key) DO UPDATE SET
      mana_production_json = excluded.mana_production_json,
      mana_production_note = excluded.mana_production_note,
      library_search_targets_json = excluded.library_search_targets_json,
      library_search_note = excluded.library_search_note,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, manaJson, manaNote, searchJson, searchNote);

  return enrichCardWithInsights(card);
}

