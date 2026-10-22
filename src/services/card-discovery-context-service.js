import { db } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';
import { discoverySelectedDeckId } from '../lib/discovery-deck-filter.js';
import { listDiscoveryMarks } from './discovery-mark-service.js';

// Pass only stable card identities to the read-only catalog. Neither database
// needs a reference to, an attachment of, or a schema change in the other.
export function cardDiscoveryContext(input = {}) {
  const ownedValue = Array.isArray(input.owned) ? input.owned[0] : input.owned;
  const owned = ['1', 'true'].includes(String(ownedValue ?? '').trim().toLowerCase());
  const ownedCards = owned ? db.prepare(`
    SELECT DISTINCT c.name, c.oracle_id AS scryfallOracleId
    FROM cards c
    WHERE EXISTS (
      SELECT 1 FROM collection_items ci WHERE ci.card_id = c.id AND ci.quantity > 0
    )
  `).all() : [];
  const id = discoverySelectedDeckId(input);
  let selectedDeck = null;
  if (id !== null) {
    const deck = db.prepare('SELECT commander_card_id, second_commander_card_id FROM decks WHERE id = ?').get(id);
    if (!deck) throw new HttpError(404, 'Het geselecteerde deck bestaat niet meer. Kies een ander deck om aanwezige kaarten te herkennen.');
    const cards = db.prepare(`
      SELECT DISTINCT name, oracle_id AS scryfallOracleId
      FROM cards
      WHERE id IN (SELECT card_id FROM deck_cards WHERE deck_id = ?)
        OR id = ? OR id = ?
    `).all(id, deck.commander_card_id, deck.second_commander_card_id);
    selectedDeck = { id, cards };
  }
  return { marks: listDiscoveryMarks(), selectedDeck, ownedCards };
}
