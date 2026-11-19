import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { isDuplicate, one, query, transaction } from './db.js';

const scrypt = promisify(scryptCallback);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hashToken = token => createHash('sha256').update(token).digest('hex');

async function passwordHash(password, salt = randomBytes(16).toString('base64url')) {
  const derived = await scrypt(password, Buffer.from(salt, 'base64url'), 64, SCRYPT_OPTIONS);
  return `scrypt$${salt}$${Buffer.from(derived).toString('base64url')}`;
}

export async function register(usernameInput, password, emailInput) {
  const username = typeof usernameInput === 'string' ? usernameInput.trim() : '';
  if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username))
    throw Object.assign(new Error('O usuário deve ter de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.'), { status: 400 });
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 256)
    throw Object.assign(new Error('A senha deve ter entre 12 e 256 bytes.'), { status: 400 });
  const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254)
    throw Object.assign(new Error('Informe um email válido.'), { status: 400 });
  const hash = await passwordHash(password);
  const id = randomUUID();
  try {
    await transaction(async conn => {
      const firstUser = (await one('SELECT COUNT(*) AS count FROM users FOR UPDATE', [], conn)).count === 0;
      await query('INSERT INTO users(id,username,password_hash,email,role) VALUES(?,?,?,?,?)', [id, username, hash, email, firstUser ? 'superadmin' : ''], conn);
      await query("INSERT INTO user_work_schedules(user_id,schedule_id) VALUES(?,'equipe-dev')", [id], conn);
    });
    return { id, username };
  } catch (error) {
    if (isDuplicate(error))
      throw Object.assign(new Error(error.message.includes('email') ? 'Esse email já está em uso.' : 'Esse nome de usuário já está em uso.'), { status: 409 });
    throw error;
  }
}

export async function requestPasswordReset(emailInput) {
  const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254)
    throw Object.assign(new Error('Informe um email válido.'), { status: 400 });
  const user = await one('SELECT id,email FROM users WHERE email = ?', [email]);
  if (!user) return;
  const { randomInt } = await import('node:crypto');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const id = randomUUID();
  const hash = createHash('sha256').update(`${id}:${code}`).digest('hex');
  await query('UPDATE password_reset_codes SET used=1 WHERE user_id=? AND used=0', [user.id]);
  await query('INSERT INTO password_reset_codes(id,user_id,code_hash,expires_at) VALUES(?,?,?,?)', [id, user.id, hash, Date.now() + 15 * 60_000]);
  const { sendResetCode } = await import('./mail.js');
  try { await sendResetCode(email, code); }
  catch (error) { await query('UPDATE password_reset_codes SET used=1 WHERE id=?', [id]); throw error; }
}

export async function resetPassword(emailInput, code, password) {
  const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 256)
    throw Object.assign(new Error('A senha deve ter entre 12 e 256 bytes.'), { status: 400 });
  if (!/^\d{6}$/.test(code || '')) throw Object.assign(new Error('Código inválido ou expirado.'), { status: 400 });
  const row = await one('SELECT c.id,c.user_id,c.code_hash FROM password_reset_codes c JOIN users u ON u.id=c.user_id WHERE u.email=? AND c.used=0 AND c.expires_at>? ORDER BY c.created_at DESC, c.expires_at DESC LIMIT 1', [email, Date.now()]);
  if (!row || row.code_hash !== createHash('sha256').update(`${row.id}:${code}`).digest('hex'))
    throw Object.assign(new Error('Código inválido ou expirado.'), { status: 400 });
  const hash = await passwordHash(password);
  await transaction(async conn => {
    await query('UPDATE users SET password_hash=? WHERE id=?', [hash, row.user_id], conn);
    await query('UPDATE password_reset_codes SET used=1 WHERE id=?', [row.id], conn);
    await query('DELETE FROM user_sessions WHERE user_id=?', [row.user_id], conn);
  });
}

export async function authenticate(usernameInput, password) {
  const username = typeof usernameInput === 'string' ? usernameInput.trim() : '';
  if (typeof password !== 'string' || password.length > 256) return null;
  const user = await one('SELECT id,username,password_hash,role FROM users WHERE username = ?', [username]);
  if (!user) {
    await passwordHash(password, Buffer.alloc(16).toString('base64url'));
    return null;
  }
  const [scheme, salt, expectedEncoded] = user.password_hash.split('$');
  if (scheme !== 'scrypt' || !salt || !expectedEncoded) return null;
  const candidate = await scrypt(password, Buffer.from(salt, 'base64url'), 64, SCRYPT_OPTIONS);
  const expected = Buffer.from(expectedEncoded, 'base64url');
  if (expected.length !== candidate.length || !timingSafeEqual(expected, candidate)) return null;
  return { id: user.id, username: user.username, role: user.role };
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_MS;
  await query('DELETE FROM user_sessions WHERE expires_at <= ?', [Date.now()]);
  await query('INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', [hashToken(token), userId, expiresAt]);
  return { token, expiresAt };
}

export async function getSession(token) {
  if (!token || typeof token !== 'string' || token.length > 128) return null;
  const row = await one('SELECT users.id, users.username, users.role FROM user_sessions JOIN users ON users.id=user_sessions.user_id WHERE user_sessions.token_hash = ? AND user_sessions.expires_at > ?', [hashToken(token), Date.now()]);
  return row ? { id: row.id, username: row.username, role: row.role } : null;
}

export async function setUserPassword(userId, password) {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 256)
    throw Object.assign(new Error('A senha deve ter entre 12 e 256 bytes.'), { status: 400 });
  const hash = await passwordHash(password);
  await transaction(async conn => {
    await query('UPDATE users SET password_hash=? WHERE id=?', [hash, userId], conn);
    await query('DELETE FROM user_sessions WHERE user_id=?', [userId], conn);
  });
}

export async function deleteSession(token) {
  if (token) await query('DELETE FROM user_sessions WHERE token_hash = ?', [hashToken(token)]);
}

export const sessionMaxAge = SESSION_MS;
