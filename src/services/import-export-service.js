import { db } from '../db/database.js';
import { addCollectionItem } from './card-repository.js';
import { addDeckCard, requireDeck } from './deck-service.js';
import { ensureCardsByIdentifiers } from './card-cache-service.js';
import { normalizeSearchText } from '../lib/text.js';
import { HttpError } from '../lib/http-error.js';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers, rows) {
  return [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\r\n') + '\r\n';
}

function headerMap(header) {
  return new Map(header.map((name, index) => [normalizeSearchText(name).replace(/ /g, '_'), index]));
}

function cell(row, map, ...names) {
  for (const name of names) {
    const index = map.get(name);
    if (index !== undefined) return String(row[index] ?? '').trim();
  }
  return '';
}

export async function importCollectionCsv(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new HttpError(400, 'Het CSV-bestand bevat geen gegevensregels.');
  const map = headerMap(rows[0]);
  if (![...map.keys()].some((key) => ['name', 'kaartnaam', 'card_name'].includes(key))) {
    throw new HttpError(400, 'De CSV-kop moet een kolom name, card_name of kaartnaam bevatten.');
  }

  const parsed = rows.slice(1).map((row, index) => {
    const name = cell(row, map, 'name', 'card_name', 'kaartnaam');
    const set = cell(row, map, 'set', 'set_code', 'setcode').toLowerCase();
    const collectorNumber = cell(row, map, 'collector_number', 'collector', 'verzamelnummer');
    return {
      line: index + 2,
      name,
      set,
      collectorNumber,
      quantity: Math.max(Number.parseInt(cell(row, map, 'quantity', 'aantal') || '1', 10) || 1, 1),
      finish: cell(row, map, 'finish', 'afwerking') || 'nonfoil',
      language: cell(row, map, 'language', 'lang', 'taal') || 'en',
      condition: cell(row, map, 'condition', 'conditie') || 'near_mint',
      location: cell(row, map, 'location', 'locatie'),
      notes: cell(row, map, 'notes', 'opmerkingen', 'notities'),
      purchasePrice: Number(cell(row, map, 'purchase_price', 'aankoopprijs')) || null
    };
  }).filter((row) => row.name);

  const identifiers = parsed.map((row) => row.set && row.collectorNumber
    ? { set: row.set, collector_number: row.collectorNumber }
    : row.set ? { name: row.name, set: row.set } : { name: row.name });
  const ensured = await ensureCardsByIdentifiers(identifiers);
  const cardMap = new Map();
  for (const result of ensured.resolved) {
    const identifier = result.identifier;
    const key = identifier.collector_number
      ? `${identifier.set}|${identifier.collector_number}`
      : `${normalizeSearchText(identifier.name)}|${identifier.set || ''}`;
    cardMap.set(key, result.card);
  }

  const imported = [];
  const failed = [];
  for (const row of parsed) {
    const key = row.set && row.collectorNumber
      ? `${row.set}|${row.collectorNumber}`
      : `${normalizeSearchText(row.name)}|${row.set || ''}`;
    const card = cardMap.get(key) || cardMap.get(`${normalizeSearchText(row.name)}|`);
    if (!card) {
      failed.push({ line: row.line, name: row.name, reason: 'Niet gevonden bij Scryfall' });
      continue;
    }
    try {
      imported.push(addCollectionItem({
        cardId: card.id,
        quantity: row.quantity,
        finish: ['foil', 'etched'].includes(row.finish) ? row.finish : 'nonfoil',
        language: row.language,
        condition: row.condition,
        location: row.location,
        notes: row.notes,
        purchasePrice: row.purchasePrice,
        reconcileWanted: true
      }));
    } catch (error) {
      failed.push({ line: row.line, name: row.name, reason: error.message });
    }
  }
  return { importedCount: imported.length, imported, failed, notFound: ensured.notFound };
}

export function parseDeckList(text) {
  const rows = [];
  let currentRole = 'main';
  const headings = new Map([
    ['commander', 'commander'], ['commanders', 'commander'], ['partner', 'partner'],
    ['companion', 'companion'], ['sideboard', 'sideboard'], ['maybeboard', 'maybeboard'],
    ['mainboard', 'main'], ['deck', 'main']
  ]);

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const normalizedHeading = normalizeSearchText(line.replace(/[:\[\]]/g, ''));
    if (headings.has(normalizedHeading)) {
      currentRole = headings.get(normalizedHeading);
      continue;
    }
    let role = currentRole;
    if (/^SB:\s*/i.test(line)) {
      role = 'sideboard';
      line = line.replace(/^SB:\s*/i, '');
    }
    const match = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const quantity = match ? Number.parseInt(match[1], 10) : 1;
    let remainder = (match ? match[2] : line).trim();
    remainder = remainder.replace(/\s+\*F\*\s*$/i, '').trim();
    const printing = remainder.match(/^(.*?)\s+\(([A-Za-z0-9]+)\)\s+([^\s]+)(?:\s+.*)?$/);
    let name = remainder;
    let set = '';
    let collectorNumber = '';
    if (printing) {
      name = printing[1].trim();
      set = printing[2].toLowerCase();
      collectorNumber = printing[3];
    }
    if (name) rows.push({ quantity: Math.max(quantity, 1), name, set, collectorNumber, role });
  }
  return rows;
}

export async function importDeckList(deckId, text) {
  requireDeck(deckId);
  const rows = parseDeckList(text);
  if (!rows.length) throw new HttpError(400, 'Geen geldige deckregels gevonden. Gebruik bijvoorbeeld: 1 Sol Ring');
  const identifiers = rows.map((row) => row.set && row.collectorNumber
    ? { set: row.set, collector_number: row.collectorNumber }
    : row.set ? { name: row.name, set: row.set } : { name: row.name });
  const ensured = await ensureCardsByIdentifiers(identifiers);
  const cardMap = new Map();
  for (const result of ensured.resolved) {
    const identifier = result.identifier;
    const key = identifier.collector_number
      ? `${identifier.set}|${identifier.collector_number}`
      : `${normalizeSearchText(identifier.name)}|${identifier.set || ''}`;
    cardMap.set(key, result.card);
  }

  const imported = [];
  const failed = [];
  for (const row of rows) {
    const key = row.set && row.collectorNumber
      ? `${row.set}|${row.collectorNumber}`
      : `${normalizeSearchText(row.name)}|${row.set || ''}`;
    const card = cardMap.get(key) || cardMap.get(`${normalizeSearchText(row.name)}|`);
    if (!card) {
      failed.push({ name: row.name, reason: 'Niet gevonden bij Scryfall' });
      continue;
    }
    try {
      imported.push(addDeckCard(deckId, {
        cardId: card.id,
        quantity: row.quantity,
        role: row.role,
        note: '',
        tags: []
      }));
    } catch (error) {
      failed.push({ name: row.name, reason: error.message });
    }
  }
  return { importedCount: imported.length, imported, failed, notFound: ensured.notFound };
}


export function exportCollectionCsv() {
  const rows = db.prepare(`
    SELECT c.name, c.set_code, c.set_name, c.collector_number, ci.quantity, ci.finish,
      ci.language, ci.condition, ci.location, ci.notes, ci.purchase_price, c.scryfall_id
    FROM collection_items ci JOIN cards c ON c.id = ci.card_id
    ORDER BY c.name COLLATE NOCASE, c.set_code, c.collector_number, ci.finish
  `).all();
  return toCsv(
    ['name', 'set_code', 'set_name', 'collector_number', 'quantity', 'finish', 'language', 'condition', 'location', 'notes', 'purchase_price', 'scryfall_id'],
    rows.map((row) => [row.name, row.set_code, row.set_name, row.collector_number, row.quantity, row.finish, row.language, row.condition, row.location, row.notes, row.purchase_price, row.scryfall_id])
  );
}

export function exportWantedCsv() {
  const rows = db.prepare(`
    SELECT c.name,
      pc.set_code, pc.set_name, pc.collector_number, pc.scryfall_id,
      w.quantity, w.priority, w.maximum_price, w.notes
    FROM wanted_items w
    JOIN cards c ON c.id = w.card_id
    LEFT JOIN cards pc ON pc.id = w.printing_card_id
    WHERE NOT (c.card_types_json LIKE '%"Land"%' AND c.supertypes_json LIKE '%"Basic"%')
    ORDER BY w.priority, c.name COLLATE NOCASE
  `).all();
  return toCsv(
    ['name', 'set_code', 'set_name', 'collector_number', 'quantity', 'priority', 'maximum_price', 'notes', 'scryfall_id'],
    rows.map((row) => [row.name, row.set_code || '', row.set_name || '', row.collector_number || '', row.quantity, row.priority, row.maximum_price, row.notes, row.scryfall_id || ''])
  );
}
