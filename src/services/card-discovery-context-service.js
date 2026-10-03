import { db } from '../db/database.js';
import { HttpError } from '../lib/http-error.js';
import { discoveryExcludedDeckId } from '../lib/discovery-deck-filter.js';
import { listDiscoveryMarks } from './discovery-mark-service.js';

// Pass only stable card identities to the read-only catalog. Neither database
// needs a reference to, an attachment of, or a schema change in the other.
export function cardDiscoveryContext(input = {}) {
  const id = discoveryExcludedDeckId(input.excludeDeckId);
  let excludedDeck = null;
  if (id !== null) {
    const deck = db.prepare('SELECT commander_card_id, second_commander_card_id FROM decks WHERE id = ?').get(id);
    if (!deck) throw new HttpError(404, 'Het geselecteerde deck bestaat niet meer. Kies een ander deck om kaarten uit te sluiten.');
    const cards = db.prepare(`
      SELECT DISTINCT name, oracle_id AS scryfallOracleId
      FROM cards
      WHERE id IN (SELECT card_id FROM deck_cards WHERE deck_id = ?)
        OR id = ? OR id = ?
    `).all(id, deck.commander_card_id, deck.second_commander_card_id);
    excludedDeck = { id, cards };
  }
  return { marks: listDiscoveryMarks(), excludedDeck };
}
