import { addDays } from './calc.js';

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function holidaysForYear(year) {
  const easter = easterSunday(year);
  return new Map([
    [`${year}-01-01`, 'Confraternização Universal'],
    [addDays(easter, -2), 'Paixão de Cristo'],
    [`${year}-04-21`, 'Tiradentes'],
    [`${year}-05-01`, 'Dia Mundial do Trabalho'],
    [addDays(easter, 60), 'Corpus Christi'],
    [`${year}-09-07`, 'Independência do Brasil'],
    [`${year}-10-12`, 'Nossa Senhora Aparecida'],
    [`${year}-11-02`, 'Finados'],
    [`${year}-11-15`, 'Proclamação da República'],
    [`${year}-11-20`, 'Dia Nacional de Zumbi e da Consciência Negra'],
    [`${year}-12-25`, 'Natal'],
  ]);
}

export function holidayName(date) {
  const year = Number(date?.slice(0, 4));
  if (!Number.isInteger(year) || year < 1 || year > 9998) return null;
  return holidaysForYear(year).get(date) || null;
}
