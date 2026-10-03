import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = resolve(process.env.DB_PATH || 'data/ponto.sqlite');
mkdirSync(dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function columns(name) {
  return tableExists(name) ? db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name) : [];
}
for (const name of ['marks', 'day_settings', 'settings', 'shift_provisions']) {
  const legacy = `legacy_${name}`;
  if (tableExists(name) && !columns(name).includes('user_id') && !tableExists(legacy))
    db.exec(`ALTER TABLE ${name} RENAME TO ${legacy}`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS user_sessions_expiry_idx ON user_sessions(expires_at);
  CREATE TABLE IF NOT EXISTS user_onboarding (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)),
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS work_schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    is_builtin INTEGER NOT NULL DEFAULT 0 CHECK(is_builtin IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS work_schedule_days (
    schedule_id TEXT NOT NULL REFERENCES work_schedules(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
    start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
    end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1440),
    break_minutes INTEGER NOT NULL CHECK(break_minutes BETWEEN 0 AND 240),
    frequency TEXT NOT NULL DEFAULT 'weekly' CHECK(frequency IN ('weekly','biweekly')),
    anchor_date TEXT,
    PRIMARY KEY(schedule_id, weekday),
    CHECK(end_minute > start_minute),
    CHECK(break_minutes < end_minute - start_minute),
    CHECK((frequency='weekly' AND anchor_date IS NULL) OR (frequency='biweekly' AND anchor_date IS NOT NULL))
  );
  CREATE TABLE IF NOT EXISTS user_work_schedules (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    schedule_id TEXT NOT NULL REFERENCES work_schedules(id),
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS marks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    mark_datetime TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    origin TEXT NOT NULL DEFAULT 'import',
    PRIMARY KEY(user_id, id)
  );
  CREATE INDEX IF NOT EXISTS user_marks_datetime_idx ON marks(user_id, mark_datetime);
  CREATE TABLE IF NOT EXISTS day_settings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    target_minutes INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(user_id, date)
  );
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY(user_id, key)
  );
  CREATE TABLE IF NOT EXISTS shift_provisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    duty_date TEXT NOT NULL,
    day_off_date TEXT NOT NULL,
    duty_target_minutes INTEGER NOT NULL CHECK(duty_target_minutes IN (480, 540)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, duty_date),
    UNIQUE(user_id, day_off_date)
  );
`);

db.prepare("INSERT OR IGNORE INTO work_schedules(id,name,is_builtin) VALUES('equipe-dev','Equipe Dev',1)").run();
const devDay = db.prepare("INSERT OR IGNORE INTO work_schedule_days(schedule_id,weekday,start_minute,end_minute,break_minutes) VALUES('equipe-dev',?,?,?,60)");
for (const day of [1, 2, 3, 4]) devDay.run(day, 480, 1080);
devDay.run(5, 480, 1020);
db.exec("INSERT OR IGNORE INTO user_work_schedules(user_id,schedule_id) SELECT id,'equipe-dev' FROM users");

export function setting(userId, key, fallback) {
  return db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key)?.value ?? fallback;
}

export function saveSetting(userId, key, value) {
  db.prepare('INSERT INTO user_settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value').run(userId, key, String(value));
}

export function claimLegacyData(userId) {
  if (tableExists('legacy_marks')) db.prepare('INSERT OR IGNORE INTO marks(user_id,id,mark_datetime,timezone,origin) SELECT ?,id,mark_datetime,timezone,origin FROM legacy_marks').run(userId);
  if (tableExists('legacy_day_settings')) db.prepare('INSERT OR IGNORE INTO day_settings(user_id,date,target_minutes,note) SELECT ?,date,target_minutes,note FROM legacy_day_settings').run(userId);
  if (tableExists('legacy_settings')) db.prepare('INSERT OR IGNORE INTO user_settings(user_id,key,value) SELECT ?,key,value FROM legacy_settings').run(userId);
  if (tableExists('legacy_settings') && db.prepare("SELECT value FROM legacy_settings WHERE key='onboarding_complete'").get()?.value === '1')
    db.prepare("INSERT OR IGNORE INTO user_onboarding(user_id,complete,completed_at) VALUES(?,1,CURRENT_TIMESTAMP)").run(userId);
  if (tableExists('legacy_shift_provisions')) db.prepare('INSERT OR IGNORE INTO shift_provisions(user_id,duty_date,day_off_date,duty_target_minutes,created_at) SELECT ?,duty_date,day_off_date,duty_target_minutes,created_at FROM legacy_shift_provisions').run(userId);
  for (const name of ['legacy_marks', 'legacy_day_settings', 'legacy_settings', 'legacy_shift_provisions'])
    db.exec(`DROP TABLE IF EXISTS ${name}`);
}

export function onboardingComplete(userId) {
  return db.prepare('SELECT complete FROM user_onboarding WHERE user_id = ?').get(userId)?.complete === 1;
}

export function completeOnboarding(userId) {
  db.prepare('INSERT INTO user_onboarding(user_id,complete,completed_at) VALUES(?,1,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET complete=1,completed_at=CURRENT_TIMESTAMP').run(userId);
}

export function importMarks(input, userId) {
  const marks = Array.isArray(input) ? input : (input?.data?.marks || input?.data?.rows || input?.data || input?.marks || input?.rows || input?.results);
  if (!Array.isArray(marks)) throw new Error('Resposta de batimentos em formato desconhecido.');
  const insert = db.prepare('INSERT OR IGNORE INTO marks(user_id,id,mark_datetime,timezone,origin) VALUES(?,?,?,?,?)');
  let added = 0;
  db.exec('BEGIN');
  try {
    for (const mark of marks) {
      if (typeof mark?._id !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(mark.mark_datetime || '')) continue;
      added += Number(insert.run(userId, mark._id, mark.mark_datetime, mark.timezone || 'America/Sao_Paulo', mark.origin || 'acuttis').changes);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { added, received: marks.length };
}
