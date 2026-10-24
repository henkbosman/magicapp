import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-deck-revision-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'collection.sqlite';
const { db, closeDatabase } = await import('../src/db/database.js');
const { getDeckRevision } = await import('../src/services/deck-revision-service.js');

beforeEach(() => {
  db.exec('DELETE FROM decks; DELETE FROM cards;');
  const insert = db.prepare('INSERT INTO cards (id,scryfall_id,name,search_name,raw_json) VALUES (?,?,?,?,?)');
  insert.run(1, 'first-printing', 'First', 'first', '{}');
  insert.run(2, 'second-printing', 'Second', 'second', '{}');
  db.exec(`INSERT INTO decks (id,name) VALUES (1,'Visible deck'),(2,'Other deck');
    INSERT INTO deck_cards (id,deck_id,card_id,quantity,role,note) VALUES
      (11,1,1,1,'main',''),(12,1,2,1,'main',''),(21,2,1,1,'main','');`);
});
after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const revision = () => getDeckRevision(1).revision;

test('revision reads are stable, do not write data and ignore timestamp-only changes', () => {
  const changes = () => db.prepare('SELECT total_changes() AS n').get().n;
  const before = changes();
  const value = revision();
  assert.match(value, /^[a-f0-9]{64}$/);
  assert.equal(revision(), value);
  assert.equal(changes(), before);
  db.exec(`UPDATE decks SET updated_at='2026-10-24 12:34:56' WHERE id=1;
    UPDATE deck_cards SET updated_at='2026-10-24 12:34:56' WHERE deck_id=1;`);
  assert.equal(revision(), value);
});

test('deck changes with unchanged totals and timestamp precision still change revisions', () => {
  let previous = revision();
  const mutate = (sql) => {
    db.exec(sql);
    const next = revision();
    assert.notEqual(next, previous);
    previous = next;
  };
  mutate("UPDATE deck_cards SET note='Changed note' WHERE id=11");
  mutate("UPDATE deck_cards SET role='sideboard' WHERE id=11");
  mutate("UPDATE deck_cards SET card_id=2 WHERE id=11");
  mutate("UPDATE deck_cards SET quantity=2 WHERE id=11; UPDATE deck_cards SET quantity=1 WHERE id=12;");
  mutate("DELETE FROM deck_cards WHERE id=11; INSERT INTO deck_cards (id,deck_id,card_id,quantity,role,note) VALUES (13,1,2,2,'sideboard','Changed note');");
  mutate("UPDATE decks SET description='Changed description' WHERE id=1");
});

test('registry tags, card assignments and combo member order are part of the revision', () => {
  let previous = revision();
  const mutate = (sql) => {
    db.exec(sql);
    const next = revision();
    assert.notEqual(next, previous);
    previous = next;
  };
  mutate("INSERT INTO deck_tags (id,deck_id,name,name_key) VALUES (31,1,'Ramp','ramp')");
  mutate("UPDATE deck_tags SET name='Mana',name_key='mana' WHERE id=31");
  mutate("INSERT INTO deck_card_tags (deck_card_id,tag) VALUES (11,'Mana')");
  mutate("INSERT INTO deck_card_groups (id,deck_id,name,link_type) VALUES (41,1,'Pair','synergy')");
  mutate("INSERT INTO deck_card_group_members (group_id,deck_card_id,position) VALUES (41,11,0),(41,12,1)");
  mutate('UPDATE deck_card_group_members SET position=1-position WHERE group_id=41');
  mutate("DELETE FROM deck_card_tags WHERE deck_card_id=11");
  mutate('DELETE FROM deck_tags WHERE id=31');
});

test('mutations in another deck do not change the visible deck revision', () => {
  const value = revision();
  db.exec(`UPDATE decks SET name='Other renamed' WHERE id=2;
    UPDATE deck_cards SET quantity=6,note='Unrelated' WHERE deck_id=2;
    INSERT INTO deck_tags (deck_id,name,name_key) VALUES (2,'Draw','draw');
    INSERT INTO deck_card_tags (deck_card_id,tag) VALUES (21,'Draw');`);
  assert.equal(revision(), value);
});

test('writes through a second database connection are detected without process-local state', () => {
  const other = new DatabaseSync(path.join(dataDir, 'collection.sqlite'));
  try {
    const value = revision();
    other.exec(`UPDATE deck_cards SET quantity=3,updated_at='2026-10-24 12:34:56' WHERE id=11;
      UPDATE decks SET updated_at='2026-10-24 12:34:56' WHERE id=1;`);
    const first = revision();
    assert.notEqual(first, value);
    other.exec(`UPDATE deck_cards SET quantity=4,updated_at='2026-10-24 12:34:56' WHERE id=11;
      UPDATE decks SET updated_at='2026-10-24 12:34:56' WHERE id=1;`);
    assert.notEqual(revision(), first);
  } finally {
    other.close();
  }
});

test('missing or invalid deck identifiers cannot return a revision for another deck', () => {
  assert.throws(() => getDeckRevision(999), (error) => error.status === 404);
  assert.throws(() => getDeckRevision('1 OR 1=1'), (error) => error.status === 400);
});
