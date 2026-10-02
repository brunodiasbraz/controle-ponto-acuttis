import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = resolve(process.env.DB_PATH || 'data/ponto.sqlite');
mkdirSync(dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec(`PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS marks (
    id TEXT PRIMARY KEY,
    mark_datetime TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    origin TEXT NOT NULL DEFAULT 'import'
  );
  CREATE INDEX IF NOT EXISTS marks_datetime_idx ON marks(mark_datetime);
  CREATE TABLE IF NOT EXISTS day_settings (
    date TEXT PRIMARY KEY,
    target_minutes INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shift_provisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duty_date TEXT NOT NULL UNIQUE,
    day_off_date TEXT NOT NULL UNIQUE,
    duty_target_minutes INTEGER NOT NULL CHECK(duty_target_minutes IN (480, 540)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

export function setting(key, fallback) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
}

export function saveSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

export function importMarks(input) {
  const marks = Array.isArray(input) ? input : (input?.data?.marks || input?.data?.rows || input?.data || input?.marks || input?.rows || input?.results);
  if (!Array.isArray(marks)) throw new Error('Resposta de batimentos em formato desconhecido.');
  const insert = db.prepare('INSERT OR IGNORE INTO marks(id, mark_datetime, timezone, origin) VALUES(?,?,?,?)');
  let added = 0;
  db.exec('BEGIN');
  try {
    for (const mark of marks) {
      if (typeof mark?._id !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(mark.mark_datetime || '')) continue;
      added += Number(insert.run(mark._id, mark.mark_datetime, mark.timezone || 'America/Sao_Paulo', mark.origin || 'acuttis').changes);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { added, received: marks.length };
}
