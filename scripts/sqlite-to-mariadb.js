// Converte o banco SQLite legado em um dump SQL para o MariaDB (10.3+).
//
// Uso: node scripts/sqlite-to-mariadb.js [data/ponto.sqlite] [data/ponto-mariadb.sql]
//
// O SQLite é aberto somente para leitura. O dump recria as tabelas (DROP + CREATE) e insere os dados;
// importe-o em um banco vazio: mysql -u USUARIO -p NOME_DO_BANCO < data/ponto-mariadb.sql
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2';
import { TABLES } from '../src/schema.js';

const source = resolve(process.argv[2] || 'data/ponto.sqlite');
const target = resolve(process.argv[3] || 'data/ponto-mariadb.sql');
const sqlite = new DatabaseSync(source, { readOnly: true });
const now = Date.now();
const report = [];
const note = (message, count = 1) => { if (count) report.push(`${message}: ${count}`); };

const tableExists = name => !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const rows = (sql, ...params) => sqlite.prepare(sql).all(...params);
for (const legacy of ['legacy_marks', 'legacy_day_settings', 'legacy_settings', 'legacy_shift_provisions'])
  if (tableExists(legacy)) throw new Error(`Tabela ${legacy} encontrada: a migração legada pendente do SQLite precisa ser concluída antes.`);

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const validDate = value => typeof value === 'string' && DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validDatetime = value => typeof value === 'string' && /^\S{10} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value) && validDate(value.slice(0, 10));
const datetimeOr = (value, fallback) => validDatetime(value) ? value : fallback;
const int = value => Number.isInteger(Number(value)) && value !== null && value !== '' ? Number(value) : NaN;
// Aproxima a comparação utf8mb4_unicode_ci (ignora maiúsculas e acentos) para achar colisões antes do import.
const ciKey = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const nowUtc = new Date(now).toISOString().slice(0, 19).replace('T', ' ');

// --- users
const users = [];
const usernames = new Map();
const emails = new Map();
for (const row of rows('SELECT * FROM users ORDER BY created_at, id')) {
  const username = String(row.username ?? '').trim();
  if (!row.id || !username || !row.password_hash) { note(`Usuário inválido descartado (${row.id})`); continue; }
  if (usernames.has(ciKey(username))) throw new Error(`Usuários "${usernames.get(ciKey(username))}" e "${username}" colidem no MariaDB (maiúsculas/acentos). Renomeie um deles no SQLite antes de migrar.`);
  usernames.set(ciKey(username), username);
  let email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : null;
  if (!email) email = null;
  if (email && emails.has(ciKey(email))) { note(`Email duplicado removido do usuário ${username}`); email = null; }
  if (email) emails.set(ciKey(email), username);
  if (email && row.email !== email) note(`Email normalizado (minúsculas/espaços) de ${username}`);
  if (!email && row.email != null) note(`Email vazio virou NULL em ${username}`);
  users.push({ id: row.id, username, email, role: row.role || '', password_hash: row.password_hash, created_at: datetimeOr(row.created_at, nowUtc) });
}
if (users.length && !users.some(user => user.role === 'superadmin')) { users[0].role = 'superadmin'; note('Primeiro usuário promovido a superadmin'); }
const userIds = new Set(users.map(user => user.id));
const owned = (table, list) => { const kept = list.filter(row => userIds.has(row.user_id)); note(`${table}: linhas órfãs descartadas`, list.length - kept.length); return kept; };

// --- sessions / reset codes: só as que ainda valem
const allSessions = rows('SELECT * FROM user_sessions');
const sessions = owned('user_sessions', allSessions.filter(row => int(row.expires_at) > now));
note('user_sessions: sessões expiradas descartadas', allSessions.length - allSessions.filter(row => int(row.expires_at) > now).length);
const allResets = tableExists('password_reset_codes') ? rows('SELECT * FROM password_reset_codes') : [];
const resets = owned('password_reset_codes', allResets.filter(row => Number(row.used) === 0 && int(row.expires_at) > now));
note('password_reset_codes: códigos usados ou expirados descartados', allResets.length - allResets.filter(row => Number(row.used) === 0 && int(row.expires_at) > now).length);

// --- onboarding
const onboarding = owned('user_onboarding', rows('SELECT * FROM user_onboarding')).map(row => ({
  user_id: row.user_id, complete: Number(row.complete) === 1 ? 1 : 0, completed_at: row.completed_at == null ? null : datetimeOr(row.completed_at, nowUtc),
}));

// --- work schedules
const schedules = [];
const scheduleNames = new Map();
for (const row of rows('SELECT * FROM work_schedules ORDER BY is_builtin DESC, created_at, id')) {
  let name = String(row.name ?? '').trim().slice(0, 100);
  if (scheduleNames.has(ciKey(name))) { const renamed = `${name} (${row.id.slice(0, 8)})`; note(`Jornada "${name}" renomeada para "${renamed}" (nome duplicado)`); name = renamed; }
  scheduleNames.set(ciKey(name), row.id);
  schedules.push({ id: row.id, name, created_by: userIds.has(row.created_by) ? row.created_by : null, is_builtin: Number(row.is_builtin) === 1 ? 1 : 0, created_at: datetimeOr(row.created_at, nowUtc) });
}
const scheduleIds = new Set(schedules.map(schedule => schedule.id));
const scheduleDays = [];
for (const row of rows('SELECT * FROM work_schedule_days ORDER BY schedule_id, weekday')) {
  const day = { schedule_id: row.schedule_id, weekday: int(row.weekday), start_minute: int(row.start_minute), end_minute: int(row.end_minute), break_minutes: int(row.break_minutes), frequency: row.frequency === 'biweekly' ? 'biweekly' : 'weekly', anchor_date: row.anchor_date ?? null };
  if (day.frequency === 'weekly') day.anchor_date = null;
  const ok = scheduleIds.has(day.schedule_id) && day.weekday >= 0 && day.weekday <= 6 && day.start_minute >= 0 && day.start_minute <= 1439 && day.end_minute >= 1 && day.end_minute <= 1440
    && day.end_minute > day.start_minute && day.break_minutes >= 0 && day.break_minutes <= 240 && day.break_minutes < day.end_minute - day.start_minute
    && (day.frequency === 'weekly' || validDate(day.anchor_date));
  if (ok) scheduleDays.push(day); else note(`work_schedule_days inválido descartado (${row.schedule_id}/${row.weekday})`);
}
const ownedAssignments = owned('user_work_schedules', rows('SELECT * FROM user_work_schedules'));
note('user_work_schedules: jornada inexistente trocada por equipe-dev', ownedAssignments.filter(row => !scheduleIds.has(row.schedule_id)).length);
const assignments = ownedAssignments.map(row => ({
  user_id: row.user_id, schedule_id: scheduleIds.has(row.schedule_id) ? row.schedule_id : 'equipe-dev', assigned_at: datetimeOr(row.assigned_at, nowUtc),
}));
for (const user of users) if (!assignments.some(row => row.user_id === user.id)) { assignments.push({ user_id: user.id, schedule_id: 'equipe-dev', assigned_at: nowUtc }); note(`Usuário ${user.username} sem jornada recebeu equipe-dev`); }
if (assignments.some(row => row.schedule_id === 'equipe-dev') && !scheduleIds.has('equipe-dev')) throw new Error('Jornada equipe-dev ausente no SQLite.');

// --- marks
const allMarks = owned('marks', rows('SELECT * FROM marks ORDER BY user_id, mark_datetime'));
const marks = allMarks.filter(row => typeof row.id === 'string' && row.id.length <= 128 && validDatetime(row.mark_datetime)).map(row => ({
  user_id: row.user_id, id: row.id, mark_datetime: row.mark_datetime, timezone: String(row.timezone || 'America/Sao_Paulo').slice(0, 64), origin: String(row.origin || 'import').slice(0, 32),
}));
note('marks: batimentos com data/hora ou id inválidos descartados', allMarks.length - marks.length);

// --- day settings
const allDays = owned('day_settings', rows('SELECT * FROM day_settings'));
const daySettings = allDays.filter(row => validDate(row.date) && int(row.target_minutes) >= 0 && int(row.target_minutes) <= 1440).map(row => ({
  user_id: row.user_id, date: row.date, target_minutes: int(row.target_minutes), note: String(row.note ?? '').slice(0, 255), kind: row.kind === 'compensatory-off' ? 'compensatory-off' : 'adjustment',
}));
note('day_settings: dias inválidos descartados', allDays.length - daySettings.length);

// --- user settings (descarta credenciais obsoletas do Acuttis)
const allSettings = owned('user_settings', rows('SELECT * FROM user_settings'));
const settings = allSettings.filter(row => row.key !== 'acuttis_credentials_v1' && typeof row.key === 'string' && row.key.length <= 64).map(row => ({ user_id: row.user_id, key: row.key, value: String(row.value ?? '') }));
note('user_settings: chaves obsoletas/inválidas descartadas', allSettings.length - settings.length);

// --- shift provisions
const allShifts = owned('shift_provisions', rows('SELECT * FROM shift_provisions ORDER BY id'));
const shifts = allShifts.filter(row => validDate(row.duty_date) && validDate(row.day_off_date) && [480, 540].includes(int(row.duty_target_minutes))).map(row => ({
  id: int(row.id), user_id: row.user_id, duty_date: row.duty_date, day_off_date: row.day_off_date, duty_target_minutes: int(row.duty_target_minutes), created_at: datetimeOr(row.created_at, nowUtc),
}));
note('shift_provisions: plantões inválidos descartados', allShifts.length - shifts.length);
const sequence = tableExists('sqlite_sequence') ? Number(sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name='shift_provisions'").get()?.seq || 0) : 0;
const nextShiftId = Math.max(sequence, ...shifts.map(row => row.id), 0) + 1;

// --- escrita do dump
const data = {
  users, user_sessions: sessions, password_reset_codes: resets, user_onboarding: onboarding, work_schedules: schedules,
  work_schedule_days: scheduleDays, user_work_schedules: assignments, marks, day_settings: daySettings, user_settings: settings, shift_provisions: shifts,
};
const out = [
  `-- Dump MariaDB do Controle de Ponto gerado a partir de ${source}`,
  `-- Gerado em ${new Date(now).toISOString()}`,
  ...report.map(line => `-- ${line}`),
  'SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;',
  "SET time_zone = '+00:00';",
  'SET FOREIGN_KEY_CHECKS = 0;',
  "SET SQL_MODE = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_VALUE_ON_ZERO';",
  ...[...TABLES].reverse().map(([name]) => `DROP TABLE IF EXISTS \`${name}\`;`),
  ...TABLES.map(([, ddl]) => `${ddl};`),
];
for (const [name] of TABLES) {
  const list = data[name];
  out.push(`-- ${name}: ${list.length} linha(s)`);
  if (!list.length) continue;
  const columns = Object.keys(list[0]);
  for (let i = 0; i < list.length; i += 200) {
    const values = list.slice(i, i + 200).map(row => `(${columns.map(column => mysql.escape(row[column])).join(',')})`).join(',\n');
    out.push(`INSERT INTO \`${name}\` (${columns.map(column => `\`${column}\``).join(',')}) VALUES\n${values};`);
  }
}
out.push(`ALTER TABLE shift_provisions AUTO_INCREMENT = ${nextShiftId};`, 'SET FOREIGN_KEY_CHECKS = 1;', '');
writeFileSync(target, out.join('\n'), { mode: 0o600 });

console.log(`Dump gravado em ${target}`);
for (const [name, list] of Object.entries(data)) console.log(`  ${name.padEnd(22)} ${list.length}`);
console.log(report.length ? `Ajustes:\n  ${report.join('\n  ')}` : 'Nenhum ajuste necessário.');
