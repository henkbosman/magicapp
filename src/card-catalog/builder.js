import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseAtomicCards } from '../lib/atomic-cards-parser.js';
import {
  colorMask,
  mapAtomicCardToCatalogRecord,
  normalizeSearchText
} from '../lib/card-catalog-features.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

function list(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value.flatMap(list) : [String(value).trim()].filter(Boolean);
}

function json(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function syncFile(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export async function buildCardCatalogDatabase({
  source,
  databasePath,
  sourceUrl = '',
  sourceSha256 = '',
  onProgress = () => {},
  limits = {}
}) {
  const targetPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  fs.rmSync(targetPath, { force: true });

  const database = new DatabaseSync(targetPath, {
    enableForeignKeyConstraints: true,
    timeout: 5000
  });
  fs.chmodSync(targetPath, 0o600);

  let transactionOpen = false;
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      PRAGMA temp_store = FILE;
      PRAGMA cache_size = -32768;
      PRAGMA trusted_schema = OFF;
    `);
    database.exec(fs.readFileSync(schemaPath, 'utf8'));

    const insertCard = database.prepare(`
      INSERT INTO cards (
        source_key, variant_index, catalog_key, name, search_name,
        ascii_name, face_name, side, mana_cost, mana_value,
        colors_mask, color_identity_mask, colors_json, color_identity_json,
        type_line, oracle_text, power, toughness, loyalty, defense, layout,
        keywords_json, legalities_json, produced_mana_json, effects_json,
        token_power, token_toughness, token_type, tutor_target,
        scryfall_oracle_id, raw_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    const insertKeyword = database.prepare('INSERT OR IGNORE INTO card_keywords (card_id, value) VALUES (?, ?)');
    const insertAbility = database.prepare('INSERT OR IGNORE INTO card_abilities (card_id, value) VALUES (?, ?)');
    const insertType = database.prepare('INSERT OR IGNORE INTO card_types (card_id, value) VALUES (?, ?)');
    const insertSubtype = database.prepare('INSERT OR IGNORE INTO card_subtypes (card_id, value) VALUES (?, ?)');
    const insertSupertype = database.prepare('INSERT OR IGNORE INTO card_supertypes (card_id, value) VALUES (?, ?)');
    const insertPrinting = database.prepare('INSERT OR IGNORE INTO card_printings (card_id, set_code) VALUES (?, ?)');
    const insertLegality = database.prepare('INSERT OR REPLACE INTO card_legalities (card_id, format, status) VALUES (?, ?, ?)');
    const insertEffect = database.prepare('INSERT OR IGNORE INTO card_effects (card_id, value) VALUES (?, ?)');
    const insertToken = database.prepare(`
      INSERT OR IGNORE INTO card_tokens (card_id, power, toughness, token_type)
      VALUES (?, ?, ?, ?)
    `);
    const insertTutorTarget = database.prepare('INSERT OR IGNORE INTO card_tutor_targets (card_id, value) VALUES (?, ?)');
    const setMeta = database.prepare('INSERT OR REPLACE INTO catalog_meta (key, value) VALUES (?, ?)');

    let metadata = null;
    let processed = 0;
    let lastProgressAt = 0;

    database.exec('BEGIN IMMEDIATE');
    transactionOpen = true;
    const parsed = await parseAtomicCards(source, {
      limits,
      onMeta(meta) {
        metadata = meta;
      },
      async onCardGroup(sourceKey, cards) {
        for (const [variantIndex, card] of cards.entries()) {
          const record = mapAtomicCardToCatalogRecord(card, { sourceKey, variantIndex });
          const result = insertCard.run(
            record.sourceKey,
            record.variantIndex,
            record.catalogKey,
            record.name,
            normalizeSearchText(record.name, record.asciiName, record.faceName),
            record.asciiName,
            record.faceName,
            record.side,
            record.manaCost || '',
            record.manaValue ?? 0,
            colorMask(record.colors),
            colorMask(record.colorIdentity),
            json(record.colors, []),
            json(record.colorIdentity, []),
            record.typeLine,
            record.oracleText,
            record.power,
            record.toughness,
            record.loyalty,
            record.defense,
            record.layout || '',
            json(record.keywords, []),
            json(record.legalities, {}),
            json(record.producedMana, []),
            json(record.effects, {}),
            record.tokenPower,
            record.tokenToughness,
            record.tokenType,
            record.tutorTarget,
            record.scryfallOracleId,
            json(record.raw, {})
          );
          const cardId = Number(result.lastInsertRowid);

          for (const keyword of record.keywords) {
            insertKeyword.run(cardId, keyword);
            // MTGJSON includes named keyword abilities and ability words such as
            // Landfall in this list. Keeping a separate facet lets the UI evolve
            // without coupling its contract to the raw keyword filter.
            insertAbility.run(cardId, keyword);
          }
          for (const type of record.types) insertType.run(cardId, type);
          for (const subtype of record.subtypes) insertSubtype.run(cardId, subtype);
          for (const supertype of record.supertypes) insertSupertype.run(cardId, supertype);
          for (const setCode of list(record.raw?.printings)) insertPrinting.run(cardId, setCode.toUpperCase());
          for (const [format, status] of Object.entries(record.legalities)) {
            insertLegality.run(cardId, format.toLowerCase(), String(status).toLowerCase());
          }
          for (const effect of record.effects.tags) insertEffect.run(cardId, effect);
          for (const token of record.effects.tokenStats) {
            insertToken.run(cardId, token.power, token.toughness, token.tokenType || '');
          }
          for (const target of record.effects.tutorTargets) insertTutorTarget.run(cardId, target);

          processed += 1;
          if (processed % 250 === 0 || Date.now() - lastProgressAt >= 500) {
            lastProgressAt = Date.now();
            onProgress({ processed, phase: 'parsing' });
          }
        }
      }
    });

    const sourceVersion = String(metadata?.version || '').trim();
    const sourceDate = String(metadata?.date || '').trim();
    if (!sourceVersion || !sourceDate || parsed.cardCount < 1) {
      throw new Error('AtomicCards bevat geen geldige bronmetadata of kaartrecords.');
    }

    const importedAt = new Date().toISOString();
    for (const [key, value] of Object.entries({
      source_version: sourceVersion,
      source_date: sourceDate,
      source_url: sourceUrl,
      source_sha256: sourceSha256,
      imported_at: importedAt,
      card_count: String(parsed.cardCount),
      card_group_count: String(parsed.groupCount)
    })) setMeta.run(key, value);

    database.exec('COMMIT');
    transactionOpen = false;
    onProgress({ processed, total: parsed.cardCount, phase: 'indexing' });

    database.exec(`
      INSERT INTO cards_fts (rowid, name, type_line, oracle_text, keywords, abilities)
      SELECT id, name, type_line, oracle_text, keywords_json, keywords_json FROM cards;
      ANALYZE;
    `);

    const quickCheck = Object.values(database.prepare('PRAGMA quick_check(1)').get() || {})[0];
    if (quickCheck !== 'ok') throw new Error(`Catalogusintegriteitscontrole mislukt: ${quickCheck || 'onbekend'}.`);
    if (database.prepare('PRAGMA foreign_key_check').get()) {
      throw new Error('De geïmporteerde catalogus bevat ongeldige interne relaties.');
    }

    database.close();
    syncFile(targetPath);
    return {
      cardCount: parsed.cardCount,
      groupCount: parsed.groupCount,
      sourceVersion,
      sourceDate,
      importedAt
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // The temporary database is discarded below.
      }
    }
    try {
      database.close();
    } catch {
      // The temporary database is discarded below.
    }
    fs.rmSync(targetPath, { force: true });
    throw error;
  }
}
