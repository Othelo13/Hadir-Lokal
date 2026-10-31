import { db, bucket, sqlite } from './storage.mjs';
import { currentUser, authAction } from './auth.mjs';
import jsQR from 'jsqr';
import jpeg from 'jpeg-js';
import QRCode from 'qrcode';
import { SET_MEMBER_ROLE_SQL, deleteEmployee } from './member-policy.mjs';
export const dynamic = 'force-dynamic';
const json = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function local(now: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    clock: `${p.hour}:${p.minute}`,
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
  };
}
async function handle(req: Request) {
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === 'POST') {
    if (req.headers.get('origin') !== url.origin) fail('Permintaan tidak diizinkan.', 403);
    const raw = await req.text();
    if (raw.length > 2600000) fail('Ukuran foto terlalu besar.');
    try {
      body = JSON.parse(raw);
    } catch {
      fail('Permintaan tidak valid.');
    }
  }
  const action = body.action || url.searchParams.get('action') || 'state';
  const authentication = await authAction(req, action, body);
  if (authentication) return authentication;
  const me = currentUser(req);
  if (!me) return json({ error: 'Silakan masuk terlebih dahulu.' }, 401);
  const email = me.email,
    user = { userId: me.user_id };
  const admin = me.role === 'admin';
  const settings = await db.prepare('SELECT * FROM config WHERE id=1').first<any>();
  const today = local(new Date(), settings.timezone);
  if (action === 'state') {
    const rows = await db.prepare(
      admin
        ? 'SELECT * FROM records ORDER BY time DESC LIMIT 2000'
        : 'SELECT * FROM records WHERE user_id=? ORDER BY time DESC LIMIT 1000',
    );
    const history = await (admin ? rows : rows.bind(user.userId)).all();
    const people = admin
      ? (
          await db
            .prepare('SELECT user_id,email,name,role,active FROM members ORDER BY role,name')
            .all()
        ).results
      : [];
    const qr = admin
      ? (await db.prepare('SELECT * FROM codes ORDER BY created DESC').all()).results
      : [];
    return json({
      me: { email: me.email, name: me.name, role: me.role, active: me.active, user_id: me.user_id },
      settings: { ...settings, days: JSON.parse(settings.days) },
      today,
      records: history.results,
      members: people,
      codes: qr,
    });
  }
  if (action === 'photo') {
    const row = await db
      .prepare('SELECT * FROM records WHERE id=?')
      .bind(url.searchParams.get('id'))
      .first<any>();
    if (!row || (!admin && row.user_id !== user.userId)) fail('Foto tidak ditemukan.', 404);
    const object = await bucket.get(row.photo);
    if (!object) fail('Foto tidak tersedia.', 404);
    return new Response(object.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  if (req.method !== 'POST') fail('Metode tidak didukung.', 405);
  if ((action === 'challenge' || action === 'attendance') && me.role !== 'employee')
    fail('Absensi hanya tersedia untuk anggota magang.', 403);
  if (action === 'challenge') {
    const id = crypto.randomUUID();
    await db.prepare('DELETE FROM challenges WHERE expires < ?').bind(Date.now()).run();
    await db
      .prepare('INSERT INTO challenges VALUES (?,?,?)')
      .bind(id, user.userId, Date.now() + 180000)
      .run();
    return json({ id });
  }
  if (action === 'attendance') {
    if (!['in', 'out'].includes(body.kind)) fail('Jenis absensi tidak valid.');
    if (!JSON.parse(settings.days).includes(today.day)) fail('Hari ini bukan hari kerja.');
    if (body.kind === 'in' && today.clock > settings.start && !settings.allow_late)
      fail('Absen masuk ditutup setelah pukul ' + settings.start + '. Hubungi admin.');
    if (body.kind === 'out' && today.clock < settings.end)
      fail(`Absen pulang dibuka pukul ${settings.end}.`);
    if (
      body.kind === 'out' &&
      !(await db
        .prepare("SELECT id FROM records WHERE user_id=? AND date=? AND kind='in'")
        .bind(user.userId, today.date)
        .first())
    )
      fail('Lakukan absen masuk terlebih dahulu.');
    if (
      await db
        .prepare('SELECT id FROM records WHERE user_id=? AND date=? AND kind=?')
        .bind(user.userId, today.date, body.kind)
        .first()
    )
      fail('Absensi ini sudah tercatat hari ini.');
    const challenge = await db
      .prepare('DELETE FROM challenges WHERE id=? AND user_id=? AND expires>? RETURNING id')
      .bind(body.challenge, user.userId, Date.now())
      .first();
    if (!challenge) fail('Sesi kamera kedaluwarsa. Buka kamera kembali.');
    if (typeof body.photo !== 'string' || !body.photo.startsWith('data:image/jpeg;base64,'))
      fail('Foto JPEG diperlukan.');
    const bytes = Uint8Array.from(atob(body.photo.split(',')[1]), (c) => c.charCodeAt(0));
    if (bytes.length > 1800000) fail('Foto terlalu besar.');
    let decoded: any;
    try {
      decoded = jpeg.decode(bytes, {
        useTArray: true,
        maxResolutionInMP: 2,
        maxMemoryUsageInMB: 40,
      });
    } catch {
      fail('Foto tidak dapat dibaca.');
    }
    if (
      decoded.width > 1600 ||
      decoded.height > 1600 ||
      decoded.width < 320 ||
      decoded.height < 240
    )
      fail('Ukuran foto tidak sesuai. Ambil ulang.');
    const qr = jsQR(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height);
    if (!qr) fail('QR tidak terbaca di dalam foto. Pastikan QR cukup besar dan terang.');
    const code = await db
      .prepare('SELECT id FROM codes WHERE id=? AND active=1')
      .bind(qr.data.replace(/^HADIR:/, ''))
      .first<any>();
    if (!qr.data.startsWith('HADIR:') || !code) fail('QR tidak berlaku atau bukan QR kantor ini.');
    const id = crypto.randomUUID();
    const key = `selfies/${user.userId}/${id}.jpg`;
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
    try {
      await db
        .prepare(
          'INSERT INTO records (id,user_id,email,name,date,kind,time,status,photo,qr,review) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          user.userId,
          email,
          me.name,
          today.date,
          body.kind,
          new Date().toISOString(),
          body.kind === 'in' && today.clock > settings.start ? 'late' : 'ontime',
          key,
          code.id,
          'pending',
        )
        .run();
    } catch {
      await bucket.delete(key);
      fail('Absensi sudah tercatat atau gagal disimpan. Muat ulang sebelum mencoba lagi.');
    }
    return json({ ok: true });
  }
  if (!admin) fail('Hanya admin yang dapat melakukan tindakan ini.', 403);
  if (action === 'member-role') {
    const targetEmail = String(body.email || '')
      .trim()
      .toLowerCase();
    if (!['admin', 'employee'].includes(body.role)) fail('Peran anggota tidak valid.');
    const changed = await db
      .prepare(SET_MEMBER_ROLE_SQL)
      .bind(body.role, targetEmail, email, body.role)
      .first();
    if (!changed) {
      const actor = await db
        .prepare("SELECT email FROM members WHERE email=? AND role='admin' AND active=1")
        .bind(email)
        .first();
      if (!actor) fail('Hak admin Anda sudah berubah. Muat ulang halaman.', 403);
      const target = await db
        .prepare('SELECT role,active FROM members WHERE email=?')
        .bind(targetEmail)
        .first<any>();
      if (!target) fail('Anggota tidak ditemukan.', 404);
      if (!target.active) fail('Aktifkan anggota sebelum mengubah perannya.');
      fail('Minimal satu admin aktif harus tetap ada. Tambahkan admin lain terlebih dahulu.', 409);
    }
    return json({ ok: true });
  }
  if (action === 'member') {
    return await authAction(req, 'member-create', body);
  }
  if (action === 'delete-member') {
    if (typeof body.id !== 'string' || !body.id) fail('Pilih anggota yang akan dihapus.');
    deleteEmployee(sqlite, user.userId, body.id);
    return json({ ok: true });
  }
  if (action === 'settings') {
    if (
      !Array.isArray(body.days) ||
      !body.days.length ||
      body.days.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6)
    )
      fail('Pilih hari kerja.');
    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.end) ||
      body.start >= body.end
    )
      fail('Jam pulang harus setelah jam masuk.');
    if (
      !['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore'].includes(body.timezone)
    )
      fail('Zona waktu tidak valid.');
    await db
      .prepare('UPDATE config SET days=?,start=?,end=?,timezone=?,allow_late=? WHERE id=1')
      .bind(JSON.stringify(body.days), body.start, body.end, body.timezone, body.allow_late ? 1 : 0)
      .run();
    return json({ ok: true });
  }
  if (action === 'create-qr') {
    const id = crypto.randomUUID();
    const label = String(body.label || 'Kantor utama')
      .trim()
      .slice(0, 80);
    await db
      .prepare('INSERT INTO codes VALUES (?,?,1,?)')
      .bind(id, label, new Date().toISOString())
      .run();
    return json({ ok: true });
  }
  if (action === 'delete-qr' || action === 'disable-qr') {
    if (typeof body.id !== 'string' || !body.id) fail('Pilih QR yang akan dihapus.');
    const deleted = await db
      .prepare('DELETE FROM codes WHERE id=? RETURNING id')
      .bind(body.id)
      .first();
    if (!deleted) fail('QR sudah dihapus atau tidak ditemukan.', 404);
    return json({ ok: true });
  }
  if (action === 'qr-image') {
    const code = await db
      .prepare('SELECT id FROM codes WHERE id=? AND active=1')
      .bind(body.id)
      .first<any>();
    if (!code) fail('QR sudah dihapus atau tidak ditemukan.');
    return json({
      svg: await QRCode.toString('HADIR:' + code.id, {
        type: 'svg',
        width: 640,
        margin: 4,
        errorCorrectionLevel: 'M',
      }),
    });
  }
  if (action === 'delete-record') {
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id))
      fail('Pilih catatan absensi yang valid.');
    // Transaksi SQLite sinkron mencegah dua penghapusan catatan yang sama dan
    // memastikan metadata audit tersimpan bersama perubahan pada rekap.
    const row = sqlite.prepare('SELECT * FROM records WHERE id=?').get(body.id);
    if (!row) fail('Catatan absensi sudah dihapus atau tidak ditemukan.', 404);
    if (
      row.kind === 'in' &&
      sqlite.prepare("SELECT id FROM records WHERE user_id=? AND date=? AND kind='out'")
        .get(row.user_id, row.date)
    )
      fail('Hapus catatan absen pulang pada tanggal ini terlebih dahulu.', 409);
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const deleted = sqlite.prepare('DELETE FROM records WHERE id=? RETURNING id').get(row.id);
      if (!deleted) fail('Catatan absensi sudah dihapus atau tidak ditemukan.', 404);
      sqlite.prepare(
        'INSERT INTO record_deletions (record_id,user_id,date,kind,deleted_by,deleted_at) VALUES (?,?,?,?,?,?)',
      ).run(row.id, row.user_id, row.date, row.kind, user.userId, new Date().toISOString());
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
    // Jika file gagal dihapus, catatan audit tetap ada; file dapat dibersihkan manual.
    try {
      await bucket.delete(row.photo);
    } catch {
      return json({ ok: true, warning: 'Catatan dihapus, tetapi file foto gagal dibersihkan.' });
    }
    return json({ ok: true });
  }
  if (action === 'review') {
    if (!['approved', 'rejected'].includes(body.review)) fail('Status tidak valid.');
    await db.prepare('UPDATE records SET review=? WHERE id=?').bind(body.review, body.id).run();
    return json({ ok: true });
  }
  fail('Tindakan tidak dikenal.', 404);
}
async function safe(req: Request) {
  try {
    return await handle(req);
  } catch (e: any) {
    return json(
      { error: e.status ? e.message : 'Terjadi kesalahan. Silakan coba lagi.' },
      e.status || 500,
    );
  }
}
export default safe;
