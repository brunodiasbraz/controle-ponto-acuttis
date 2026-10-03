import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { claimLegacyData, db } from './db.js';

const scrypt = promisify(scryptCallback);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hashToken = token => createHash('sha256').update(token).digest('hex');

async function passwordHash(password, salt = randomBytes(16).toString('base64url')) {
  const derived = await scrypt(password, Buffer.from(salt, 'base64url'), 64, SCRYPT_OPTIONS);
  return `scrypt$${salt}$${Buffer.from(derived).toString('base64url')}`;
}

export async function register(usernameInput, password) {
  const username = typeof usernameInput === 'string' ? usernameInput.trim() : '';
  if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username))
    throw Object.assign(new Error('O usuário deve ter de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.'), { status: 400 });
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 256)
    throw Object.assign(new Error('A senha deve ter entre 12 e 256 bytes.'), { status: 400 });
  const hash = await passwordHash(password);
  const id = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    const firstUser = db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0;
    db.prepare('INSERT INTO users(id,username,password_hash) VALUES(?,?,?)').run(id, username, hash);
    db.prepare("INSERT INTO user_work_schedules(user_id,schedule_id) VALUES(?,'equipe-dev')").run(id);
    if (firstUser) claimLegacyData(id);
    db.exec('COMMIT');
    return { id, username };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE')
      throw Object.assign(new Error('Esse nome de usuário já está em uso.'), { status: 409 });
    throw error;
  }
}

export async function authenticate(usernameInput, password) {
  const username = typeof usernameInput === 'string' ? usernameInput.trim() : '';
  if (typeof password !== 'string' || password.length > 256) return null;
  const user = db.prepare('SELECT id,username,password_hash FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user) {
    await passwordHash(password, Buffer.alloc(16).toString('base64url'));
    return null;
  }
  const [scheme, salt, expectedEncoded] = user.password_hash.split('$');
  if (scheme !== 'scrypt' || !salt || !expectedEncoded) return null;
  const candidate = await scrypt(password, Buffer.from(salt, 'base64url'), 64, SCRYPT_OPTIONS);
  const expected = Buffer.from(expectedEncoded, 'base64url');
  if (expected.length !== candidate.length || !timingSafeEqual(expected, candidate)) return null;
  return { id: user.id, username: user.username };
}

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_MS;
  db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token), userId, expiresAt);
  return { token, expiresAt };
}

export function getSession(token) {
  if (!token || typeof token !== 'string' || token.length > 128) return null;
  const row = db.prepare('SELECT users.id, users.username FROM user_sessions JOIN users ON users.id=user_sessions.user_id WHERE user_sessions.token_hash = ? AND user_sessions.expires_at > ?').get(hashToken(token), Date.now());
  return row ? { id: row.id, username: row.username } : null;
}

export function deleteSession(token) {
  if (token) db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(hashToken(token));
}

export const sessionMaxAge = SESSION_MS;
