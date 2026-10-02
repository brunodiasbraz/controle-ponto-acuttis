import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { db, importMarks, saveSetting } from './db.js';
import { dashboard } from './dashboard.js';
import { localDate, minutes, shiftTargetForDayOff, weekday } from './calc.js';
import { openBrowser, syncMarks, syncStatus } from './acuttis.js';

const port = Number(process.env.PORT || 3000);
const publicRoot = resolve('public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 2_000_000) throw Object.assign(new Error('Arquivo muito grande.'), { status: 413 });
  }
  try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}
const validDate = value => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value || '') && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}` && req.headers.origin !== `http://localhost:${port}`) return json(res, 403, { error: 'Origem não permitida.' });
      if (req.method === 'GET' && url.pathname === '/api/dashboard') {
        const today = localDate();
        return json(res, 200, { ...dashboard(url.searchParams.get('month') || today.slice(0, 7), today), sync: syncStatus() });
      }
      if (req.method === 'POST' && url.pathname === '/api/acuttis/open') return json(res, 200, await openBrowser());
      if (req.method === 'POST' && url.pathname === '/api/acuttis/sync') return json(res, 200, await syncMarks(localDate().slice(0, 7) + '-01'));
      if (req.method === 'POST' && url.pathname === '/api/import') return json(res, 200, importMarks(await body(req)));
      if (req.method === 'POST' && url.pathname === '/api/shifts') {
        const input = await body(req);
        if (!validDate(input.dutyDate) || !validDate(input.dayOffDate) || input.dayOffDate === input.dutyDate || ![1, 2, 3, 4, 5].includes(weekday(input.dayOffDate))) throw Object.assign(new Error('Informe datas diferentes para o plantão e a folga, que deve cair de segunda a sexta.'), { status: 400 });
        const conflict = db.prepare('SELECT id FROM shift_provisions WHERE duty_date IN (?,?) OR day_off_date IN (?,?)').get(input.dutyDate, input.dayOffDate, input.dutyDate, input.dayOffDate);
        if (conflict) throw Object.assign(new Error('Uma dessas datas já pertence a outro plantão.'), { status: 409 });
        const targetMinutes = shiftTargetForDayOff(input.dayOffDate);
        const result = db.prepare('INSERT INTO shift_provisions(duty_date,day_off_date,duty_target_minutes) VALUES(?,?,?)').run(input.dutyDate, input.dayOffDate, targetMinutes);
        return json(res, 201, { id: Number(result.lastInsertRowid), targetMinutes });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/shifts/')) {
        const id = Number(url.pathname.slice('/api/shifts/'.length));
        if (!Number.isSafeInteger(id) || id < 1) return json(res, 400, { error: 'Plantão inválido.' });
        const result = db.prepare('DELETE FROM shift_provisions WHERE id = ?').run(id);
        return json(res, result.changes ? 200 : 404, { ok: !!result.changes });
      }
      if (req.method === 'PUT' && url.pathname === '/api/day') {
        const input = await body(req);
        if (!validDate(input.date) || !Number.isInteger(input.targetMinutes) || input.targetMinutes < 0 || input.targetMinutes > 1440 || String(input.note || '').length > 200) throw Object.assign(new Error('Dados do dia inválidos.'), { status: 400 });
        db.prepare('INSERT INTO day_settings(date,target_minutes,note) VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET target_minutes=excluded.target_minutes,note=excluded.note').run(input.date, input.targetMinutes, input.note || '');
        return json(res, 200, { ok: true });
      }
      if (req.method === 'PUT' && url.pathname === '/api/settings') {
        const input = await body(req);
        if (!Number.isInteger(input.breakMinutes) || input.breakMinutes < 0 || input.breakMinutes > 180 || !Number.isInteger(input.plannedStart) || input.plannedStart < 0 || input.plannedStart >= 1440 || !Number.isInteger(input.toleranceMinutes) || input.toleranceMinutes < 0 || input.toleranceMinutes > 30) throw Object.assign(new Error('Configurações inválidas.'), { status: 400 });
        saveSetting('break_minutes', input.breakMinutes);
        saveSetting('planned_start', input.plannedStart);
        saveSetting('tolerance_minutes', input.toleranceMinutes);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/mark') {
        const input = await body(req);
        if (!validDate(input.date)) throw Object.assign(new Error('Data inválida.'), { status: 400 });
        const at = minutes(input.time);
        const markDatetime = `${input.date} ${input.time}:00`;
        db.prepare('INSERT INTO marks(id,mark_datetime,origin) VALUES(?,?,?)').run(`manual:${crypto.randomUUID()}`, markDatetime, 'manual');
        return json(res, 200, { ok: true, at });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/mark/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/mark/'.length));
        const result = db.prepare("DELETE FROM marks WHERE id = ? AND origin = 'manual'").run(id);
        return json(res, result.changes ? 200 : 404, { ok: !!result.changes });
      }
      return json(res, 404, { error: 'Rota não encontrada.' });
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });
    const file = resolve(publicRoot, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
    if (!file.startsWith(publicRoot + sep) && file !== publicRoot) return json(res, 403, { error: 'Acesso negado.' });
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch (error) {
    json(res, error.code === 'ENOENT' ? 404 : error.status || 500, { error: error.message });
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Controle de Ponto em http://127.0.0.1:${port}`));
