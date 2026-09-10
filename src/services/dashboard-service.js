import { db } from '../db/database.js';
import { cardRowToApi } from './card-mapper.js';
import { usageMapsForKeys, addUsage } from './card-repository.js';

export function getDashboard() {
  const physicalCards = Number(db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM collection_items').get().total);
  const uniqueCards = Number(db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(c.oracle_id, c.scryfall_id)) AS total
    FROM collection_items ci JOIN cards c ON c.id = ci.card_id
  `).get().total);
  const decks = Number(db.prepare('SELECT COUNT(*) AS total FROM decks').get().total);
  const wanted = Number(db.prepare(`
    SELECT COALESCE(SUM(w.quantity), 0) AS total
    FROM wanted_items w JOIN cards c ON c.id = w.card_id
    WHERE NOT (c.card_types_json LIKE '%"Land"%' AND c.supertypes_json LIKE '%"Basic"%')
  `).get().total);

  const ownedRows = db.prepare(`
    SELECT COALESCE(c.oracle_id, c.scryfall_id) AS card_key, SUM(ci.quantity) AS quantity
    FROM collection_items ci JOIN cards c ON c.id = ci.card_id GROUP BY card_key
  `).all();
  const neededRows = db.prepare(`
    SELECT COALESCE(c.oracle_id, c.scryfall_id) AS card_key, SUM(dc.quantity) AS quantity,
      MAX(CASE WHEN c.card_types_json LIKE '%"Land"%' AND c.supertypes_json LIKE '%"Basic"%' THEN 1 ELSE 0 END) AS is_basic_land
    FROM deck_cards dc JOIN cards c ON c.id = dc.card_id
    WHERE dc.role IN ('commander', 'partner', 'main') GROUP BY card_key
  `).all();
  const ownedMap = new Map(ownedRows.map((row) => [row.card_key, Number(row.quantity)]));
  let totalMissing = 0;
  for (const row of neededRows) {
    if (Number(row.is_basic_land)) continue;
    totalMissing += Math.max(Number(row.quantity) - (ownedMap.get(row.card_key) || 0), 0);
  }

  const collectionRows = db.prepare(`
    SELECT ci.quantity, ci.finish, c.* FROM collection_items ci JOIN cards c ON c.id = ci.card_id
  `).all();
  let estimatedValueEur = 0;
  let valuedCopies = 0;
  for (const row of collectionRows) {
    const card = cardRowToApi(row);
    const price = row.finish === 'foil' ? card.prices.eur_foil : row.finish === 'etched' ? (card.prices.eur_etched || card.prices.eur_foil) : card.prices.eur;
    const numericPrice = Number(price);
    if (Number.isFinite(numericPrice)) {
      estimatedValueEur += numericPrice * Number(row.quantity);
      valuedCopies += Number(row.quantity);
    }
  }

  const recentRows = db.prepare(`
    SELECT c.*, ci.id AS collection_item_id, ci.quantity AS collection_quantity,
      ci.finish AS collection_finish, ci.created_at AS collection_created_at
    FROM collection_items ci JOIN cards c ON c.id = ci.card_id
    ORDER BY ci.created_at DESC, ci.id DESC LIMIT 8
  `).all();
  const recentCards = recentRows.map(cardRowToApi);
  const maps = usageMapsForKeys(recentCards.map((card) => card.cardKey));

  return {
    totals: {
      physicalCards,
      uniqueCards,
      decks,
      wanted,
      totalMissing,
      estimatedValueEur: Number(estimatedValueEur.toFixed(2)),
      valuedCopies
    },
    recentCollection: recentRows.map((row, index) => ({
      id: Number(row.collection_item_id),
      quantity: Number(row.collection_quantity),
      finish: row.collection_finish,
      createdAt: row.collection_created_at,
      card: addUsage(recentCards[index], maps)
    }))
  };
}
