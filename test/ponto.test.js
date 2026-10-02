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
  const { dashboard } = await import('../src/dashboard.js');
  const sample = JSON.parse(readFileSync(resolve('test/sample.json'), 'utf8'));
  assert.equal(importMarks(sample).added, 5);
  assert.equal(importMarks(sample).added, 0);
  const result = dashboard('2026-10', '2026-10-02');
  assert.equal(result.projections.friday.exit, '16:19');
  assert.equal(result.projections.monthEnd.exit, '17:00');
});

test('plantão com folga na sexta tem 8h e a tabela inclui o plantão futuro', async () => {
  const { db } = await import('../src/db.js');
  const { dashboard } = await import('../src/dashboard.js');
  db.prepare('INSERT INTO shift_provisions(duty_date,day_off_date,duty_target_minutes) VALUES(?,?,?)').run('2026-10-03', '2026-10-09', 480);
  const result = dashboard('2026-10', '2026-10-02');
  assert.equal(result.days.find(day => day.date === '2026-10-03').target, 480);
  assert.equal(result.days.find(day => day.date === '2026-10-03').shiftKind, 'duty');
  assert.equal(result.days.some(day => day.date === '2026-10-05'), false);
  assert.equal(result.days.some(day => day.date === '2026-10-09'), false);
  assert.equal(result.shifts[0].day_off_date, '2026-10-09');
  assert.equal(result.summary.monthTarget, 193 * 60);
  const beforeFolga = dashboard('2026-10', '2026-10-08');
  assert.equal(beforeFolga.projections.friday.dayOff, true);
  assert.equal(beforeFolga.projections.friday.exit, null);
});
