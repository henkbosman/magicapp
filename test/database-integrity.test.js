import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-transaction-integrity-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'transactions.sqlite';
const { db, transaction, closeDatabase } = await import('../src/db/database.js');

db.exec(`
  CREATE TABLE audit_parent (id INTEGER PRIMARY KEY);
  CREATE TABLE audit_child (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES audit_parent(id) DEFERRABLE INITIALLY DEFERRED
  );
  INSERT INTO audit_parent VALUES (1);
`);

after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('een commitfout rolt terug en volgende geneste mutaties blijven atomair', () => {
  assert.throws(() => transaction(() => {
    db.prepare('INSERT INTO audit_child VALUES (1, 999)').run();
  }), /FOREIGN KEY/);
  assert.equal(db.isTransaction, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_child').get().n, 0);

  transaction(() => {
    db.prepare('INSERT INTO audit_child VALUES (2, 1)').run();
    transaction(() => db.prepare('INSERT INTO audit_child VALUES (3, 1)').run());
  });
  assert.equal(db.isTransaction, false);
  assert.deepEqual(db.prepare('SELECT id FROM audit_child ORDER BY id').all().map((row) => row.id), [2, 3]);
});

test('buitenste fout rolt ook geslaagde binnenste mutaties terug', () => {
  assert.throws(() => transaction(() => {
    db.prepare('INSERT INTO audit_child VALUES (4, 1)').run();
    transaction(() => db.prepare('INSERT INTO audit_child VALUES (5, 1)').run());
    throw new Error('outer failure');
  }), /outer failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_child WHERE id IN (4, 5)').get().n, 0);
  assert.equal(db.isTransaction, false);
});

test('opgevangen binnenste fout rolt alleen het eigen savepoint terug', () => {
  transaction(() => {
    db.prepare('INSERT INTO audit_child VALUES (6, 1)').run();
    assert.throws(() => transaction(() => {
      db.prepare('INSERT INTO audit_child VALUES (7, 1)').run();
      throw new Error('inner failure');
    }), /inner failure/);
    db.prepare('INSERT INTO audit_child VALUES (8, 1)').run();
  });
  assert.deepEqual(db.prepare('SELECT id FROM audit_child WHERE id >= 6 ORDER BY id').all().map((row) => row.id), [6, 8]);
  assert.equal(db.isTransaction, false);
});
