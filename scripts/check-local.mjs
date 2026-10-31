// Pemeriksaan lokal read-only. Tidak mengubah data, sesi, maupun foto.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = path.join(root, 'data');
const selfieDir = path.resolve(dataDir, 'selfies');
const databasePath = path.join(dataDir, 'hadir.sqlite');

if (!existsSync(databasePath)) {
  console.error('GAGAL: database data/hadir.sqlite tidak ditemukan. Jalankan aplikasi terlebih dahulu.');
  process.exitCode = 1;
} else {
  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const problems = [];
    const warnings = [];

    const quickCheck = db.prepare('PRAGMA quick_check').get();
    if (Object.values(quickCheck ?? {})[0] !== 'ok') problems.push('SQLite quick_check tidak lulus.');
    const fkIssues = db.prepare('PRAGMA foreign_key_check').all();
    if (fkIssues.length) problems.push('Ada referensi foreign key yang tidak konsisten.');

    // Hanya data ringkas, tanpa mencetak nama, email, isi alasan atau token sesi.
    const active = db.prepare(
      'SELECT id,user_id,date,kind,time,status,review,photo FROM records ORDER BY id'
    ).all();
    const cancelled = db.prepare(
      'SELECT id,user_id,date,kind,time,reason,cancelled_at,retry_authorized_at,photo_cleanup_key FROM attendance_cancellations ORDER BY id'
    ).all();

    const insideSelfies = (file) => file.startsWith(selfieDir + path.sep);
    const activePhotos = new Set();
    const activePairs = new Set();
    let missingPhotos = 0, leftoverCancelledPhotos = 0, pendingCleanup = 0;
    let invalidPaths = 0, duplicateActive = 0, missingReasons = 0;

    for (const row of active) {
      const key = String(row.photo ?? '');
      const file = path.resolve(dataDir, key);
      if (!insideSelfies(file)) {
        invalidPaths++;
      } else {
        activePhotos.add(file);
        if (!existsSync(file)) missingPhotos++;
      }
      const pair = JSON.stringify([row.user_id, row.date, row.kind]);
      if (activePairs.has(pair)) duplicateActive++;
      activePairs.add(pair);
    }
    for (const row of cancelled) {
      const file = path.resolve(selfieDir, String(row.user_id), String(row.id) + '.jpg');
      if (!insideSelfies(file)) invalidPaths++;
      else if (existsSync(file)) leftoverCancelledPhotos++;
      if (row.photo_cleanup_key !== null) pendingCleanup++;
      if (!String(row.reason ?? '').trim()) missingReasons++;
    }

    if (invalidPaths) problems.push('Ada jalur foto di luar data/selfies.');
    if (missingPhotos) problems.push('Ada foto untuk absensi aktif yang tidak ditemukan.');
    if (leftoverCancelledPhotos) problems.push('Ada foto pembatalan yang masih tersimpan.');
    if (duplicateActive) problems.push('Terdapat absensi aktif ganda untuk satu tanggal dan jenis.');
    if (missingReasons) problems.push('Ada pembatalan tanpa alasan.');
    if (pendingCleanup) warnings.push('Masih ada penanda pembersihan foto yang tertunda.');

    // Sidik jari tidak memuat foto atau informasi pribadi secara terbuka.
    // Jika tidak ada perubahan data, nilainya stabil melintasi restart server.
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ active, cancelled }))
      .digest('hex')
      .slice(0, 16);

    console.log('Pemeriksaan Hadir-Lokal (read-only)');
    console.log('SQLite quick_check:', Object.values(quickCheck ?? {})[0] === 'ok' ? 'OK' : 'BERMASALAH');
    console.log('Foreign key:', fkIssues.length ? 'BERMASALAH' : 'OK');
    console.log('Absensi aktif:', active.length);
    console.log('Riwayat pembatalan:', cancelled.length);
    console.log('Foto aktif hilang:', missingPhotos);
    console.log('Foto pembatalan tersisa:', leftoverCancelledPhotos);
    console.log('Pembersihan foto tertunda:', pendingCleanup);
    console.log('Anomali jalur/duplikasi/alasan:', invalidPaths + duplicateActive + missingReasons);
    console.log('Sidik jari data:', fingerprint);
    for (const message of warnings) console.warn('PERINGATAN:', message);
    for (const message of problems) console.error('GAGAL:', message);
    if (problems.length || warnings.length) process.exitCode = 1;
    else console.log('HASIL: LULUS - tidak ditemukan anomali pada pemeriksaan ini.');
  } catch (error) {
    console.error('GAGAL: pemeriksaan tidak dapat diselesaikan:', error.message);
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}
