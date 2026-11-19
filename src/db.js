import mysql from 'mysql2/promise';
import { TABLES } from './schema.js';

const required = name => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Defina ${name} no ambiente (veja .env.example).`);
  return value;
};

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: required('DB_USER'),
  password: process.env.DB_PASSWORD || '',
  database: required('DB_NAME'),
  charset: 'utf8mb4_unicode_ci',
  // Datas e horários trafegam como texto ('YYYY-MM-DD' e 'YYYY-MM-DD HH:MM:SS'), como no SQLite.
  dateStrings: true,
  timezone: 'Z',
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  waitForConnections: true,
  // Objetos vindos do JSON da requisição viram texto em vez de pares `coluna = valor`.
  stringifyObjects: true,
});
// CURRENT_TIMESTAMP grava em UTC, mantendo o padrão herdado do SQLite.
pool.on('connection', connection => connection.query("SET time_zone = '+00:00'"));

/** Executa uma consulta e devolve as linhas (SELECT) ou o resultado (INSERT/UPDATE/DELETE). */
export async function query(sql, params = [], conn = pool) {
  const [result] = await conn.query(sql, params);
  return result;
}

/** Primeira linha da consulta, ou undefined. */
export async function one(sql, params = [], conn = pool) {
  return (await query(sql, params, conn))[0];
}

/** Executa fn(conn) em uma transação; desfaz tudo se fn lançar erro. */
export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch {}
    throw error;
  } finally {
    conn.release();
  }
}

export const isDuplicate = error => error?.code === 'ER_DUP_ENTRY';

async function init() {
  for (const [, ddl] of TABLES) await query(ddl);
  const superadmin = await one("SELECT id FROM users WHERE role='superadmin' LIMIT 1");
  if (!superadmin) {
    const first = await one('SELECT id FROM users ORDER BY created_at,id LIMIT 1');
    if (first) await query("UPDATE users SET role='superadmin' WHERE id=?", [first.id]);
  }
  await query("INSERT IGNORE INTO work_schedules(id,name,is_builtin) VALUES('equipe-dev','Equipe Dev',1)");
  const devDays = [1, 2, 3, 4].map(day => ['equipe-dev', day, 480, 1080, 60]);
  devDays.push(['equipe-dev', 5, 480, 1020, 60]);
  await query('INSERT IGNORE INTO work_schedule_days(schedule_id,weekday,start_minute,end_minute,break_minutes) VALUES ?', [devDays]);
  await query("INSERT IGNORE INTO user_work_schedules(user_id,schedule_id) SELECT id,'equipe-dev' FROM users");
}
await init();

export async function setting(userId, key, fallback, conn = pool) {
  return (await one('SELECT value FROM user_settings WHERE user_id = ? AND `key` = ?', [userId, key], conn))?.value ?? fallback;
}

export async function saveSetting(userId, key, value, conn = pool) {
  await query('INSERT INTO user_settings(user_id,`key`,value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)', [userId, key, String(value)], conn);
}

export async function deleteCompensatoryDayOff(userId, date) {
  const result = await query("DELETE FROM day_settings WHERE user_id = ? AND date = ? AND kind = 'compensatory-off'", [userId, date]);
  return result.affectedRows > 0;
}

export async function onboardingComplete(userId) {
  return (await one('SELECT complete FROM user_onboarding WHERE user_id = ?', [userId]))?.complete === 1;
}

export async function completeOnboarding(userId) {
  await query('INSERT INTO user_onboarding(user_id,complete,completed_at) VALUES(?,1,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE complete=1,completed_at=CURRENT_TIMESTAMP', [userId]);
}

const MARK_DATETIME = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
export const validMarkDatetime = value => {
  const match = MARK_DATETIME.exec(value || '');
  return !!match && new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])).getUTCDate() === +match[3];
};

export async function importMarks(input, userId) {
  const marks = Array.isArray(input) ? input : (input?.data?.marks || input?.data?.rows || input?.data || input?.marks || input?.rows || input?.results);
  if (!Array.isArray(marks)) throw new Error('Resposta de batimentos em formato desconhecido.');
  const rows = marks
    .filter(mark => typeof mark?._id === 'string' && mark._id.length <= 128 && validMarkDatetime(mark.mark_datetime))
    .map(mark => [userId, mark._id, mark.mark_datetime, String(mark.timezone || 'America/Sao_Paulo').slice(0, 64), String(mark.origin || 'acuttis').slice(0, 32)]);
  if (!rows.length) return { added: 0, received: marks.length };
  const result = await query('INSERT IGNORE INTO marks(user_id,id,mark_datetime,timezone,origin) VALUES ?', [rows]);
  return { added: result.affectedRows, received: marks.length };
}
