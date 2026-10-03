PRAGMA foreign_keys = ON;
PRAGMA user_version = 10000;

CREATE TABLE catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE cards (
  id INTEGER PRIMARY KEY,
  source_key TEXT NOT NULL,
  variant_index INTEGER NOT NULL,
  catalog_key TEXT NOT NULL,
  name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  ascii_name TEXT,
  face_name TEXT,
  side TEXT,
  mana_cost TEXT NOT NULL DEFAULT '',
  mana_value REAL NOT NULL DEFAULT 0,
  colors_mask INTEGER NOT NULL DEFAULT 0,
  color_identity_mask INTEGER NOT NULL DEFAULT 0,
  colors_json TEXT NOT NULL DEFAULT '[]',
  color_identity_json TEXT NOT NULL DEFAULT '[]',
  type_line TEXT NOT NULL DEFAULT '',
  oracle_text TEXT NOT NULL DEFAULT '',
  power TEXT,
  toughness TEXT,
  loyalty TEXT,
  defense TEXT,
  layout TEXT NOT NULL DEFAULT '',
  keywords_json TEXT NOT NULL DEFAULT '[]',
  legalities_json TEXT NOT NULL DEFAULT '{}',
  produced_mana_json TEXT NOT NULL DEFAULT '[]',
  effects_json TEXT NOT NULL DEFAULT '[]',
  token_power TEXT,
  token_toughness TEXT,
  token_type TEXT,
  tutor_target TEXT,
  scryfall_oracle_id TEXT,
  raw_json TEXT NOT NULL,
  UNIQUE(source_key, variant_index)
);

CREATE INDEX idx_catalog_cards_name ON cards(name COLLATE NOCASE);
CREATE INDEX idx_catalog_cards_search_name ON cards(search_name);
CREATE INDEX idx_catalog_cards_mana ON cards(mana_value, name COLLATE NOCASE);
CREATE INDEX idx_catalog_cards_identity ON cards(color_identity_mask, name COLLATE NOCASE);
CREATE INDEX idx_catalog_cards_catalog_key ON cards(catalog_key);
CREATE INDEX idx_catalog_cards_oracle_id ON cards(scryfall_oracle_id);

CREATE TABLE card_keywords (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  value TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY(card_id, value)
) WITHOUT ROWID;
CREATE INDEX idx_catalog_keywords_value ON card_keywords(value COLLATE NOCASE, card_id);

CREATE TABLE card_abilities (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  value TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY(card_id, value)
) WITHOUT ROWID;
CREATE INDEX idx_catalog_abilities_value ON card_abilities(value COLLATE NOCASE, card_id);

CREATE TABLE card_types (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  value TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY(card_id, value)
) WITHOUT ROWID;
CREATE INDEX idx_catalog_types_value ON card_types(value COLLATE NOCASE, card_id);

CREATE TABLE card_subtypes (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  value TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY(card_id, value)
) WITHOUT ROWID;
CREATE INDEX idx_catalog_subtypes_value ON card_subtypes(value COLLATE NOCASE, card_id);

CREATE TABLE card_supertypes (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  value TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY(card_id, value)
) WITHOUT ROWID;

CREATE TABLE card_printings (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  set_code TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY(card_id, set_code)
) WITHOUT ROWID;
CREATE INDEX idx_catalog_printings_set ON card_printings(set_code COLLATE NOCASE, card_id);

CREATE TABLE card_legalities (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  format TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY(card_id, format)
) WITHOUT ROWID;
CREATE INDEX idx_catalog_legalities_filter ON card_legalities(format COLLATE NOCASE, status COLLATE NOCASE, card_id);

CREATE TABLE card_effects (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  value TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY(card_id, value)
) WITHOUT ROWID;
CREATE INDEX idx_catalog_effects_value ON card_effects(value COLLATE NOCASE, card_id);

CREATE TABLE card_tokens (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  power TEXT NOT NULL COLLATE NOCASE,
  toughness TEXT NOT NULL COLLATE NOCASE,
  token_type TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  PRIMARY KEY(card_id, power, toughness, token_type)
) WITHOUT ROWID;
CREATE INDEX idx_catalog_tokens_filter ON card_tokens(
  power COLLATE NOCASE,
  toughness COLLATE NOCASE,
  token_type COLLATE NOCASE,
  card_id
);

CREATE TABLE card_tutor_targets (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  value TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY(card_id, value)
) WITHOUT ROWID;
CREATE INDEX idx_catalog_tutor_targets_value ON card_tutor_targets(value COLLATE NOCASE, card_id);

CREATE VIRTUAL TABLE cards_fts USING fts5(
  name,
  type_line,
  oracle_text,
  keywords,
  abilities,
  content=''
);
