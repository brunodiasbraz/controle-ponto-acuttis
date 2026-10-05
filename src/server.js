import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { completeOnboarding, db, importMarks, onboardingComplete, saveSetting, setting } from './db.js';
import { dashboard } from './dashboard.js';
import { localDate, minutes, shiftTargetForDayOff, weekday } from './calc.js';
import { authenticate, createSession, deleteSession, getSession, register, sessionMaxAge } from './auth.js';
import { assignSchedule, createSchedule, getSchedule, scheduleList } from './work-schedules.js';

const port = Number(process.env.PORT || 3000);
const publicRoot = resolve('public');
const appOrigin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : '';
if (process.env.NODE_ENV === 'production' && !appOrigin)
  throw new Error('Defina APP_ORIGIN com a URL HTTPS pública da aplicação em produção.');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const cookieSecure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
const cookieName = cookieSecure ? '__Host-ponto_session' : 'ponto_session';
const loginAttempts = new Map();
function requestCookie(req, name) {
  const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionMaxAge / 1000)}${cookieSecure ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cookieSecure ? '; Secure' : ''}`);
}
function enforceOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) throw Object.assign(new Error('Requisição sem origem válida.'), { status: 403 });
  try {
    const parsedOrigin = new URL(origin);
    if (appOrigin ? parsedOrigin.origin !== appOrigin : parsedOrigin.host !== req.headers.host) throw new Error();
  } catch {
    throw Object.assign(new Error('Origem não permitida.'), { status: 403 });
  }
}
function rateLimitKey(req) { return req.socket.remoteAddress || 'unknown'; }
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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') enforceOrigin(req);
      if (req.method === 'GET' && url.pathname === '/api/auth/status') {
        const user = getSession(requestCookie(req, cookieName));
        return json(res, 200, { authenticated: !!user, user: user ? { username: user.username } : null });
      }
      if (req.method === 'POST' && ['/api/auth/login', '/api/auth/register'].includes(url.pathname)) {
        const key = rateLimitKey(req);
        const attempt = loginAttempts.get(key) || { count: 0, until: 0 };
        if (attempt.until > Date.now()) throw Object.assign(new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.'), { status: 429 });
        const input = await body(req);
        try {
          const user = url.pathname.endsWith('/register')
            ? await register(input.username, input.password)
            : await authenticate(input.username, input.password);
          if (!user) throw Object.assign(new Error('Usuário ou senha incorretos.'), { status: 401 });
          loginAttempts.delete(key);
          const session = createSession(user.id);
          setSessionCookie(res, session.token);
          return json(res, url.pathname.endsWith('/register') ? 201 : 200, { authenticated: true, user: { username: user.username } });
        } catch (error) {
          if (![400, 409].includes(error.status)) {
            attempt.count++;
            if (attempt.count >= 5) { attempt.count = 0; attempt.until = Date.now() + 15 * 60 * 1000; }
            loginAttempts.set(key, attempt);
          }
          throw error;
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        deleteSession(requestCookie(req, cookieName));
        clearSessionCookie(res);
        return json(res, 200, { authenticated: false });
      }
      const user = getSession(requestCookie(req, cookieName));
      if (!user) return json(res, 401, { error: 'Faça login para continuar.', unauthenticated: true });
      const userId = user.id;
      if (req.method === 'GET' && url.pathname === '/api/work-schedules') return json(res, 200, scheduleList(userId));
      if (req.method === 'POST' && url.pathname === '/api/work-schedules') return json(res, 201, createSchedule(userId, await body(req)));
      if (req.method === 'PUT' && url.pathname === '/api/work-schedules/assign') {
        const input = await body(req); assignSchedule(userId, input.scheduleId);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/dashboard') {
        const today = localDate();
        return json(res, 200, { ...dashboard(url.searchParams.get('month') || today.slice(0, 7), today, userId), sync: { lastSync: setting(userId, 'last_sync', '') || null, lastError: null, connecting: false } });
      }
      if (req.method === 'GET' && url.pathname === '/api/onboarding') return json(res, 200, { complete: onboardingComplete(userId) });
      if (req.method === 'POST' && url.pathname === '/api/onboarding/complete') {
        if (!setting(userId, 'tolerance_minutes', '')) {
          throw Object.assign(new Error('Configure sua jornada antes de começar.'), { status: 409 });
        }
        completeOnboarding(userId);
        return json(res, 200, { complete: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/import') {
        const input = await body(req);
        const result = importMarks(input, userId);
        const syncedAt = input?.source === 'acuttis-extension' ? new Date().toISOString() : null;
        if (syncedAt) saveSetting(userId, 'last_sync', syncedAt);
        return json(res, 200, { ...result, syncedAt });
      }
      if (req.method === 'POST' && url.pathname === '/api/shifts') {
        const input = await body(req);
        if (!validDate(input.dutyDate) || !validDate(input.dayOffDate) || input.dayOffDate === input.dutyDate || ![1, 2, 3, 4, 5].includes(weekday(input.dayOffDate))) throw Object.assign(new Error('Informe datas diferentes para o plantão e a folga, que deve cair de segunda a sexta.'), { status: 400 });
        const conflict = db.prepare('SELECT id FROM shift_provisions WHERE user_id = ? AND (duty_date IN (?,?) OR day_off_date IN (?,?))').get(userId, input.dutyDate, input.dayOffDate, input.dutyDate, input.dayOffDate);
        if (conflict) throw Object.assign(new Error('Uma dessas datas já pertence a outro plantão.'), { status: 409 });
        const targetMinutes = shiftTargetForDayOff(input.dayOffDate);
        const result = db.prepare('INSERT INTO shift_provisions(user_id,duty_date,day_off_date,duty_target_minutes) VALUES(?,?,?,?)').run(userId, input.dutyDate, input.dayOffDate, targetMinutes);
        return json(res, 201, { id: Number(result.lastInsertRowid), targetMinutes });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/shifts/')) {
        const id = Number(url.pathname.slice('/api/shifts/'.length));
        if (!Number.isSafeInteger(id) || id < 1) return json(res, 400, { error: 'Plantão inválido.' });
        const result = db.prepare('DELETE FROM shift_provisions WHERE id = ? AND user_id = ?').run(id, userId);
        return json(res, result.changes ? 200 : 404, { ok: !!result.changes });
      }
      if (req.method === 'PUT' && url.pathname === '/api/day') {
        const input = await body(req);
        if (!validDate(input.date) || !Number.isInteger(input.targetMinutes) || input.targetMinutes < 0 || input.targetMinutes > 1440 || String(input.note || '').length > 200) throw Object.assign(new Error('Dados do dia inválidos.'), { status: 400 });
        db.prepare('INSERT INTO day_settings(user_id,date,target_minutes,note) VALUES(?,?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET target_minutes=excluded.target_minutes,note=excluded.note').run(userId, input.date, input.targetMinutes, input.note || '');
        return json(res, 200, { ok: true });
      }
      if (req.method === 'PUT' && url.pathname === '/api/settings') {
        const input = await body(req);
        if (!Number.isInteger(input.toleranceMinutes) || input.toleranceMinutes < 0 || input.toleranceMinutes > 30 || (input.scheduleId !== undefined && !getSchedule(input.scheduleId))) throw Object.assign(new Error('Configurações inválidas.'), { status: 400 });
        db.exec('BEGIN IMMEDIATE');
        try {
          if (input.scheduleId !== undefined) assignSchedule(userId, input.scheduleId);
          saveSetting(userId, 'tolerance_minutes', input.toleranceMinutes);
          db.exec('COMMIT');
        } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
        return json(res, 200, { ok: true, scheduleId: input.scheduleId ?? null, toleranceMinutes: input.toleranceMinutes });
      }
      if (req.method === 'POST' && url.pathname === '/api/mark') {
        const input = await body(req);
        if (!validDate(input.date)) throw Object.assign(new Error('Data inválida.'), { status: 400 });
        const at = minutes(input.time);
        const markDatetime = `${input.date} ${input.time}:00`;
        db.prepare('INSERT INTO marks(user_id,id,mark_datetime,origin) VALUES(?,?,?,?)').run(userId, `manual:${crypto.randomUUID()}`, markDatetime, 'manual');
        return json(res, 200, { ok: true, at });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/mark/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/mark/'.length));
        const result = db.prepare("DELETE FROM marks WHERE user_id = ? AND id = ? AND origin = 'manual'").run(userId, id);
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
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Controle de Ponto disponível na porta ${port}`));
