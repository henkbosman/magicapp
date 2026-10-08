import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-deck-export-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_FILE = 'export.sqlite';

const { db, closeDatabase } = await import('../src/db/database.js');
const { exportDeck, exportDeckDck, exportDeckText } = await import('../src/services/deck-service.js');

function card(id, name, {
  oracleId = `oracle-${id}`, layout = 'normal', faces = [], setCode = 'tst', collectorNumber = String(id)
} = {}) {
  db.prepare(`INSERT INTO cards
    (id, scryfall_id, oracle_id, name, search_name, set_code, collector_number, layout, card_faces_json, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`)
    .run(id, `printing-${id}`, oracleId, name, name.toLowerCase(), setCode, collectorNumber, layout, JSON.stringify(faces));
}

function add(cardId, quantity, role = 'main', deckId = 1) {
  db.prepare('INSERT INTO deck_cards (deck_id, card_id, quantity, role) VALUES (?, ?, ?, ?)')
    .run(deckId, cardId, quantity, role);
}

function databaseSnapshot() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  return {
    totalChanges: db.prepare('SELECT total_changes() AS n').get().n,
    tables: tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()])
  };
}

beforeEach(() => {
  db.exec('DELETE FROM decks; DELETE FROM wanted_items; DELETE FROM collection_items; DELETE FROM cards;');
  db.prepare('INSERT INTO decks (id, name) VALUES (1, ?)').run('Forge & Neo Forge');
  card(1, 'Ardenn, Intrepid Archaeologist');
  card(2, 'Rograkh, Son of Rohgahh');
  card(3, 'Lightning Bolt', { oracleId: 'oracle-bolt' });
  card(4, 'Lightning Bolt', { oracleId: 'oracle-bolt' });
  card(5, 'Lurrus of the Dream-Den');
  card(6, 'Opt');
  add(1, 1, 'commander');
  add(2, 1, 'partner');
  add(3, 3);
  add(4, 2);
  add(3, 1, 'sideboard');
  add(5, 1, 'companion');
  add(6, 9, 'maybeboard');
});

after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('TXT export preserves its existing flat text, ordering, Oracle aggregation and missing-only format', () => {
  const expected = {
    filename: 'forge-neo-forge.txt',
    text: '1 Ardenn, Intrepid Archaeologist\n1 Rograkh, Son of Rohgahh\n1 Lurrus of the Dream-Den\n6 Lightning Bolt\n'
  };
  assert.deepEqual(exportDeckText(1), expected);
  assert.deepEqual(exportDeck(1), { ...expected, format: 'txt' });
  assert.deepEqual(exportDeck(1, { format: 'txt' }), { ...expected, format: 'txt' });
  db.prepare('INSERT INTO collection_items (card_id, quantity, finish) VALUES (3, 2, ?)').run('foil');
  assert.deepEqual(exportDeckText(1, { missingOnly: true }), {
    filename: 'forge-neo-forge-ontbrekend.txt',
    text: '1 Ardenn, Intrepid Archaeologist\n1 Rograkh, Son of Rohgahh\n3 Lightning Bolt\n'
  });
});

test('DCK keeps both commanders and aggregates only identical printings within their deck section', () => {
  // The same card can legitimately have separate quantities in Main and Sideboard.
  // A companion also lives in Sideboard in Forge's deck format.
  add(5, 2, 'sideboard');
  const expected = {
    filename: 'forge-neo-forge.dck',
    text: '[metadata]\nName=Forge & Neo Forge\n[Commander]\n1 Ardenn, Intrepid Archaeologist|TST|[1]\n1 Rograkh, Son of Rohgahh|TST|[2]\n[Main]\n3 Lightning Bolt|TST|[3]\n2 Lightning Bolt|TST|[4]\n[Sideboard]\n3 Lurrus of the Dream-Den|TST|[5]\n1 Lightning Bolt|TST|[3]\n'
  };
  assert.deepEqual(exportDeckDck(1), expected);
  assert.deepEqual(exportDeck(1, { format: 'dck' }), { ...expected, format: 'dck' });
  assert.doesNotMatch(expected.text, /Opt|printing-|oracle-|\|tst|\[Companion\]/);
});

test('DCK reproduces printing references from the supplied Neo Forge deck', () => {
  db.exec('DELETE FROM deck_cards');
  // Representative rows from the user's New deck.dck, including The List's
  // original-set collector number and a commander outside the Main section.
  card(10, 'Avenger of Zendikar', { setCode: 'plst', collectorNumber: 'WWK-96' });
  card(11, 'Forest', { setCode: 'trk', collectorNumber: '325' });
  card(12, 'Yedora, Grave Gardener', { setCode: 'dsc', collectorNumber: '209' });
  add(10, 1);
  add(11, 35);
  add(12, 1, 'commander');
  assert.equal(exportDeckDck(1).text,
    '[metadata]\nName=Forge & Neo Forge\n[Commander]\n1 Yedora, Grave Gardener|DSC|[209]\n[Main]\n1 Avenger of Zendikar|PLST|[WWK-96]\n35 Forest|TRK|[325]\n');
});

test('DCK preserves distinct land printings, string collector numbers and quantities', () => {
  db.exec('DELETE FROM deck_cards');
  const variants = [
    ['znr', '275', 4],
    ['znr', '276', 7],
    ['m21', '275', 2],
    ['znr', '275a', 3],
    ['znr', '0275', 5],
    ['plst', 'ZEN-249', 6],
    ['sld', '123★', 1],
    // Another cached record for the exact same exported printing may be merged.
    ['ZNR', '275', 8]
  ];
  variants.forEach(([setCode, collectorNumber, quantity], index) => {
    card(10 + index, 'Forest', { oracleId: 'oracle-forest', setCode, collectorNumber });
    add(10 + index, quantity);
  });
  const lines = exportDeckDck(1).text.split('\n');
  const expected = ['12 Forest|ZNR|[275]', '7 Forest|ZNR|[276]', '2 Forest|M21|[275]',
    '3 Forest|ZNR|[275a]', '5 Forest|ZNR|[0275]', '6 Forest|PLST|[ZEN-249]', '1 Forest|SLD|[123★]'];
  assert.deepEqual(lines.filter((line) => /^\d+ /.test(line)).sort(), expected.sort());
  assert.equal(lines.filter((line) => /^\d+ /.test(line)).reduce((sum, line) => sum + Number(line.split(' ')[0]), 0), 36);
  assert.equal(exportDeckText(1).text, '36 Forest\n');
});

test('DCK does not substitute collection printings or infer foil status', () => {
  card(10, 'Lightning Bolt', { oracleId: 'oracle-bolt', setCode: 'lea', collectorNumber: '161' });
  db.prepare('INSERT INTO collection_items (card_id, quantity, finish) VALUES (10, 6, ?)').run('foil');
  const text = exportDeckDck(1).text;
  assert.match(text, /3 Lightning Bolt\|TST\|\[3\]/);
  assert.match(text, /2 Lightning Bolt\|TST\|\[4\]/);
  assert.doesNotMatch(text, /LEA|Lightning Bolt\+/);
});

test('DCK rejects missing or unsafe printing data instead of silently choosing different artwork', () => {
  const invalid = [
    ['set_code', '', 'setcode'],
    ['collector_number', '', 'collectornummer'],
    ['set_code', '  ', 'setcode'],
    ['collector_number', '  ', 'collectornummer'],
    ['set_code', '123', 'setcode'],
    ['set_code', 'ß', 'setcode'],
    ['set_code', 'ZNR|1', 'setcode'],
    ['set_code', 'ZN\nR', 'setcode'],
    ['set_code', 'ZNR\r', 'setcode'],
    ['collector_number', '12|[13]', 'collectornummer'],
    ['collector_number', '12]\n[Sideboard]', 'collectornummer'],
    ['collector_number', '12\r', 'collectornummer'],
    ['collector_number', '12\u0000', 'collectornummer'],
    ['name', 'Lightning Bolt|LEA|[161]', 'kaartnaam']
  ];
  for (const [column, value, label] of invalid) {
    db.prepare('UPDATE cards SET name = ?, set_code = ?, collector_number = ? WHERE id = 3').run('Lightning Bolt', 'tst', '3');
    db.prepare(`UPDATE cards SET ${column} = ? WHERE id = 3`).run(value);
    const before = databaseSnapshot();
    assert.throws(() => exportDeckDck(1), (error) =>
      error.status === 400 && error.message.includes('Lightning Bolt') && error.message.includes(label), `${column}: ${JSON.stringify(value)}`);
    assert.deepEqual(databaseSnapshot(), before);
  }
  db.prepare('UPDATE cards SET name = ?, set_code = ?, collector_number = ? WHERE id = 3').run('Lightning Bolt', '', '');
  assert.match(exportDeckText(1).text, /6 Lightning Bolt\n/);
  // Maybeboard cards are excluded, so incomplete data there cannot block export.
  db.prepare('UPDATE cards SET set_code = ?, collector_number = ? WHERE id = 3').run('tst', '3');
  db.prepare('UPDATE cards SET set_code = ?, collector_number = ? WHERE id = 6').run('', '');
  assert.doesNotThrow(() => exportDeckDck(1));
});

test('an empty deck produces an empty TXT and a valid DCK with a Main section', () => {
  db.exec('DELETE FROM deck_cards');
  assert.deepEqual(exportDeckText(1), { filename: 'forge-neo-forge.txt', text: '' });
  assert.equal(exportDeckDck(1).text, '[metadata]\nName=Forge & Neo Forge\n[Main]\n');
});

test('Forge export uses front-face names for double-faced, adventure and flip cards, and both names for split cards', () => {
  db.exec('DELETE FROM deck_cards');
  const examples = [
    ['transform', 'Delver of Secrets // Insectile Aberration', 'Delver of Secrets'],
    ['modal_dfc', 'Bala Ged Recovery // Bala Ged Sanctuary', 'Bala Ged Recovery'],
    ['adventure', 'Brazen Borrower // Petty Theft', 'Brazen Borrower'],
    ['flip', 'Nezumi Graverobber // Nighteyes the Desecrator', 'Nezumi Graverobber'],
    ['double_faced_token', 'Human // Soldier', 'Human'],
    ['split', 'Fire//Ice', 'Fire // Ice'],
    ['split', 'Never // Return', 'Never // Return'],
    ['split', 'Roaring Furnace // Steaming Sauna', 'Roaring Furnace // Steaming Sauna'],
    ['future_layout', 'Unrecognized front // Other face', 'Unrecognized front // Other face']
  ];
  let id = 10;
  for (const [layout, name, expected] of examples) {
    const collectorNumber = String(id);
    // Both a complete Scryfall record and an older record without card_faces
    // must export the same playable card name without changing cached data.
    for (const faces of [[], [{ name: name.split(/\s*\/\/\s*/)[0] }]]) {
      card(id, name, { layout, faces, oracleId: `oracle-${name}`, collectorNumber });
      add(id, 1);
      id += 1;
    }
    const lines = exportDeckDck(1).text.split('\n');
    assert.ok(lines.includes(`2 ${expected}|TST|[${collectorNumber}]`), `${layout}: ${expected}`);
  }
  const txt = exportDeckText(1).text.split('\n');
  for (const [, name] of examples) assert.ok(txt.includes(`2 ${name}`), 'TXT naming remains unchanged');
});

test('deck metadata stays on one line and export filenames cannot inject download headers', () => {
  db.prepare('UPDATE decks SET name = ? WHERE id = 1').run('My deck\r\n[Sideboard]\n"bad"');
  const result = exportDeckDck(1);
  assert.equal(result.filename, 'my-deck-sideboard-bad.dck');
  assert.equal(result.text.split('\n')[1], 'Name=My deck [Sideboard] "bad"');
  assert.equal(result.text.split('\n').filter((line) => line === '[Sideboard]').length, 1);
  db.prepare('UPDATE decks SET name = ? WHERE id = 1').run('★');
  assert.equal(exportDeckDck(1).filename, 'deck.dck');
});

test('unknown export formats and absent decks fail explicitly', () => {
  for (const format of ['csv', '../dck', ['txt', 'dck']]) {
    assert.throws(() => exportDeck(1, { format }), (error) => error.status === 400);
  }
  for (const format of ['txt', 'dck']) {
    assert.throws(() => exportDeck(999, { format }), (error) => error.status === 404);
  }
});

test('preview, downloads and failures perform no database writes or changes to owned finishes', () => {
  db.prepare('INSERT INTO collection_items (card_id, quantity, finish, notes) VALUES (3, 2, ?, ?)')
    .run('foil', 'Keep this owned variant unchanged');
  db.prepare('INSERT INTO wanted_items (card_id, quantity, notes) VALUES (4, 3, ?)').run('Keep wanted');
  const before = databaseSnapshot();
  exportDeckText(1);
  exportDeckText(1, { missingOnly: true });
  exportDeckDck(1);
  exportDeck(1, { format: 'txt' });
  exportDeck(1, { format: 'dck' });
  assert.throws(() => exportDeck(1, { format: 'invalid' }));
  assert.throws(() => exportDeck(999, { format: 'dck' }));
  assert.deepEqual(databaseSnapshot(), before);
});

test('export HTTP routes return matching preview/download content and reject invalid requests', async (t) => {
  let express;
  try {
    ({ default: express } = await import('express'));
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    t.skip('Installeer de Express-afhankelijkheid om de HTTP-integratietest uit te voeren.');
    return;
  }
  const { decksReadRouter } = await import('../src/routes/decks.js');
  const { HttpError } = await import('../src/lib/http-error.js');
  const app = express();
  app.use('/api/read/decks', decksReadRouter);
  app.use((error, _req, res, _next) => {
    res.status(error instanceof HttpError ? error.status : 500).json({ error: { message: error.message } });
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}/api/read/decks`;
  const before = databaseSnapshot();
  for (const format of ['txt', 'dck']) {
    const response = await fetch(`${origin}/1/export?format=${format}`);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.deepEqual(data, exportDeck(1, { format }));
    const download = await fetch(`${origin}/1/export.${format}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(download.headers.get('content-disposition'), `attachment; filename="${data.filename}"`);
    assert.equal(await download.text(), data.text);
  }
  const defaultFormat = await fetch(`${origin}/1/export`);
  assert.deepEqual(await defaultFormat.json(), { data: exportDeck(1) });
  const missing = await fetch(`${origin}/1/export.txt?missing=true`);
  assert.equal(await missing.text(), exportDeckText(1, { missingOnly: true }).text);
  for (const route of ['/1/export?format=csv', '/0/export', '/bad/export.dck', '/1/export?format=txt&format=dck']) {
    assert.equal((await fetch(`${origin}${route}`)).status, 400, route);
  }
  for (const route of ['/999/export', '/999/export.dck']) {
    assert.equal((await fetch(`${origin}${route}`)).status, 404, route);
  }
  assert.deepEqual(databaseSnapshot(), before);
});
