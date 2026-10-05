import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dayStats, defaultTarget, projectedExit, shiftTargetForDayOff } from '../src/calc.js';

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

test('importação idempotente e previsão mensal considera a compensação de sexta', async () => {
  process.env.DB_PATH = resolve(mkdtempSync('/tmp/ponto-test-'), 'ponto.sqlite');
  const { importMarks } = await import('../src/db.js');
  const { db } = await import('../src/db.js');
  const { dashboard } = await import('../src/dashboard.js');
  const userId = 'test-shift-user';
  db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(userId, 'test-shift-user', 'test');
  const sample = JSON.parse(readFileSync(resolve('test/sample.json'), 'utf8'));
  assert.equal(importMarks(sample, userId).added, 5);
  assert.equal(importMarks(sample, userId).added, 0);
  const result = dashboard('2026-10', '2026-10-02', userId);
  assert.equal(result.projections.friday.exit, '16:19');
  assert.equal(result.projections.monthEnd.exit, '17:00');
});

test('plantão com folga na sexta tem 8h e a tabela inclui o plantão futuro', async () => {
  const { db } = await import('../src/db.js');
  const { dashboard } = await import('../src/dashboard.js');
  const userId = 'test-user';
  db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(userId, 'test-user', 'test');
  db.prepare('INSERT INTO shift_provisions(user_id,duty_date,day_off_date,duty_target_minutes) VALUES(?,?,?,?)').run(userId, '2026-10-03', '2026-10-09', 480);
  const result = dashboard('2026-10', '2026-10-02', userId);
  assert.equal(result.days.find(day => day.date === '2026-10-03').target, 480);
  assert.equal(result.days.find(day => day.date === '2026-10-03').shiftKind, 'duty');
  assert.equal(result.days.some(day => day.date === '2026-10-05'), false);
  assert.equal(result.days.some(day => day.date === '2026-10-09'), false);
  assert.equal(result.shifts[0].day_off_date, '2026-10-09');
  assert.equal(result.summary.monthTarget, 193 * 60 - 540); // Dia 12 é feriado nacional
  const beforeFolga = dashboard('2026-10', '2026-10-08', userId);
  assert.equal(beforeFolga.projections.friday.dayOff, true);
  assert.equal(beforeFolga.projections.friday.exit, null);
});

test('feriados nacionais não geram jornada e um plantão provisionado no feriado volta a ter jornada', async () => {
  const { db } = await import('../src/db.js');
  const { dashboard } = await import('../src/dashboard.js');
  const { holidayName } = await import('../src/holidays.js');
  const { datesBetween, defaultTarget } = await import('../src/calc.js');
  const userId = 'holiday-calendar-user';
  db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(userId, userId, 'test');
  assert.equal(holidayName('2026-04-03'), 'Paixão de Cristo');
  assert.equal(holidayName('2026-06-04'), 'Corpus Christi');
  assert.equal(holidayName('2027-03-26'), 'Paixão de Cristo');
  assert.equal(holidayName('2027-05-27'), 'Corpus Christi');
  const withoutDuty = dashboard('2026-04', '2026-04-30', userId);
  const scheduledApril = datesBetween('2026-04-01', '2026-04-30').reduce((sum, date) => sum + defaultTarget(date), 0);
  const aprilHolidayTarget = datesBetween('2026-04-01', '2026-04-30')
    .filter(date => holidayName(date))
    .reduce((sum, date) => sum + defaultTarget(date), 0);
  assert.equal(withoutDuty.summary.monthTarget, scheduledApril - aprilHolidayTarget);
  db.prepare('INSERT INTO shift_provisions(user_id,duty_date,day_off_date,duty_target_minutes) VALUES(?,?,?,?)').run(userId, '2026-04-03', '2026-04-06', 540);
  const withDuty = dashboard('2026-04', '2026-04-01', userId);
  const duty = withDuty.days.find(day => day.date === '2026-04-03');
  assert.equal(duty.target, 540);
  assert.equal(duty.isHoliday, true);
  assert.match(duty.note, /Paixão de Cristo/);
  assert.equal(withDuty.summary.monthTarget, withoutDuty.summary.monthTarget); // A folga compensatória reduz a mesma jornada que o plantão repõe.
});

test('folga compensatória zera a jornada prevista e não cria saldo devedor', async () => {
  const { db } = await import('../src/db.js');
  const { dashboard } = await import('../src/dashboard.js');
  const userId = 'compensatory-leave-user';
  db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(userId, userId, 'test');
  db.prepare("INSERT INTO day_settings(user_id,date,target_minutes,note,kind) VALUES(?,? ,0,'Folga compensatória','compensatory-off')").run(userId, '2026-10-05');
  const result = dashboard('2026-10', '2026-10-30', userId);
  const leave = result.days.find(day => day.date === '2026-10-05');
  assert.equal(leave.target, 0);
  assert.equal(leave.isCompensatoryOff, true);
  assert.equal(leave.balance, 0);
  assert.equal(leave.note, 'Folga compensatória');
  assert.equal(result.summary.monthTarget, 193 * 60 - 540 - 540);
});

test('folga compensatória pode ser excluída apenas pela conta proprietária', async () => {
  const { db, deleteCompensatoryDayOff } = await import('../src/db.js');
  const owner = 'leave-owner';
  const other = 'leave-other';
  db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(owner, owner, 'test');
  db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(other, other, 'test');
  db.prepare("INSERT INTO day_settings(user_id,date,target_minutes,note,kind) VALUES(?,? ,0,'Folga compensatória','compensatory-off')").run(owner, '2026-10-06');
  assert.equal(deleteCompensatoryDayOff(other, '2026-10-06'), false);
  assert.equal(deleteCompensatoryDayOff(owner, '2026-10-06'), true);
  assert.equal(deleteCompensatoryDayOff(owner, '2026-10-06'), false);
});

test('contas isolam senhas, sessões, configurações e batimentos', async () => {
  const { register, authenticate, createSession, getSession, deleteSession } = await import('../src/auth.js');
  const { completeOnboarding, importMarks, onboardingComplete, saveSetting } = await import('../src/db.js');
  const alice = await register('alice.test', 'uma senha suficientemente forte 1');
  const bob = await register('bob.test', 'outra senha suficientemente forte 2');
  assert.equal((await authenticate('ALICE.TEST', 'uma senha suficientemente forte 1')).id, alice.id);
  assert.equal(await authenticate('alice.test', 'senha errada longa o bastante'), null);
  const session = createSession(alice.id);
  assert.equal(getSession(session.token).username, 'alice.test');
  deleteSession(session.token);
  assert.equal(getSession(session.token), null);
  saveSetting(alice.id, 'planned_start', 510);
  assert.equal(saveSetting(bob.id, 'planned_start', 480), undefined);
  assert.equal((await import('../src/db.js')).setting(alice.id, 'planned_start', ''), '510');
  assert.equal((await import('../src/db.js')).setting(bob.id, 'planned_start', ''), '480');
  completeOnboarding(alice.id);
  assert.equal(onboardingComplete(alice.id), true);
  assert.equal(onboardingComplete(bob.id), false);
  const mark = [{ _id: 'same-acuttis-mark', mark_datetime: '2026-10-02 08:00:00' }];
  importMarks(mark, alice.id);
  const { dashboard } = await import('../src/dashboard.js');
  assert.equal(dashboard('2026-10', '2026-10-02', alice.id).summary.markCount, 1);
  assert.equal(dashboard('2026-10', '2026-10-02', bob.id).summary.markCount, 0);
});

test('jornadas compartilhadas calculam média com sábado alternado e aplicam o ciclo por data', async () => {
  const { createSchedule, assignSchedule, scheduleTarget, scheduleList } = await import('../src/work-schedules.js');
  const userId = 'telecom-schedule-user';
  const { db } = await import('../src/db.js');
  db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(userId, userId, 'test');
  const days = [1,2,3,4,5].map(weekday => ({ weekday, startTime:'08:00', endTime:'17:30', breakMinutes:60, frequency:'weekly' }));
  days.push({ weekday:6, startTime:'08:00', endTime:'14:00', breakMinutes:30, frequency:'biweekly', anchorDate:'2026-10-03' });
  const schedule = createSchedule(userId, { name:'Equipe Telecom de teste', days });
  assignSchedule(userId, schedule.id);
  assert.equal(scheduleTarget(schedule, '2026-10-03'), 330);
  assert.equal(scheduleTarget(schedule, '2026-10-10'), 0);
  assert.equal(scheduleTarget(schedule, '2026-10-17'), 330);
  const catalog = scheduleList(userId);
  const shared = catalog.schedules.find(item => item.id === schedule.id);
  assert.equal(shared.weeklyAverageMinutes, 2715); // 45h15 por semana
  assert.equal(shared.monthlyAverageMinutes, 11765);
  const { dashboard } = await import('../src/dashboard.js');
  assert.equal(dashboard('2026-10', '2026-10-01', userId).summary.monthTarget, 12210 - 510);
  db.prepare('INSERT INTO marks(user_id,id,mark_datetime) VALUES(?,?,?)').run(userId, 'lunch-in', '2026-10-03 08:00:00');
  db.prepare('INSERT INTO marks(user_id,id,mark_datetime) VALUES(?,?,?)').run(userId, 'lunch-out', '2026-10-03 12:00:00');
  const lunch = dashboard('2026-09', '2026-10-03', userId).lunch;
  assert.deepEqual(lunch.marks, ['08:00', '12:00']);
  assert.equal(lunch.breakMinutes, 30);
  const other = 'other-schedule-user';
  db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(other, other, 'test');
  assignSchedule(other, schedule.id);
  assert.equal(scheduleList(other).selectedId, schedule.id);
});
