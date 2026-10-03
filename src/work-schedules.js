import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { addDays, dateParts, weekday } from './calc.js';

const parseTime = value => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) throw Object.assign(new Error('Horário inválido na jornada.'), { status: 400 });
  const [h, m] = value.split(':').map(Number); return h * 60 + m;
};
const dateValid = value => /^\d{4}-\d\d-\d\d$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && dateParts(value).toISOString().slice(0, 10) === value;
const dayShape = row => ({ weekday: row.weekday, startTime: `${String(Math.floor(row.start_minute / 60)).padStart(2,'0')}:${String(row.start_minute % 60).padStart(2,'0')}`, endTime: `${String(Math.floor(row.end_minute / 60)).padStart(2,'0')}:${String(row.end_minute % 60).padStart(2,'0')}`, breakMinutes: row.break_minutes, frequency: row.frequency, anchorDate: row.anchor_date });
export function getSchedule(id) {
  const schedule = db.prepare('SELECT id,name,is_builtin,created_by FROM work_schedules WHERE id=?').get(id);
  return schedule ? { ...schedule, days: db.prepare('SELECT * FROM work_schedule_days WHERE schedule_id=? ORDER BY weekday').all(id).map(dayShape) } : null;
}
export function getUserSchedule(userId) {
  const assigned = db.prepare('SELECT schedule_id FROM user_work_schedules WHERE user_id=?').get(userId)?.schedule_id || 'equipe-dev';
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
export function scheduleList(userId) {
  const selectedId = db.prepare('SELECT schedule_id FROM user_work_schedules WHERE user_id=?').get(userId)?.schedule_id || 'equipe-dev';
  const schedules = db.prepare('SELECT id,name,is_builtin,created_by FROM work_schedules ORDER BY is_builtin DESC,name COLLATE NOCASE').all().map(row => {
    const schedule = getSchedule(row.id);
    const weeklyAverageMinutes = schedule.days.reduce((sum, day) => sum + (parseTime(day.endTime) - parseTime(day.startTime) - day.breakMinutes) / (day.frequency === 'biweekly' ? 2 : 1), 0);
    return { ...row, days: schedule.days, weeklyAverageMinutes, monthlyAverageMinutes: Math.round(weeklyAverageMinutes * 52 / 12) };
  });
  return { selectedId, schedules };
}
export function assignSchedule(userId, scheduleId) {
  if (!getSchedule(scheduleId)) throw Object.assign(new Error('Jornada não encontrada.'), { status: 404 });
  db.prepare('INSERT INTO user_work_schedules(user_id,schedule_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET schedule_id=excluded.schedule_id,assigned_at=CURRENT_TIMESTAMP').run(userId, scheduleId);
}
export function createSchedule(userId, input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 2 || name.length > 60 || !Array.isArray(input.days) || input.days.length < 1 || input.days.length > 7) throw Object.assign(new Error('Informe um nome e ao menos um dia para a jornada.'), { status: 400 });
  const seen = new Set();
  const days = input.days.map(day => {
    const weekday = Number(day.weekday), start = parseTime(day.startTime), end = parseTime(day.endTime), pause = Number(day.breakMinutes), frequency = day.frequency === 'biweekly' ? 'biweekly' : 'weekly';
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday) || end <= start || !Number.isInteger(pause) || pause < 0 || pause >= end-start || (frequency === 'biweekly' && (!dateValid(day.anchorDate) || dateParts(day.anchorDate).getUTCDay() !== weekday))) throw Object.assign(new Error('Revise os dias, horários, intervalos e a primeira data do sábado alternado.'), { status: 400 });
    seen.add(weekday); return { weekday, start, end, pause, frequency, anchor: frequency === 'biweekly' ? day.anchorDate : null };
  });
  const id = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO work_schedules(id,name,created_by) VALUES(?,?,?)').run(id,name,userId);
    const insert = db.prepare('INSERT INTO work_schedule_days(schedule_id,weekday,start_minute,end_minute,break_minutes,frequency,anchor_date) VALUES(?,?,?,?,?,?,?)');
    for (const day of days) insert.run(id,day.weekday,day.start,day.end,day.pause,day.frequency,day.anchor);
    assignSchedule(userId,id); db.exec('COMMIT'); return getSchedule(id);
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw Object.assign(new Error('Já existe uma jornada com esse nome.'), { status: 409 }); throw error; }
}
