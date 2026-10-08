import { createHash } from 'node:crypto';
import { db, transaction } from '../db/database.js';
import { addDeckCard, requireDeck } from './deck-service.js';
import { ensureCardsByCollectorLanguage, ensureCardsByIdentifiers } from './card-cache-service.js';
import { addCollectionItem } from './card-repository.js';
import { normalizeSearchText, safeJsonParse } from '../lib/text.js';
import { HttpError } from '../lib/http-error.js';
import { cardMatchesRequestedName as matchesCardName } from '../lib/card-identity.js';

const MAX_COLLECTION_IMPORT_ROWS = 1000;
const MAX_COLLECTION_IMPORT_QUANTITY = 10000;

const COLLECTION_IMPORT_HEADINGS = new Set([
  'commander', 'commanders', 'partner', 'companion', 'sideboard', 'sb', 'maybeboard',
  'main', 'mainboard', 'main deck', 'maindeck', 'deck', 'creature', 'creatures', 'artifact', 'artifacts',
  'enchantment', 'enchantments', 'instant', 'instants', 'sorcery', 'sorceries',
  'land', 'lands', 'planeswalker', 'planeswalkers', 'battle', 'battles', 'other'
]);

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers, rows) {
  return [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\r\n') + '\r\n';
}

export function parseDeckList(text) {
  const rows = [];
  let currentRole = 'main';
  const headings = new Map([
    ['commander', 'commander'], ['commanders', 'commander'], ['partner', 'partner'],
    ['companion', 'companion'], ['sideboard', 'sideboard'], ['maybeboard', 'maybeboard'],
    ['mainboard', 'main'], ['deck', 'main']
  ]);

  for (const [index, rawLine] of String(text || '').split(/\r?\n/).entries()) {
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
    const checkedQuantity = parseCollectionQuantity(line);
    if (checkedQuantity.error) throw new HttpError(400, `Regel ${index + 1}: ${checkedQuantity.error}`);
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
    if (name) rows.push({ quantity, name, set, collectorNumber, role });
  }
  return rows;
}

function importFailure(line, rawLine, code, message) {
  return { line, rawLine, code, message };
}

function collectionImportHeading(line) {
  const withoutCount = line.replace(/\s*\(\d+\)\s*$/u, '');
  const normalized = normalizeSearchText(withoutCount.replace(/[:\[\]]/g, ''));
  return COLLECTION_IMPORT_HEADINGS.has(normalized);
}

function parseCollectionQuantity(line) {
  // A comma followed by three digits can be part of a real card name, for
  // example "10,000 Year Storm". Quantities themselves do not accept group
  // separators, so leave this form intact as a name.
  if (/^\d{1,3}(?:,\d{3})+\s+.+$/u.test(line)) {
    return { quantity: 1, remainder: line };
  }
  // `+2 Mace` is a real card name. A leading plus is never accepted as a
  // quantity, so it can safely remain part of the name.
  if (/^\+\d+\s+.+$/u.test(line)) {
    return { quantity: 1, remainder: line };
  }
  const withWhitespace = line.match(/^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*x?\s+(.+)$/iu);
  const compactX = withWhitespace ? null : line.match(/^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))x(.+)$/iu);
  const match = withWhitespace || compactX;
  if (!match) return { quantity: 1, remainder: line };

  const rawQuantity = match[1];
  if (!/^\d+$/u.test(rawQuantity)) {
    return { error: 'Aantal moet een positief geheel getal zijn.' };
  }
  const quantity = Number(rawQuantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return { error: 'Aantal moet een positief geheel getal zijn.' };
  }
  if (quantity > MAX_COLLECTION_IMPORT_QUANTITY) {
    return { error: `Aantal mag per regel maximaal ${MAX_COLLECTION_IMPORT_QUANTITY} zijn.` };
  }
  const usedExplicitX = /x\s*$/iu.test(line.slice(0, match[0].length - match[2].length));
  return {
    quantity,
    remainder: match[2].trim(),
    // Very large leading numbers are also used by a handful of real card
    // names. Resolution may prefer this full-name interpretation when it
    // actually matches a card; `1996x ...` remains unambiguously a quantity.
    fallbackName: !usedExplicitX && quantity >= 1000 ? line : ''
  };
}

export function parseCollectionList(text) {
  const rows = [];
  const failures = [];
  let candidateRows = 0;
  let rowLimitReported = false;

  for (const [index, sourceLine] of String(text || '').split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const rawLine = sourceLine;
    let line = sourceLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//') || collectionImportHeading(line)) continue;

    candidateRows += 1;
    if (candidateRows > MAX_COLLECTION_IMPORT_ROWS) {
      if (!rowLimitReported) {
        failures.push(importFailure(
          lineNumber,
          rawLine,
          'too_many_rows',
          `Een import mag maximaal ${MAX_COLLECTION_IMPORT_ROWS} kaartregels bevatten.`
        ));
        rowLimitReported = true;
      }
      continue;
    }

    if (/^SB:\s*/iu.test(line)) line = line.replace(/^SB:\s*/iu, '').trim();
    const finishMarker = line.match(/\s+\*([^*\s]+)\*\s*$/u);
    const normalizedMarker = String(finishMarker?.[1] || '').toUpperCase();
    if (finishMarker && !['F', 'E'].includes(normalizedMarker)) {
      failures.push(importFailure(
        lineNumber,
        rawLine,
        'unknown_finish_marker',
        `Onbekende afwerkingsmarkering *${finishMarker[1]}*. Gebruik *F* voor foil of *E* voor etched foil.`
      ));
      continue;
    }
    const finishOverride = normalizedMarker === 'F' ? 'foil' : normalizedMarker === 'E' ? 'etched' : '';
    if (finishMarker) line = line.slice(0, finishMarker.index).trim();

    const parsedQuantity = parseCollectionQuantity(line);
    if (parsedQuantity.error) {
      failures.push(importFailure(lineNumber, rawLine, 'invalid_quantity', parsedQuantity.error));
      continue;
    }

    const remainder = parsedQuantity.remainder;
    if (!remainder) {
      failures.push(importFailure(lineNumber, rawLine, 'missing_name', 'Kaartnaam ontbreekt.'));
      continue;
    }

    const printingWithSuffix = remainder.match(/^(.*?)\s+\(([A-Za-z0-9]+)\)\s+([^\s]+)\s+(.+)$/u);
    if (printingWithSuffix) {
      failures.push(importFailure(
        lineNumber,
        rawLine,
        'unexpected_suffix',
        `Onbekende tekst na kaartnummer: “${printingWithSuffix[4]}”. Alleen *F* en *E* zijn als markering toegestaan.`
      ));
      continue;
    }
    const printing = remainder.match(/^(.*?)\s+\(([A-Za-z0-9]+)\)\s+([^\s]+)$/u);
    if (!printing && /\([A-Za-z0-9]+\)\s*$/u.test(remainder)) {
      failures.push(importFailure(
        lineNumber,
        rawLine,
        'missing_collector_number',
        'Bij een setcode is ook een kaartnummer verplicht, bijvoorbeeld: 1 Sol Ring (CMM) 396.'
      ));
      continue;
    }

    const name = (printing ? printing[1] : remainder).trim();
    if (!name) {
      failures.push(importFailure(lineNumber, rawLine, 'missing_name', 'Kaartnaam ontbreekt.'));
      continue;
    }

    let fallbackName = '';
    if (parsedQuantity.fallbackName) {
      if (printing) {
        const fallbackPrinting = parsedQuantity.fallbackName.match(/^(.*?)\s+\(([A-Za-z0-9]+)\)\s+([^\s]+)$/u);
        if (fallbackPrinting
          && fallbackPrinting[2].toLowerCase() === printing[2].toLowerCase()
          && fallbackPrinting[3].toLowerCase() === printing[3].toLowerCase()) {
          fallbackName = fallbackPrinting[1].trim();
        }
      } else {
        fallbackName = parsedQuantity.fallbackName;
      }
    }

    rows.push({
      line: lineNumber,
      rawLine,
      quantity: parsedQuantity.quantity,
      name,
      set: printing ? printing[2].toLowerCase() : '',
      collectorNumber: printing ? printing[3] : '',
      foil: finishOverride === 'foil',
      finishOverride,
      fallbackName
    });
  }

  if (!rows.length && !failures.length) {
    failures.push(importFailure(0, '', 'empty_import', 'Geen geldige kaartregels gevonden. Gebruik bijvoorbeeld: 1 Sol Ring'));
  }

  return { rows, failures, candidateRows };
}

function collectionIdentifier(row) {
  return row.set && row.collectorNumber
    ? { set: row.set, collector_number: row.collectorNumber }
    : { name: row.name };
}

function collectionIdentifierKey(identifier) {
  if (identifier.set && identifier.collector_number) {
    return `collector:${String(identifier.set).toLowerCase()}|${String(identifier.collector_number).toLowerCase()}`;
  }
  return `name:${normalizeSearchText(identifier.name)}`;
}

function uniqueCollectionIdentifiers(rows) {
  const identifiers = new Map();
  for (const row of rows) {
    const rowIdentifiers = [
      collectionIdentifier(row),
      ...(!row.set && row.fallbackName ? [{ name: row.fallbackName }] : [])
    ];
    for (const identifier of rowIdentifiers) {
      const key = collectionIdentifierKey(identifier);
      if (!identifiers.has(key)) identifiers.set(key, identifier);
    }
  }
  return [...identifiers.values()];
}

const cardRawJsonStatement = db.prepare('SELECT raw_json FROM cards WHERE id = ?');

function cardRawData(card) {
  const row = cardRawJsonStatement.get(card.id);
  return safeJsonParse(row?.raw_json, {});
}

function cardMatchesRequestedName(card, requestedName) {
  return matchesCardName(card, requestedName, cardRawData(card));
}

function cardSupportsPaper(card) {
  const games = cardRawData(card)?.games;
  return !Array.isArray(games) || games.includes('paper');
}

async function resolveCollectionImport(text, defaults) {
  const parsed = parseCollectionList(text);
  const selectedLanguage = String(defaults.language || 'en').toLowerCase();
  const identifiers = uniqueCollectionIdentifiers(parsed.rows);
  const exactIdentifiers = identifiers.filter((identifier) => identifier.set && identifier.collector_number);
  const nameIdentifiers = selectedLanguage === 'en'
    ? identifiers.filter((identifier) => identifier.name)
    : [];
  const [ensuredNames, ensuredExact] = await Promise.all([
    nameIdentifiers.length
      ? ensureCardsByIdentifiers(nameIdentifiers)
      : Promise.resolve({ resolved: [], notFound: [] }),
    exactIdentifiers.length
      ? ensureCardsByCollectorLanguage(exactIdentifiers, selectedLanguage)
      : Promise.resolve({ resolved: [], notFound: [] })
  ]);
  const cardMap = new Map();
  for (const result of [...ensuredNames.resolved, ...ensuredExact.resolved]) {
    cardMap.set(collectionIdentifierKey(result.identifier), result.card);
  }

  // A name lookup can hit a cached foreign-language card. Keep the inferred
  // printing, but resolve its English counterpart in grouped set requests so
  // the stored language always matches the selected language.
  if (selectedLanguage === 'en') {
    const foreignNameResults = ensuredNames.resolved.filter((result) => (
      String(result.card.language || 'en').toLowerCase() !== 'en'
    ));
    const englishIdentifiers = uniqueCollectionIdentifiers(foreignNameResults.map(({ card }) => ({
      set: card.setCode,
      collectorNumber: card.collectorNumber
    })));
    if (englishIdentifiers.length) {
      const englishCards = await ensureCardsByCollectorLanguage(englishIdentifiers, 'en');
      const englishByPrinting = new Map(englishCards.resolved.map((result) => [
        collectionIdentifierKey(result.identifier),
        result.card
      ]));
      for (const result of foreignNameResults) {
        const englishCard = englishByPrinting.get(collectionIdentifierKey({
          set: result.card.setCode,
          collector_number: result.card.collectorNumber
        }));
        if (englishCard) cardMap.set(collectionIdentifierKey(result.identifier), englishCard);
        else cardMap.delete(collectionIdentifierKey(result.identifier));
      }
    }
  }

  const failures = [...parsed.failures];
  const items = [];
  for (const row of parsed.rows) {
    if (!(row.set && row.collectorNumber) && selectedLanguage !== 'en') {
      failures.push(importFailure(
        row.line,
        row.rawLine,
        'language_requires_exact_printing',
        `Gebruik voor taal ${selectedLanguage.toUpperCase()} ook de setcode en het kaartnummer, bijvoorbeeld: 1 Sol Ring (CMM) 396.`
      ));
      continue;
    }

    const identifier = collectionIdentifier(row);
    const identifierKey = collectionIdentifierKey(identifier);
    let resolvedRow = row;
    let card = cardMap.get(identifierKey);

    if (row.fallbackName) {
      const fallbackCard = row.set && row.collectorNumber
        ? (card && cardMatchesRequestedName(card, row.fallbackName) ? card : null)
        : cardMap.get(collectionIdentifierKey({ name: row.fallbackName }));
      const primaryMatches = row.set && row.collectorNumber
        ? (card && cardMatchesRequestedName(card, row.name))
        : Boolean(card);
      if (primaryMatches && fallbackCard) {
        failures.push(importFailure(
          row.line,
          row.rawLine,
          'ambiguous_quantity',
          `Deze regel kan zowel een kaartnaam als een aantal betekenen. Gebruik bijvoorbeeld “1x ${row.fallbackName}” om het aantal expliciet te maken.`
        ));
        continue;
      }
      if (fallbackCard) {
        card = fallbackCard;
        resolvedRow = { ...row, quantity: 1, name: row.fallbackName };
      }
    }
    if (!card) {
      failures.push(importFailure(
        row.line,
        row.rawLine,
        'card_not_found',
        row.set && row.collectorNumber
          ? `Geen printing gevonden voor ${row.set.toUpperCase()} #${row.collectorNumber} in taal ${selectedLanguage.toUpperCase()}.`
          : `Kaart “${row.name}” is niet gevonden.`
      ));
      continue;
    }

    if (!cardSupportsPaper(card)) {
      failures.push(importFailure(
        row.line,
        row.rawLine,
        'not_available_on_paper',
        `${card.name} (${card.setCode.toUpperCase()} #${card.collectorNumber}) is geen fysieke paper-printing.`
      ));
      continue;
    }

    if (row.set && row.collectorNumber && !cardMatchesRequestedName(card, resolvedRow.name)) {
      failures.push(importFailure(
        row.line,
        row.rawLine,
        'name_mismatch',
        `${row.set.toUpperCase()} #${row.collectorNumber} hoort bij “${card.name}”, niet bij “${resolvedRow.name}”.`
      ));
      continue;
    }

    const finish = row.finishOverride || defaults.finish;
    if (!Array.isArray(card.finishes) || !card.finishes.includes(finish)) {
      failures.push(importFailure(
        row.line,
        row.rawLine,
        'unsupported_finish',
        `${card.name} (${card.setCode.toUpperCase()}) is niet beschikbaar als ${finish}.`
      ));
      continue;
    }

    const inferredPrinting = !(row.set && row.collectorNumber);
    items.push({
      ...resolvedRow,
      finish,
      language: selectedLanguage,
      inferredPrinting,
      warning: inferredPrinting
        ? 'Geen set en kaartnummer opgegeven; de automatisch gekozen printing wordt gebruikt.'
        : '',
      card
    });
  }

  failures.sort((left, right) => left.line - right.line);
  return { parsed, items, failures, defaults: { ...defaults, language: selectedLanguage } };
}

function collectionImportPreview(result) {
  const quantity = result.items.reduce((total, item) => total + item.quantity, 0);
  const inferredPrintings = result.items.filter((item) => item.inferredPrinting).length;
  const previewToken = createHash('sha256').update(JSON.stringify({
    items: result.items.map((item) => ({
      cardId: item.card.id,
      scryfallId: item.card.scryfallId,
      quantity: item.quantity,
      finish: item.finish,
      language: item.language
    })),
    defaults: {
      condition: result.defaults.condition,
      location: result.defaults.location,
      notes: result.defaults.notes,
      reconcileWanted: result.defaults.reconcileWanted
    }
  })).digest('hex');
  return {
    canImport: result.failures.length === 0 && result.items.length > 0,
    previewToken,
    items: result.items.map((item) => ({
      line: item.line,
      rawLine: item.rawLine,
      requestedName: item.name,
      cardId: item.card.id,
      scryfallId: item.card.scryfallId,
      name: item.card.name,
      setCode: item.card.setCode,
      setName: item.card.setName,
      collectorNumber: item.card.collectorNumber,
      quantity: item.quantity,
      finish: item.finish,
      language: item.language,
      printingLanguage: item.card.language,
      inferredPrinting: item.inferredPrinting,
      warning: item.warning
    })),
    failures: result.failures,
    summary: {
      rows: result.parsed.candidateRows,
      resolvedRows: result.items.length,
      quantity,
      totalQuantity: quantity,
      failureCount: result.failures.length,
      inferredPrintings,
      inferredCount: inferredPrintings
    }
  };
}

export async function previewCollectionImport(text, defaults) {
  return collectionImportPreview(await resolveCollectionImport(text, defaults));
}

function aggregateCollectionImportItems(items, defaults) {
  const groups = new Map();
  for (const item of items) {
    const key = [item.card.id, item.finish, defaults.language, defaults.condition, defaults.location].join('|');
    const current = groups.get(key);
    if (current) {
      current.quantity += item.quantity;
      current.sourceLines.push(item.line);
      continue;
    }
    groups.set(key, {
      card: item.card,
      quantity: item.quantity,
      finish: item.finish,
      sourceLines: [item.line]
    });
  }
  return [...groups.values()];
}

export async function importCollectionList(text, defaults, expectedPreviewToken = '') {
  const resolved = await resolveCollectionImport(text, defaults);
  const preview = collectionImportPreview(resolved);
  if (!preview.canImport) {
    throw new HttpError(422, 'De collectie-import bevat fouten. Los deze op en probeer het opnieuw.', preview);
  }
  if (expectedPreviewToken && preview.previewToken !== expectedPreviewToken) {
    throw new HttpError(409, 'De gekozen printings zijn sinds de controle gewijzigd. Controleer de lijst opnieuw.', preview);
  }

  const groups = aggregateCollectionImportItems(resolved.items, defaults);
  const imported = transaction(() => groups.map((group) => {
    const item = addCollectionItem({
      cardId: group.card.id,
      quantity: group.quantity,
      finish: group.finish,
      language: defaults.language,
      condition: defaults.condition,
      location: defaults.location,
      notes: defaults.notes,
      purchasePrice: null,
      reconcileWanted: defaults.reconcileWanted,
      sourceWantedId: null
    });
    return {
      id: item.id,
      cardId: group.card.id,
      name: group.card.name,
      setCode: group.card.setCode,
      collectorNumber: group.card.collectorNumber,
      quantity: group.quantity,
      finish: group.finish,
      sourceLines: group.sourceLines
    };
  }));

  return {
    importedCount: preview.items.length,
    importedQuantity: preview.summary.quantity,
    imported,
    summary: {
      ...preview.summary,
      importedRows: preview.items.length,
      importedQuantity: preview.summary.quantity,
      collectionItems: imported.length
    }
  };
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
    if (row.set && row.collectorNumber && !cardMatchesRequestedName(card, row.name)) {
      failed.push({
        name: row.name,
        reason: `${row.set.toUpperCase()} #${row.collectorNumber} hoort bij “${card.name}”, niet bij “${row.name}”.`
      });
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
