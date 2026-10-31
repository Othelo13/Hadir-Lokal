import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
import { sqlite } from './storage.mjs';
const scrypt = promisify(scryptCallback);
const respond = (v, status = 200, headers = {}) =>
  Response.json(v, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
const zones = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore'];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const token = (req) =>
  (req.headers.get('cookie') || '')
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('hadir_session='))
    ?.slice(14) || '';
export function currentUser(req) {
  const t = token(req);
  if (!/^[a-f0-9]{64}$/.test(t)) return null;
  return (
    sqlite
      .prepare(
        'SELECT m.* FROM sessions s JOIN members m ON m.user_id=s.user_id WHERE s.token_hash=? AND s.expires>? AND m.active=1',
      )
      .get(digest(t), Date.now()) || null
  );
}
async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    fail('Kata sandi harus 8–128 karakter.');
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}
async function verify(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [method, salt, value] = String(stored).split(':');
  if (method !== 'scrypt' || !value) return false;
  const actual = await scrypt(password, salt, 64),
    expected = Buffer.from(value, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function credentials(body) {
  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const name = String(body.name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail('Email tidak valid.');
  return { email, name };
}
function beginSession(user) {
  const value = randomBytes(32).toString('hex');
  sqlite.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  sqlite
    .prepare('INSERT INTO sessions VALUES (?,?,?)')
    .run(digest(value), user.user_id, Date.now() + 12 * 60 * 60 * 1000);
  return respond({ ok: true }, 200, {
    'Set-Cookie': `hadir_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
  });
}
function requireAdmin(req) {
  const actor = currentUser(req);
  if (!actor || actor.role !== 'admin') fail('Hanya admin yang dapat melakukan tindakan ini.', 403);
  return actor;
}
const attempts = new Map();
function limit(key) {
  const now = Date.now(),
    v = attempts.get(key);
  if (v && v.until > now) {
    if (v.count >= 10) fail('Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.', 429);
    v.count++;
  } else attempts.set(key, { count: 1, until: now + 900000 });
  if (attempts.size > 1000) for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
}
export async function authAction(req, action, body) {
  const empty = sqlite.prepare('SELECT COUNT(*) n FROM members').get().n === 0;
  if (action === 'state' && empty) return respond({ setup: true });
  if (action === 'state' && !currentUser(req)) return respond({ login: true });
  if (
    [
      'setup',
      'login',
      'logout',
      'member-create',
      'password-reset',
      'password-update',
      'profile-update',
    ].includes(action) &&
    req.method !== 'POST'
  )
    fail('Metode tidak didukung.', 405);
  if (action === 'setup') {
    if (!empty) fail('Admin pertama sudah dibuat.', 409);
    const { email, name } = credentials(body);
    if (!name || name.length > 80) fail('Isi nama lengkap, maksimal 80 karakter.');
    if (!zones.includes(body.timezone)) fail('Pilih zona waktu kantor.');
    const passwordHash = await hashPassword(body.password),
      id = randomUUID();
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      if (sqlite.prepare('SELECT COUNT(*) n FROM members').get().n)
        fail('Admin pertama sudah dibuat.', 409);
      sqlite
        .prepare("INSERT INTO members VALUES (?,?,?,'admin',1,?)")
        .run(email, id, name, passwordHash);
      sqlite
        .prepare("INSERT INTO config VALUES (1,'[1,2,3,4,5,6]','09:00','17:00',?,0)")
        .run(body.timezone);
      sqlite.exec('COMMIT');
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
    return beginSession({ user_id: id });
  }
  if (action === 'login') {
    limit('login');
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    const user = sqlite.prepare('SELECT * FROM members WHERE email=? AND active=1').get(email);
    // Perform a hash even when the address is unknown.
    const dummy = 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64);
    if (!(await verify(body.password, user?.password_hash || dummy)) || !user)
      fail('Email atau kata sandi tidak sesuai.', 401);
    attempts.delete('login');
    return beginSession(user);
  }
  if (action === 'logout') {
    const t = token(req);
    if (t) sqlite.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(t));
    return respond({ ok: true }, 200, {
      'Set-Cookie': 'hadir_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    });
  }
  if (action === 'member-create') {
    const actor = requireAdmin(req),
      { email, name } = credentials(body);
    if (!name || name.length > 80) fail('Isi nama lengkap, maksimal 80 karakter.');
    const passwordHash = await hashPassword(body.password);
    requireAdmin(req);
    if (sqlite.prepare('SELECT email FROM members WHERE email=?').get(email))
      fail('Email sudah terdaftar. Gunakan Atur kata sandi untuk mengubah aksesnya.', 409);
    sqlite
      .prepare("INSERT INTO members VALUES (?,?,?,'employee',1,?)")
      .run(email, randomUUID(), name, passwordHash);
    return respond({ ok: true });
  }
  if (action === 'profile-update') {
    const me = currentUser(req);
    if (!me) fail('Silakan masuk terlebih dahulu.', 401);
    limit('profile:' + me.user_id);
    const { email, name } = credentials(body);
    if (!name || name.length > 80) fail('Isi nama lengkap, maksimal 80 karakter.');
    if (!(await verify(body.current, me.password_hash))) fail('Kata sandi sekarang tidak sesuai.');

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const current = currentUser(req);
      if (!current || current.user_id !== me.user_id || current.password_hash !== me.password_hash)
        fail('Sesi telah berubah. Muat ulang halaman dan coba kembali.', 401);
      const duplicate = sqlite
        .prepare('SELECT user_id FROM members WHERE lower(email)=? AND user_id<>?')
        .get(email, me.user_id);
      if (duplicate) fail('Email sudah digunakan oleh akun lain.', 409);
      sqlite
        .prepare('UPDATE members SET name=?,email=? WHERE user_id=?')
        .run(name, email, me.user_id);
      if (email !== current.email) {
        sqlite
          .prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?')
          .run(me.user_id, digest(token(req)));
      }
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
    attempts.delete('profile:' + me.user_id);
    return respond({ ok: true });
  }
  if (action === 'password-update') {
    const me = currentUser(req);
    if (!me) fail('Silakan masuk terlebih dahulu.', 401);
    limit('password:' + me.user_id);
    if (!(await verify(body.current, me.password_hash))) fail('Kata sandi sekarang tidak sesuai.');
    const passwordHash = await hashPassword(body.password);
    if (!currentUser(req)) fail('Sesi telah berakhir.', 401);
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite
        .prepare('UPDATE members SET password_hash=? WHERE user_id=?')
        .run(passwordHash, me.user_id);
      sqlite.prepare('DELETE FROM sessions WHERE user_id=?').run(me.user_id);
      sqlite.exec('COMMIT');
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
    attempts.delete('password:' + me.user_id);
    return beginSession(me);
  }
  if (action === 'password-reset') {
    const actor = requireAdmin(req),
      email = String(body.email || '')
        .trim()
        .toLowerCase();
    if (email === actor.email) fail('Gunakan Akun saya untuk mengubah kata sandi sendiri.');
    const target = sqlite.prepare('SELECT user_id FROM members WHERE email=?').get(email);
    if (!target) fail('Anggota tidak ditemukan.', 404);
    const passwordHash = await hashPassword(body.password);
    requireAdmin(req);
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.prepare('UPDATE members SET password_hash=? WHERE email=?').run(passwordHash, email);
      sqlite.prepare('DELETE FROM sessions WHERE user_id=?').run(target.user_id);
      sqlite.exec('COMMIT');
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
    return respond({ ok: true });
  }
  return null;
}
