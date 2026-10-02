export const MINUTES_DAY = 1440;

export function minutes(time) {
  if (!/^\d\d:\d\d$/.test(time || "")) throw new Error("Horário inválido.");
  const [h, m] = time.split(":").map(Number);
  if (h > 23 || m > 59) throw new Error("Horário inválido.");
  return h * 60 + m;
}

export function clock(value) {
  const v = ((value % MINUTES_DAY) + MINUTES_DAY) % MINUTES_DAY;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

export function duration(value) {
  const sign = value < 0 ? "−" : "";
  const v = Math.abs(value);
  return `${sign}${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

export function localDate(offset = 0) {
  const now = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function dateParts(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date, n) {
  const dt = dateParts(date);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function weekday(date) {
  return dateParts(date).getUTCDay();
}

export function defaultTarget(date) {
  const day = weekday(date);
  return day === 5 ? 480 : day === 0 || day === 6 ? 0 : 540;
}

export function shiftTargetForDayOff(date) {
  return weekday(date) === 5 ? 480 : 540;
}

export function weekStart(date) {
  const day = weekday(date);
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export function friday(date) {
  return addDays(weekStart(date), 4);
}

export function lastWorkday(date, targetFor = defaultTarget) {
  let day = `${date.slice(0, 7)}-${String(new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  while (targetFor(day) === 0 && day.slice(0, 7) === date.slice(0, 7))
    day = addDays(day, -1);
  return day;
}

export function datesBetween(start, end) {
  const dates = [];
  for (let day = start; day <= end; day = addDays(day, 1)) dates.push(day);
  return dates;
}

export function dayStats(date, marks, target, tolerance = 10) {
  const times = marks
    .map((m) => minutes(m.mark_datetime.slice(11, 16)))
    .sort((a, b) => a - b);
  let worked = 0;
  for (let i = 0; i + 1 < times.length; i += 2)
    worked += times[i + 1] - times[i];
  const open = times.length % 2 === 1;
  const rawBalance = worked - target;
  const balance = Math.abs(rawBalance) <= tolerance ? 0 : rawBalance;
  return {
    date,
    marks: times.map(clock),
    worked,
    target,
    rawBalance,
    balance,
    open,
    lastMark: times.at(-1) ?? null,
    complete:
      !open && (times.length >= 4 || (target <= 360 && times.length >= 2)),
  };
}

export function projectedExit(
  day,
  requiredWork,
  breakMinutes = 60,
  plannedStart = 480,
) {
  const remaining = Math.max(0, requiredWork - day.worked);
  if (day.marks.length >= 4 && !day.open) return clock(day.lastMark);
  if (day.marks.length >= 3 && day.open) return clock(day.lastMark + remaining);
  if (day.marks.length === 2)
    return clock(day.lastMark + breakMinutes + remaining);
  if (day.marks.length === 1)
    return clock(day.lastMark + requiredWork + breakMinutes);
  if (day.marks.length === 0)
    return clock(plannedStart + Math.max(0, requiredWork) + breakMinutes);
  return null;
}
