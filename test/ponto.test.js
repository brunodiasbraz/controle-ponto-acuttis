import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { dayStats, defaultTarget, projectedExit, shiftTargetForDayOff } from '../src/calc.js';

// Os testes de banco usam um MariaDB descartável: TEST_DB_NAME (precisa conter "test"), TEST_DB_HOST,
// TEST_DB_PORT, TEST_DB_USER e TEST_DB_PASSWORD. O banco é apagado e recriado a cada execução.
const testDb = process.env.TEST_DB_NAME;
const dbTest = testDb ? test : test.skip;
if (testDb) {
  if (!/test/i.test(testDb) || !/^[A-Za-z0-9_]+$/.test(testDb)) throw new Error('TEST_DB_NAME deve conter "test" e só letras, números e _.');
  Object.assign(process.env, {
    DB_HOST: process.env.TEST_DB_HOST || '127.0.0.1', DB_PORT: process.env.TEST_DB_PORT || '3306',
    DB_USER: process.env.TEST_DB_USER || 'root', DB_PASSWORD: process.env.TEST_DB_PASSWORD || '', DB_NAME: testDb,
  });
  const admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  await admin.query(`DROP DATABASE IF EXISTS \`${testDb}\``);
  await admin.query(`CREATE DATABASE \`${testDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();
  test.after(async () => (await import('../src/db.js')).pool.end());
}

test('jornada padrão da planilha: 9h de segunda a quinta e 8h na sexta', () => {
  assert.equal(defaultTarget('2026-10-01'), 540);
  assert.equal(defaultTarget('2026-10-02'), 480);
  assert.equal(defaultTarget('2026-10-03'), 0);
});

test('plantão é de 8h com folga na sexta e 9h com folga nos demais dias úteis', () => {
  assert.equal(shiftTargetForDayOff('2026-10-09'), 480);
  assert.equal(shiftTargetForDayOff('2026-10-12'), 540);
});

test('soma os pares de batimentos e desconta almoço real', () => {
  const marks = ['08:24', '12:15', '13:15', '18:35'].map((time, i) => ({ mark_datetime: `2026-10-01 ${time}:00`, _id: String(i) }));
  const result = dayStats('2026-10-01', marks, 540);
  assert.equal(result.worked, 551);
  assert.equal(result.balance, 11);
});

test('tolerância diária ignora diferenças de até dez minutos', () => {
  const marks = ['07:28', '13:00', '14:00', '16:36'].map(time => ({ mark_datetime: `2026-08-21 ${time}:00` }));
  const result = dayStats('2026-08-21', marks, 480);
  assert.equal(result.worked, 488);
  assert.equal(result.rawBalance, 8);
  assert.equal(result.balance, 0);
});

test('sexta com 11 minutos de crédito prevê saída às 16:19', () => {
  const day = dayStats('2026-10-02', [{ mark_datetime: '2026-10-02 07:30:00' }], 480);
  assert.equal(projectedExit(day, 469, 60), '16:19');
});

dbTest('importação idempotente e previsão mensal considera a compensação de sexta', async () => {
  const { importMarks } = await import('../src/db.js');
  const { query } = await import('../src/db.js');
  const { dashboard } = await import('../src/dashboard.js');
  const userId = 'test-shift-user';
  await query('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)', [userId, 'test-shift-user', 'test']);
  const sample = JSON.parse(readFileSync(resolve('test/sample.json'), 'utf8'));
  assert.equal((await importMarks(sample, userId)).added, 5);
  assert.equal((await importMarks(sample, userId)).added, 0);
  const result = await dashboard('2026-10', '2026-10-02', userId);
  assert.equal(result.projections.friday.exit, '16:19');
  assert.equal(result.projections.monthEnd.exit, '17:00');
});

dbTest('plantão com folga na sexta tem 8h e a tabela inclui o plantão futuro', async () => {
  const { query } = await import('../src/db.js');
  const { dashboard } = await import('../src/dashboard.js');
  const userId = 'test-user';
  await query('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)', [userId, 'test-user', 'test']);
  await query('INSERT INTO shift_provisions(user_id,duty_date,day_off_date,duty_target_minutes) VALUES(?,?,?,?)', [userId, '2026-10-03', '2026-10-09', 480]);
  const result = await dashboard('2026-10', '2026-10-02', userId);
  assert.equal(result.days.find(day => day.date === '2026-10-03').target, 480);
  assert.equal(result.days.find(day => day.date === '2026-10-03').shiftKind, 'duty');
  assert.equal(result.days.some(day => day.date === '2026-10-05'), false);
  assert.equal(result.days.some(day => day.date === '2026-10-09'), false);
  assert.equal(result.shifts[0].day_off_date, '2026-10-09');
  assert.equal(result.summary.monthTarget, 193 * 60 - 540); // Dia 12 é feriado nacional
  const beforeFolga = await dashboard('2026-10', '2026-10-08', userId);
  assert.equal(beforeFolga.projections.friday.dayOff, true);
  assert.equal(beforeFolga.projections.friday.exit, null);
});

dbTest('feriados nacionais não geram jornada e um plantão provisionado no feriado volta a ter jornada', async () => {
  const { query } = await import('../src/db.js');
  const { dashboard } = await import('../src/dashboard.js');
  const { holidayName } = await import('../src/holidays.js');
  const { datesBetween, defaultTarget } = await import('../src/calc.js');
  const userId = 'holiday-calendar-user';
  await query('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)', [userId, userId, 'test']);
  assert.equal(holidayName('2026-04-03'), 'Paixão de Cristo');
  assert.equal(holidayName('2026-06-04'), 'Corpus Christi');
  assert.equal(holidayName('2027-03-26'), 'Paixão de Cristo');
  assert.equal(holidayName('2027-05-27'), 'Corpus Christi');
  const withoutDuty = await dashboard('2026-04', '2026-04-30', userId);
  const scheduledApril = datesBetween('2026-04-01', '2026-04-30').reduce((sum, date) => sum + defaultTarget(date), 0);
  const aprilHolidayTarget = datesBetween('2026-04-01', '2026-04-30')
    .filter(date => holidayName(date))
    .reduce((sum, date) => sum + defaultTarget(date), 0);
  assert.equal(withoutDuty.summary.monthTarget, scheduledApril - aprilHolidayTarget);
  await query('INSERT INTO shift_provisions(user_id,duty_date,day_off_date,duty_target_minutes) VALUES(?,?,?,?)', [userId, '2026-04-03', '2026-04-06', 540]);
  const withDuty = await dashboard('2026-04', '2026-04-01', userId);
  const duty = withDuty.days.find(day => day.date === '2026-04-03');
  assert.equal(duty.target, 540);
  assert.equal(duty.isHoliday, true);
  assert.match(duty.note, /Paixão de Cristo/);
  assert.equal(withDuty.summary.monthTarget, withoutDuty.summary.monthTarget); // A folga compensatória reduz a mesma jornada que o plantão repõe.
});

dbTest('folga compensatória zera a jornada prevista e não cria saldo devedor', async () => {
  const { query } = await import('../src/db.js');
  const { dashboard } = await import('../src/dashboard.js');
  const userId = 'compensatory-leave-user';
  await query('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)', [userId, userId, 'test']);
  await query("INSERT INTO day_settings(user_id,date,target_minutes,note,kind) VALUES(?,? ,0,'Folga compensatória','compensatory-off')", [userId, '2026-10-05']);
  const result = await dashboard('2026-10', '2026-10-30', userId);
  const leave = result.days.find(day => day.date === '2026-10-05');
  assert.equal(leave.target, 0);
  assert.equal(leave.isCompensatoryOff, true);
  assert.equal(leave.balance, 0);
  assert.equal(leave.note, 'Folga compensatória');
  assert.equal(result.summary.monthTarget, 193 * 60 - 540 - 540);
});

dbTest('folga compensatória pode ser excluída apenas pela conta proprietária', async () => {
  const { query, deleteCompensatoryDayOff } = await import('../src/db.js');
  const owner = 'leave-owner';
  const other = 'leave-other';
  await query('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)', [owner, owner, 'test']);
  await query('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)', [other, other, 'test']);
  await query("INSERT INTO day_settings(user_id,date,target_minutes,note,kind) VALUES(?,? ,0,'Folga compensatória','compensatory-off')", [owner, '2026-10-06']);
  assert.equal(await deleteCompensatoryDayOff(other, '2026-10-06'), false);
  assert.equal(await deleteCompensatoryDayOff(owner, '2026-10-06'), true);
  assert.equal(await deleteCompensatoryDayOff(owner, '2026-10-06'), false);
});

dbTest('contas isolam senhas, sessões, configurações e batimentos', async () => {
  const { register, authenticate, createSession, getSession, deleteSession } = await import('../src/auth.js');
  const { completeOnboarding, importMarks, onboardingComplete, saveSetting } = await import('../src/db.js');
  const alice = await register('alice.test', 'uma senha suficientemente forte 1', 'alice@example.com');
  const bob = await register('bob.test', 'outra senha suficientemente forte 2', 'bob@example.com');
  assert.equal((await authenticate('ALICE.TEST', 'uma senha suficientemente forte 1')).id, alice.id);
  assert.equal(await authenticate('alice.test', 'senha errada longa o bastante'), null);
  await assert.rejects(register('Alice.Test', 'mais uma senha bem forte 3', 'carol@example.com'), { status: 409, message: /usuário/ });
  await assert.rejects(register('carol.test', 'mais uma senha bem forte 3', 'ALICE@example.com'), { status: 409, message: /email/ });
  const session = await createSession(alice.id);
  assert.equal((await getSession(session.token)).username, 'alice.test');
  await deleteSession(session.token);
  assert.equal(await getSession(session.token), null);
  await saveSetting(alice.id, 'planned_start', 510);
  assert.equal(await saveSetting(bob.id, 'planned_start', 480), undefined);
  assert.equal(await (await import('../src/db.js')).setting(alice.id, 'planned_start', ''), '510');
  assert.equal(await (await import('../src/db.js')).setting(bob.id, 'planned_start', ''), '480');
  await completeOnboarding(alice.id);
  assert.equal(await onboardingComplete(alice.id), true);
  assert.equal(await onboardingComplete(bob.id), false);
  const mark = [{ _id: 'same-acuttis-mark', mark_datetime: '2026-10-02 08:00:00' }];
  await importMarks(mark, alice.id);
  const { dashboard } = await import('../src/dashboard.js');
  assert.equal((await dashboard('2026-10', '2026-10-02', alice.id)).summary.markCount, 1);
  assert.equal((await dashboard('2026-10', '2026-10-02', bob.id)).summary.markCount, 0);
});

dbTest('jornadas compartilhadas calculam média com sábado alternado e aplicam o ciclo por data', async () => {
  const { createSchedule, assignSchedule, scheduleTarget, scheduleList } = await import('../src/work-schedules.js');
  const userId = 'telecom-schedule-user';
  const { query } = await import('../src/db.js');
  await query('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)', [userId, userId, 'test']);
  const days = [1,2,3,4,5].map(weekday => ({ weekday, startTime:'08:00', endTime:'17:30', breakMinutes:60, frequency:'weekly' }));
  days.push({ weekday:6, startTime:'08:00', endTime:'14:00', breakMinutes:30, frequency:'biweekly', anchorDate:'2026-10-03' });
  const schedule = await createSchedule(userId, { name:'Equipe Telecom de teste', days });
  await assignSchedule(userId, schedule.id);
  assert.equal(scheduleTarget(schedule, '2026-10-03'), 330);
  assert.equal(scheduleTarget(schedule, '2026-10-10'), 0);
  assert.equal(scheduleTarget(schedule, '2026-10-17'), 330);
  const catalog = await scheduleList(userId);
  const shared = catalog.schedules.find(item => item.id === schedule.id);
  assert.equal(shared.weeklyAverageMinutes, 2715); // 45h15 por semana
  assert.equal(shared.monthlyAverageMinutes, 11765);
  const { dashboard } = await import('../src/dashboard.js');
  assert.equal((await dashboard('2026-10', '2026-10-01', userId)).summary.monthTarget, 12210 - 510);
  await query('INSERT INTO marks(user_id,id,mark_datetime) VALUES(?,?,?)', [userId, 'lunch-in', '2026-10-03 08:00:00']);
  await query('INSERT INTO marks(user_id,id,mark_datetime) VALUES(?,?,?)', [userId, 'lunch-out', '2026-10-03 12:00:00']);
  const lunch = (await dashboard('2026-09', '2026-10-03', userId)).lunch;
  assert.deepEqual(lunch.marks, ['08:00', '12:00']);
  assert.equal(lunch.breakMinutes, 30);
  const other = 'other-schedule-user';
  await query('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)', [other, other, 'test']);
  await assignSchedule(other, schedule.id);
  assert.equal((await scheduleList(other)).selectedId, schedule.id);
});
