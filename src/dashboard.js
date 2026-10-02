import { db, setting } from "./db.js";
import {
  addDays,
  datesBetween,
  dayStats,
  defaultTarget,
  friday,
  lastWorkday,
  projectedExit,
  projectedExitLimit,
  weekStart,
  weekday,
} from "./calc.js";

export function dashboard(month, today) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mês inválido.");
  const start = `${month}-01`;
  const end = addDays(
    `${Number(month.slice(0, 4))}-${month.slice(5)}-01`,
    new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
    ).getUTCDate() - 1,
  );

  const tolerance = Number(setting("tolerance_minutes", "10"));

  const overrides = new Map(
    db
      .prepare("SELECT * FROM day_settings WHERE date BETWEEN ? AND ?")
      .all(start, end)
      .map((row) => [row.date, row]),
  );

  const shifts = db
    .prepare(
      "SELECT id, duty_date, day_off_date, duty_target_minutes FROM shift_provisions WHERE (duty_date BETWEEN ? AND ?) OR (day_off_date BETWEEN ? AND ?) ORDER BY duty_date",
    )
    .all(start, end, start, end);

  const shiftDays = new Map();

  for (const shift of shifts) {
    shiftDays.set(shift.duty_date, {
      target: shift.duty_target_minutes,
      kind: "duty",
      shiftId: shift.id,
      note: `Plantão · folga ${shift.day_off_date.slice(8, 10)}/${shift.day_off_date.slice(5, 7)}`,
    });
    shiftDays.set(shift.day_off_date, {
      target: 0,
      kind: "day-off",
      shiftId: shift.id,
      note: `Folga do plantão ${shift.duty_date.slice(8, 10)}/${shift.duty_date.slice(5, 7)}`,
    });
  }

  const allMarks = db
    .prepare(
      "SELECT id, mark_datetime, origin FROM marks WHERE mark_datetime >= ? AND mark_datetime < ? ORDER BY mark_datetime",
    )
    .all(`${start} 00:00:00`, `${addDays(end, 1)} 00:00:00`);

  const byDay = new Map();

  for (const mark of allMarks) {
    const date = mark.mark_datetime.slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(mark);
  }

  const days = datesBetween(start, end).map((date) => ({
    ...dayStats(
      date,
      byDay.get(date) || [],
      shiftDays.get(date)?.target ??
        overrides.get(date)?.target_minutes ??
        defaultTarget(date),
      tolerance,
    ),
    note: shiftDays.get(date)?.note || overrides.get(date)?.note || "",
    shiftKind: shiftDays.get(date)?.kind || null,
    shiftId: shiftDays.get(date)?.shiftId || null,
    ids: (byDay.get(date) || []).map((mark) => mark.id),
  }));

  const map = new Map(days.map((day) => [day.date, day]));

  const targetFor = (date) => map.get(date)?.target ?? defaultTarget(date);

  const monthClose = lastWorkday(today, targetFor);

  const thisFriday = friday(today);

  const monthToDate = days.filter((day) => day.date <= today);

  const weekToDate = days.filter(
    (day) => day.date >= weekStart(today) && day.date <= today,
  );

  const monthClosed = monthToDate.filter(
    (day) => day.date < today || day.complete,
  );

  const weekClosed = weekToDate.filter(
    (day) => day.date < today || day.complete,
  );

  const sum = (list, key) => list.reduce((total, day) => total + day[key], 0);

  const gap = days
    .filter((day) => day.date < today && day.target > 0 && !day.complete)
    .map((day) => day.date);

  const breakMinutes = Number(setting("break_minutes", "60"));

  const plannedStart = Number(setting("planned_start", "480"));

  function todayExitProjection() {
    if (today.slice(0, 7) !== month) return null;
    const day = map.get(today);
    if (!day || day.target <= 0)
      return { date: today, dayOff: true, target: 0, worked: day?.worked || 0 };
    const dayOfWeek = weekday(today);
    const maxExtraMinutes = dayOfWeek >= 1 && dayOfWeek <= 4 ? 60 : dayOfWeek === 5 ? 120 : 0;
    const exit = day.complete && !day.open ? day.lastMark : projectedExit(day, day.target, breakMinutes, plannedStart);
    const latestExit = projectedExitLimit(day, maxExtraMinutes, breakMinutes, plannedStart);
    return {
      date: today,
      target: day.target,
      worked: day.worked,
      complete: day.complete && !day.open,
      dayOff: false,
      exit,
      latestExit,
      maxExtraMinutes,
    };
  }

  function projection(closeDate, periodStart, settleFridays = false) {
    if (closeDate < today || closeDate.slice(0, 7) !== month) return null;
    const prior = days.filter(
      (day) => day.date >= periodStart && day.date < closeDate,
    );
    const completed = prior.filter((day) => day.date < today);
    const missing = completed
      .filter((day) => day.target > 0 && !day.complete)
      .map((day) => day.date);
    const forecast = prior.filter(
      (day) => day.date >= today && !day.complete && day.target > 0,
    );
    const assumedWork = new Map(
      days
        .filter(
          (day) => day.date < today || (day.date === today && day.complete),
        )
        .map((day) => [day.date, day.worked]),
    );
    for (const day of prior.filter(
      (day) => day.date >= today && !day.complete,
    )) {
      let worked = day.target;
      if (settleFridays && day.date === friday(day.date) && day.target > 0) {
        const previousWeek = datesBetween(
          weekStart(day.date),
          addDays(day.date, -1),
        );
        const weekBalance = previousWeek.reduce((total, date) => {
          const known = map.get(date);
          if (known && (date < today || (date === today && known.complete)))
            return total + known.balance;
          const raw =
            (assumedWork.get(date) ?? targetFor(date)) - targetFor(date);
          return total + (Math.abs(raw) <= tolerance ? 0 : raw);
        }, 0);
        worked = Math.max(0, day.target - weekBalance);
      }
      assumedWork.set(day.date, worked);
    }
    const balanceBefore = prior.reduce((total, day) => {
      if (day.date < today || (day.date === today && day.complete))
        return total + day.balance;
      const raw = (assumedWork.get(day.date) ?? 0) - day.target;
      return total + (Math.abs(raw) <= tolerance ? 0 : raw);
    }, 0);
    const requiredWork = Math.max(0, targetFor(closeDate) - balanceBefore);
    const closeDay = map.get(closeDate);
    const dayOff = closeDay.target === 0;
    const exit =
      dayOff || missing.length
        ? null
        : projectedExit(closeDay, requiredWork, breakMinutes, plannedStart);
    return {
      date: closeDate,
      requiredWork: dayOff ? 0 : requiredWork,
      exit,
      dayOff,
      missing,
      assumedDates: forecast.map((day) => day.date),
      target: closeDay.target,
      balanceBefore,
    };
  }

  return {
    month,
    today,
    days: days.filter(
      (day) =>
        day.marks.length > 0 ||
        (day.date === today && day.target > 0) ||
        (day.shiftKind === "duty" && day.date >= today),
    ),
    shifts,
    settings: { breakMinutes, plannedStart, tolerance },
    summary: {
      worked: sum(monthToDate, "worked"),
      expected: sum(monthClosed, "target"),
      balance: sum(monthClosed, "balance"),
      weekWorked: sum(weekToDate, "worked"),
      weekExpected: sum(weekClosed, "target"),
      weekBalance: sum(weekClosed, "balance"),
      missingDates: gap,
      markCount: allMarks.length,
      monthTarget: sum(days, "target"),
    },
    projections: {
      today: todayExitProjection(),
      friday: projection(thisFriday, weekStart(today)),
      monthEnd: projection(monthClose, start, true),
    },
  };
}
