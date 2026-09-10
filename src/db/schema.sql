PRAGMA foreign_keys = ON;
PRAGMA user_version = 20000;

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scryfall_id TEXT NOT NULL UNIQUE,
  oracle_id TEXT,
  name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  printed_name TEXT,
  mana_cost TEXT NOT NULL DEFAULT '',
  mana_value REAL NOT NULL DEFAULT 0,
  colors_json TEXT NOT NULL DEFAULT '[]',
  color_identity_json TEXT NOT NULL DEFAULT '[]',
  produced_mana_json TEXT NOT NULL DEFAULT '[]',
  type_line TEXT NOT NULL DEFAULT '',
  card_types_json TEXT NOT NULL DEFAULT '[]',
  supertypes_json TEXT NOT NULL DEFAULT '[]',
  subtypes_json TEXT NOT NULL DEFAULT '[]',
  oracle_text TEXT NOT NULL DEFAULT '',
  printed_text TEXT NOT NULL DEFAULT '',
  power TEXT,
  toughness TEXT,
  loyalty TEXT,
  defense TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  set_name TEXT NOT NULL DEFAULT '',
  set_code TEXT NOT NULL DEFAULT '',
  collector_number TEXT NOT NULL DEFAULT '',
  rarity TEXT NOT NULL DEFAULT '',
  released_at TEXT,
  artist TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  layout TEXT NOT NULL DEFAULT 'normal',
  legalities_json TEXT NOT NULL DEFAULT '{}',
  image_small TEXT,
  image_normal TEXT,
  image_large TEXT,
  image_png TEXT,
  back_image_small TEXT,
  back_image_normal TEXT,
  back_image_large TEXT,
  back_image_png TEXT,
  finishes_json TEXT NOT NULL DEFAULT '[]',
  prices_json TEXT NOT NULL DEFAULT '{}',
  card_faces_json TEXT NOT NULL DEFAULT '[]',
  scryfall_uri TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cards_oracle_id ON cards(oracle_id);
CREATE INDEX IF NOT EXISTS idx_cards_search_name ON cards(search_name);
CREATE INDEX IF NOT EXISTS idx_cards_set_collector ON cards(set_code, collector_number, language);
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS collection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity >= 0),
  finish TEXT NOT NULL DEFAULT 'nonfoil' CHECK(finish IN ('nonfoil', 'foil', 'etched')),
  language TEXT NOT NULL DEFAULT 'en',
  condition TEXT NOT NULL DEFAULT 'near_mint',
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  purchase_price REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(card_id, finish, language, condition, location)
);

CREATE INDEX IF NOT EXISTS idx_collection_card ON collection_items(card_id);

CREATE TABLE IF NOT EXISTS decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'commander',
  commander_card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  second_commander_card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deck_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
  role TEXT NOT NULL DEFAULT 'main' CHECK(role IN ('commander', 'partner', 'companion', 'main', 'sideboard', 'maybeboard')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(deck_id, card_id, role)
);

CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON deck_cards(deck_id);
CREATE INDEX IF NOT EXISTS idx_deck_cards_card ON deck_cards(card_id);

CREATE TABLE IF NOT EXISTS deck_card_tags (
  deck_card_id INTEGER NOT NULL REFERENCES deck_cards(id) ON DELETE CASCADE,
  tag TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY(deck_card_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_deck_card_tags_tag ON deck_card_tags(tag COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS wanted_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  printing_card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
  priority INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
  maximum_price REAL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(card_id)
);

CREATE INDEX IF NOT EXISTS idx_wanted_card ON wanted_items(card_id);
CREATE INDEX IF NOT EXISTS idx_wanted_printing_card ON wanted_items(printing_card_id);
CREATE INDEX IF NOT EXISTS idx_wanted_priority ON wanted_items(priority);

CREATE TABLE IF NOT EXISTS wanted_item_decks (
  wanted_item_id INTEGER NOT NULL REFERENCES wanted_items(id) ON DELETE CASCADE,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (wanted_item_id, deck_id)
);

CREATE INDEX IF NOT EXISTS idx_wanted_item_decks_deck ON wanted_item_decks(deck_id, wanted_item_id);

CREATE TABLE IF NOT EXISTS external_api_cache (
  cache_key TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_external_api_cache_expiry ON external_api_cache(expires_at);

CREATE TABLE IF NOT EXISTS card_printing_catalog (
  card_key TEXT NOT NULL,
  printing_key TEXT NOT NULL,
  scryfall_id TEXT NOT NULL,
  oracle_id TEXT,
  card_name TEXT NOT NULL,
  set_code TEXT NOT NULL,
  set_name TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  rarity TEXT NOT NULL DEFAULT '',
  released_at TEXT,
  summary_json TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY(card_key, printing_key)
);

CREATE INDEX IF NOT EXISTS idx_card_printing_catalog_set ON card_printing_catalog(set_code, card_key);
CREATE INDEX IF NOT EXISTS idx_card_printing_catalog_synced ON card_printing_catalog(synced_at);

CREATE TABLE IF NOT EXISTS card_printing_catalog_state (
  card_key TEXT PRIMARY KEY,
  complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0, 1)),
  synced_at INTEGER,
  last_attempt_at INTEGER NOT NULL,
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_card_printing_catalog_state_attempt ON card_printing_catalog_state(last_attempt_at);

CREATE TABLE IF NOT EXISTS deck_card_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  link_type TEXT NOT NULL CHECK(link_type IN ('synergy', 'combo')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deck_card_groups_deck ON deck_card_groups(deck_id, link_type, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS deck_card_group_members (
  group_id INTEGER NOT NULL REFERENCES deck_card_groups(id) ON DELETE CASCADE,
  deck_card_id INTEGER NOT NULL REFERENCES deck_cards(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(group_id, deck_card_id)
);

CREATE INDEX IF NOT EXISTS idx_deck_card_group_members_card ON deck_card_group_members(deck_card_id, group_id);

CREATE TABLE IF NOT EXISTS card_user_metadata (
  card_key TEXT PRIMARY KEY,
  mana_production_json TEXT,
  mana_production_note TEXT NOT NULL DEFAULT '',
  library_search_targets_json TEXT,
  library_search_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS collection_items_updated
AFTER UPDATE ON collection_items
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE collection_items SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS wanted_items_updated
AFTER UPDATE ON wanted_items
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE wanted_items SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS deck_cards_updated
AFTER UPDATE ON deck_cards
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE deck_cards SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
  UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.deck_id;
END;

CREATE TRIGGER IF NOT EXISTS deck_cards_inserted
AFTER INSERT ON deck_cards
BEGIN
  UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.deck_id;
END;

CREATE TRIGGER IF NOT EXISTS deck_cards_deleted
AFTER DELETE ON deck_cards
BEGIN
  UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.deck_id;
END;

CREATE TRIGGER IF NOT EXISTS deck_card_group_members_same_deck
BEFORE INSERT ON deck_card_group_members
WHEN (
  SELECT deck_id FROM deck_cards WHERE id = NEW.deck_card_id
) <> (
  SELECT deck_id FROM deck_card_groups WHERE id = NEW.group_id
)
BEGIN
  SELECT RAISE(ABORT, 'Deckkaart en koppelinggroep horen niet bij hetzelfde deck');
END;

CREATE TRIGGER IF NOT EXISTS deck_card_groups_updated
AFTER UPDATE ON deck_card_groups
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE deck_card_groups SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = NEW.id;
  UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.deck_id;
END;

CREATE TRIGGER IF NOT EXISTS deck_card_groups_inserted
AFTER INSERT ON deck_card_groups
BEGIN
  UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.deck_id;
END;

CREATE TRIGGER IF NOT EXISTS deck_card_groups_deleted
AFTER DELETE ON deck_card_groups
BEGIN
  UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.deck_id;
END;

CREATE TRIGGER IF NOT EXISTS deck_card_group_members_inserted
AFTER INSERT ON deck_card_group_members
BEGIN
  UPDATE deck_card_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.group_id;
END;

CREATE TRIGGER IF NOT EXISTS deck_card_group_members_deleted
AFTER DELETE ON deck_card_group_members
BEGIN
  UPDATE deck_card_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.group_id;
END;

CREATE TRIGGER IF NOT EXISTS card_user_metadata_updated
AFTER UPDATE ON card_user_metadata
BEGIN
  UPDATE card_user_metadata SET updated_at = CURRENT_TIMESTAMP WHERE card_key = NEW.card_key;
END;
