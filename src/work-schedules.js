import { randomUUID } from 'node:crypto';
import { isDuplicate, one, pool, query, transaction } from './db.js';
import { addDays, dateParts, weekday } from './calc.js';

const parseTime = value => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) throw Object.assign(new Error('Horário inválido na jornada.'), { status: 400 });
  const [h, m] = value.split(':').map(Number); return h * 60 + m;
};
const dateValid = value => /^\d{4}-\d\d-\d\d$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && dateParts(value).toISOString().slice(0, 10) === value;
const dayShape = row => ({ weekday: row.weekday, startTime: `${String(Math.floor(row.start_minute / 60)).padStart(2,'0')}:${String(row.start_minute % 60).padStart(2,'0')}`, endTime: `${String(Math.floor(row.end_minute / 60)).padStart(2,'0')}:${String(row.end_minute % 60).padStart(2,'0')}`, breakMinutes: row.break_minutes, frequency: row.frequency, anchorDate: row.anchor_date });
export async function getSchedule(id, conn = pool) {
  const schedule = await one('SELECT id,name,is_builtin,created_by FROM work_schedules WHERE id=?', [id], conn);
  return schedule ? { ...schedule, days: (await query('SELECT * FROM work_schedule_days WHERE schedule_id=? ORDER BY weekday', [id], conn)).map(dayShape) } : null;
}
export async function getUserSchedule(userId) {
  const assigned = (await one('SELECT schedule_id FROM user_work_schedules WHERE user_id=?', [userId]))?.schedule_id || 'equipe-dev';
  return getSchedule(assigned);
}
export function scheduleTarget(schedule, date) {
  if (!schedule) return null;
  const day = schedule.days.find(item => item.weekday === weekday(date));
  if (!day) return 0;
  if (day.frequency === 'biweekly') {
    const delta = Math.round((dateParts(date) - dateParts(day.anchorDate)) / 86400000);
    if (delta % 14 !== 0) return 0;
  }
  return parseTime(day.endTime) - parseTime(day.startTime) - day.breakMinutes;
}
export async function scheduleList(userId) {
  const selectedId = (await one('SELECT schedule_id FROM user_work_schedules WHERE user_id=?', [userId]))?.schedule_id || 'equipe-dev';
  const daysBySchedule = new Map();
  for (const row of await query('SELECT * FROM work_schedule_days ORDER BY schedule_id,weekday')) {
    if (!daysBySchedule.has(row.schedule_id)) daysBySchedule.set(row.schedule_id, []);
    daysBySchedule.get(row.schedule_id).push(dayShape(row));
  }
  const schedules = (await query('SELECT id,name,is_builtin,created_by FROM work_schedules ORDER BY is_builtin DESC,name')).map(row => {
    const days = daysBySchedule.get(row.id) || [];
    const weeklyAverageMinutes = days.reduce((sum, day) => sum + (parseTime(day.endTime) - parseTime(day.startTime) - day.breakMinutes) / (day.frequency === 'biweekly' ? 2 : 1), 0);
    return { ...row, days, weeklyAverageMinutes, monthlyAverageMinutes: Math.round(weeklyAverageMinutes * 52 / 12) };
  });
  return { selectedId, schedules };
}
export async function assignSchedule(userId, scheduleId, conn = pool) {
  if (typeof scheduleId !== 'string' || !(await one('SELECT id FROM work_schedules WHERE id=?', [scheduleId], conn))) throw Object.assign(new Error('Jornada não encontrada.'), { status: 404 });
  await query('INSERT INTO user_work_schedules(user_id,schedule_id) VALUES(?,?) ON DUPLICATE KEY UPDATE schedule_id=VALUES(schedule_id),assigned_at=CURRENT_TIMESTAMP', [userId, scheduleId], conn);
}
export async function createSchedule(userId, input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 2 || name.length > 60 || !Array.isArray(input.days) || input.days.length < 1 || input.days.length > 7) throw Object.assign(new Error('Informe um nome e ao menos um dia para a jornada.'), { status: 400 });
  const seen = new Set();
  const days = input.days.map(day => {
    const weekday = Number(day.weekday), start = parseTime(day.startTime), end = parseTime(day.endTime), pause = Number(day.breakMinutes), frequency = day.frequency === 'biweekly' ? 'biweekly' : 'weekly';
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday) || end <= start || !Number.isInteger(pause) || pause < 0 || pause >= end-start || (frequency === 'biweekly' && (!dateValid(day.anchorDate) || dateParts(day.anchorDate).getUTCDay() !== weekday))) throw Object.assign(new Error('Revise os dias, horários, intervalos e a primeira data do sábado alternado.'), { status: 400 });
    seen.add(weekday); return { weekday, start, end, pause, frequency, anchor: frequency === 'biweekly' ? day.anchorDate : null };
  });
  const id = randomUUID();
  try {
    return await transaction(async conn => {
      await query('INSERT INTO work_schedules(id,name,created_by) VALUES(?,?,?)', [id, name, userId], conn);
      await query('INSERT INTO work_schedule_days(schedule_id,weekday,start_minute,end_minute,break_minutes,frequency,anchor_date) VALUES ?', [days.map(day => [id, day.weekday, day.start, day.end, day.pause, day.frequency, day.anchor])], conn);
      return getSchedule(id, conn);
    });
  } catch (error) {
    if (isDuplicate(error)) throw Object.assign(new Error('Já existe uma jornada com esse nome.'), { status: 409 });
    throw error;
  }
}
