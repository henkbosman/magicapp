import { config } from '../config.js';
import { db, transaction } from '../db/database.js';
import { cardRowToApi } from './card-mapper.js';
import {
  getCardById,
  getCardByScryfallId,
  getPrintingsByName,
  upsertScryfallCard
} from './card-repository.js';
import { groupPrintings, summarizeLocalPrinting } from './printing-service.js';
import { scryfallService } from './scryfall-service.js';

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];
const syncInFlight = new Map();
const INCOMPLETE_RETRY_MS = 15 * 60 * 1000;

function sortPrintings(printings) {
  return [...printings].sort((a, b) =>
    String(b.releasedAt || '').localeCompare(String(a.releasedAt || ''))
    || String(a.setName || '').localeCompare(String(b.setName || ''), 'nl')
    || String(a.collectorNumber || '').localeCompare(String(b.collectorNumber || ''), undefined, { numeric: true })
  );
}

function parseSummary(row) {
  try {
    return JSON.parse(row.summary_json);
  } catch (error) {
    console.warn('[printing-catalog] Ongeldige catalogusregel verwijderd:', row.card_key, row.printing_key, error.message);
    db.prepare('DELETE FROM card_printing_catalog WHERE card_key = ? AND printing_key = ?')
      .run(row.card_key, row.printing_key);
    return null;
  }
}

export function getCatalogPrintings(cardKey) {
  if (!cardKey) return [];
  return sortPrintings(db.prepare(`
    SELECT * FROM card_printing_catalog
    WHERE card_key = ?
    ORDER BY released_at DESC, set_name COLLATE NOCASE, collector_number
  `).all(cardKey).map(parseSummary).filter(Boolean));
}

export function printingCatalogState(cardKey) {
  const row = db.prepare(`
    SELECT complete, synced_at, last_attempt_at, last_error
    FROM card_printing_catalog_state
    WHERE card_key = ?
  `).get(cardKey);
  return row ? {
    complete: Boolean(row.complete),
    syncedAt: row.synced_at === null ? null : Number(row.synced_at),
    lastAttemptAt: Number(row.last_attempt_at || 0),
    lastError: row.last_error || ''
  } : null;
}

export function printingCatalogIsComplete(cardKey) {
  return printingCatalogState(cardKey)?.complete === true;
}


function catalogRefreshIsDue(cardKey, force = false) {
  if (force) return true;
  const state = printingCatalogState(cardKey);
  if (!state) return true;
  if (state.complete) {
    const stale = Number(state.syncedAt || 0) <= Date.now() - config.scryfallPrintingCatalogTtlMs;
    if (!stale) return false;
    // Na een mislukte vernieuwing blijft een volledige, maar verouderde
    // catalogus bruikbaar. Wacht kort voordat dezelfde externe call opnieuw
    // wordt geprobeerd.
    if (state.lastError && Number(state.lastAttemptAt || 0) > Date.now() - INCOMPLETE_RETRY_MS) return false;
    return true;
  }
  return Number(state.lastAttemptAt || 0) <= Date.now() - INCOMPLETE_RETRY_MS;
}

function markCatalogAttempt(cardKey, { complete, syncedAt = null, error = '' }) {
  db.prepare(`
    INSERT INTO card_printing_catalog_state (
      card_key, complete, synced_at, last_attempt_at, last_error
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(card_key) DO UPDATE SET
      complete = excluded.complete,
      synced_at = excluded.synced_at,
      last_attempt_at = excluded.last_attempt_at,
      last_error = excluded.last_error
  `).run(cardKey, complete ? 1 : 0, syncedAt, Date.now(), String(error || '').slice(0, 2000));
}

export function replacePrintingCatalog(cardKey, groupedPrintings, { complete = true } = {}) {
  if (!cardKey || !groupedPrintings.length) return;
  const syncedAt = Date.now();
  transaction(() => {
    db.prepare('DELETE FROM card_printing_catalog WHERE card_key = ?').run(cardKey);
    const insert = db.prepare(`
      INSERT INTO card_printing_catalog (
        card_key, printing_key, scryfall_id, oracle_id, card_name,
        set_code, set_name, collector_number, rarity, released_at,
        summary_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const printing of groupedPrintings) {
      insert.run(
        cardKey,
        printing.printingKey,
        printing.scryfallId,
        printing.oracleId || null,
        printing.name,
        String(printing.setCode || '').toLowerCase(),
        printing.setName || '',
        String(printing.collectorNumber || ''),
        printing.rarity || '',
        printing.releasedAt || null,
        JSON.stringify(printing),
        syncedAt
      );
    }
    markCatalogAttempt(cardKey, {
      complete,
      syncedAt: complete ? syncedAt : null,
      error: complete ? '' : 'De catalogus bevat alleen lokaal bekende printings.'
    });
  });
}

function mergePrintings(localPrintings, remotePrintings) {
  const merged = new Map(remotePrintings.map((printing) => [printing.scryfallId, { ...printing, cached: false }]));
  for (const localPrinting of localPrintings) {
    const remotePrinting = merged.get(localPrinting.scryfallId);
    merged.set(localPrinting.scryfallId, remotePrinting
      ? {
          ...remotePrinting,
          cardId: localPrinting.cardId,
          cached: true,
          image: localPrinting.image || remotePrinting.image,
          imageNormal: localPrinting.imageNormal || remotePrinting.imageNormal || localPrinting.image || remotePrinting.image
        }
      : localPrinting);
  }
  return sortPrintings(groupPrintings([...merged.values()]));
}

export async function loadGroupedPrintingsForCard(card, { force = false } = {}) {
  const cardKey = card.cardKey || card.oracleId || card.scryfallId;
  const key = `${cardKey}:${force ? 'force' : 'normal'}`;
  if (syncInFlight.has(key)) return syncInFlight.get(key);

  const task = (async () => {
    const local = getPrintingsByName(card.name).map(summarizeLocalPrinting);
    try {
      const remote = await scryfallService.printings(card.name, { force });
      const grouped = mergePrintings(local, remote);
      if (grouped.length) replacePrintingCatalog(cardKey, grouped, { complete: true });
      return { data: grouped, offline: false, complete: true };
    } catch (error) {
      const catalog = getCatalogPrintings(cardKey);
      const state = printingCatalogState(cardKey);
      if (catalog.length && state?.complete) {
        markCatalogAttempt(cardKey, {
          complete: true,
          syncedAt: state.syncedAt,
          error: error.message
        });
        return { data: catalog, offline: true, complete: true, stale: true, warning: error.message };
      }
      if (local.length) {
        const grouped = sortPrintings(groupPrintings(local));
        if (grouped.length) replacePrintingCatalog(cardKey, grouped, { complete: false });
        markCatalogAttempt(cardKey, { complete: false, error: error.message });
        return { data: grouped, offline: true, complete: false, warning: error.message };
      }
      markCatalogAttempt(cardKey, { complete: false, error: error.message });
      throw error;
    } finally {
      syncInFlight.delete(key);
    }
  })();

  syncInFlight.set(key, task);
  return task;
}

export async function loadGroupedPrintingsByName(name, { force = false } = {}) {
  const localCards = getPrintingsByName(name);
  if (localCards.length) return loadGroupedPrintingsForCard(localCards[0], { force });

  const remote = await scryfallService.printings(name, { force });
  const grouped = sortPrintings(groupPrintings(remote.map((printing) => ({ ...printing, cached: false }))));
  const cardKey = grouped[0]?.oracleId || grouped[0]?.scryfallId;
  if (cardKey && grouped.length) replacePrintingCatalog(cardKey, grouped, { complete: true });
  return { data: grouped, offline: false, complete: true };
}

export async function ensurePrintingCatalogForCard(card, { force = false } = {}) {
  if (!catalogRefreshIsDue(card.cardKey, force)) return getCatalogPrintings(card.cardKey);
  return (await loadGroupedPrintingsForCard(card, { force })).data;
}

export async function ensureWantedPrintingCatalogs({ force = false } = {}) {
  const cards = db.prepare(`
    SELECT DISTINCT c.*
    FROM wanted_items w
    JOIN cards c ON c.id = w.card_id
    WHERE NOT (c.card_types_json LIKE '%"Land"%' AND c.supertypes_json LIKE '%"Basic"%')
    ORDER BY c.name COLLATE NOCASE
  `).all().map(cardRowToApi);

  const failures = [];
  let refreshed = 0;
  let incomplete = 0;
  for (const card of cards) {
    if (!catalogRefreshIsDue(card.cardKey, force)) {
      if (!printingCatalogIsComplete(card.cardKey)) incomplete += 1;
      continue;
    }
    try {
      await ensurePrintingCatalogForCard(card, { force });
      if (printingCatalogIsComplete(card.cardKey)) refreshed += 1;
      else incomplete += 1;
    } catch (error) {
      incomplete += 1;
      failures.push({ cardId: card.id, name: card.name, message: error.message });
    }
  }
  return { total: cards.length, refreshed, incomplete, failures };
}

export function printingCatalogSummaryMap(cardKeys) {
  const keys = [...new Set(cardKeys.filter(Boolean))];
  const result = new Map();
  if (!keys.length) return result;
  const placeholders = keys.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT card_key, printing_key, set_code, set_name, collector_number, rarity
    FROM card_printing_catalog
    WHERE card_key IN (${placeholders})
    ORDER BY set_name COLLATE NOCASE, set_code, printing_key
  `).all(...keys);

  for (const row of rows) {
    if (!result.has(row.card_key)) {
      result.set(row.card_key, {
        printingCount: 0,
        sets: new Map(),
        rarities: new Set(),
        rarityPrintings: new Map()
      });
    }
    const summary = result.get(row.card_key);
    summary.printingCount += 1;
    if (!summary.sets.has(row.set_code)) {
      summary.sets.set(row.set_code, { code: row.set_code, name: row.set_name, printingCount: 0 });
    }
    summary.sets.get(row.set_code).printingCount += 1;
    if (row.rarity) {
      summary.rarities.add(row.rarity);
      if (!summary.rarityPrintings.has(row.rarity)) summary.rarityPrintings.set(row.rarity, []);
      summary.rarityPrintings.get(row.rarity).push({
        printingKey: row.printing_key,
        setCode: row.set_code,
        setName: row.set_name,
        collectorNumber: row.collector_number
      });
    }
  }

  for (const [key, summary] of result) {
    result.set(key, {
      printingCount: summary.printingCount,
      sets: [...summary.sets.values()],
      rarities: [...summary.rarities].sort((a, b) => {
        const ai = RARITY_ORDER.indexOf(a);
        const bi = RARITY_ORDER.indexOf(b);
        return (ai === -1 ? RARITY_ORDER.length : ai) - (bi === -1 ? RARITY_ORDER.length : bi)
          || a.localeCompare(b);
      }),
      rarityPrintings: Object.fromEntries([...summary.rarityPrintings.entries()].map(([rarity, printings]) => [
        rarity,
        printings.sort((a, b) => a.setName.localeCompare(b.setName, 'nl')
          || a.setCode.localeCompare(b.setCode)
          || a.collectorNumber.localeCompare(b.collectorNumber, undefined, { numeric: true }))
      ]))
    });
  }
  return result;
}

export function printingCatalogStats() {
  const rows = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM card_printing_catalog) AS entries,
      (SELECT COUNT(DISTINCT card_key) FROM card_printing_catalog) AS cards,
      SUM(CASE WHEN complete = 1 THEN 1 ELSE 0 END) AS complete_cards,
      SUM(CASE WHEN complete = 0 THEN 1 ELSE 0 END) AS incomplete_cards
    FROM card_printing_catalog_state
  `).get();
  return {
    entries: Number(rows?.entries || 0),
    cards: Number(rows?.cards || 0),
    completeCards: Number(rows?.complete_cards || 0),
    incompleteCards: Number(rows?.incomplete_cards || 0)
  };
}

export function clearPrintingCatalog() {
  return transaction(() => {
    const entries = Number(db.prepare('DELETE FROM card_printing_catalog').run().changes || 0);
    const cards = Number(db.prepare('DELETE FROM card_printing_catalog_state').run().changes || 0);
    return { entries, cards };
  });
}

export async function resolveSinglePrintingCard(card) {
  const printings = await ensurePrintingCatalogForCard(card);
  if (!printingCatalogIsComplete(card.cardKey) || printings.length !== 1) return null;
  const printing = printings[0];
  const englishVariant = printing.variants?.find((variant) => variant.language === 'en');
  const variant = englishVariant || printing.variants?.[0] || null;
  const localId = Number(variant?.cardId || printing.cardId || 0);
  if (localId > 0) {
    const local = getCardById(localId);
    if (local?.cardKey === card.cardKey) return local;
  }

  const scryfallId = variant?.scryfallId || printing.scryfallId;
  const existing = scryfallId ? getCardByScryfallId(scryfallId) : null;
  if (existing?.cardKey === card.cardKey) return existing;
  if (!scryfallId) return null;

  const cached = upsertScryfallCard(await scryfallService.getById(scryfallId));
  return cached.cardKey === card.cardKey ? cached : null;
}
