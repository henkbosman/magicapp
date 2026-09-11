import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.imageCacheDir, { recursive: true });

export const db = new DatabaseSync(config.databasePath, {
  enableForeignKeyConstraints: true,
  timeout: 5000
});

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
`);

function initializeSchema() {
  const schemaPath = path.join(config.rootDir, 'src', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(schema);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

initializeSchema();

let transactionDepth = 0;
let savepointSequence = 0;

export function transaction(work) {
  const outermost = transactionDepth === 0;
  const savepoint = outermost ? '' : `app_savepoint_${++savepointSequence}`;
  if (outermost) db.exec('BEGIN IMMEDIATE');
  else db.exec(`SAVEPOINT ${savepoint}`);
  transactionDepth += 1;

  try {
    const result = work();
    transactionDepth -= 1;
    if (outermost) db.exec('COMMIT');
    else db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    transactionDepth -= 1;
    if (outermost) {
      db.exec('ROLLBACK');
    } else {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    }
    throw error;
  }
}

export function closeDatabase() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // Best-effort checkpoint during shutdown.
  }
  db.close();
}
