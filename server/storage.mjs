import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { assertPrivateDataDirectory } from './storage-paths.mjs';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
const configuredDataDir = process.env.HADIR_DATA_DIR?.trim();
if (process.env.HOST === '0.0.0.0' && !configuredDataDir)
  throw new Error('Server publik memerlukan HADIR_DATA_DIR pada volume persisten.');
if (configuredDataDir && !path.isAbsolute(configuredDataDir))
  throw new Error('HADIR_DATA_DIR harus berupa path absolut.');
export const dataDir = configuredDataDir ? path.resolve(configuredDataDir) : path.join(root, 'data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
assertPrivateDataDirectory(dataDir, path.join(root, 'dist'));
export const sqlite = new DatabaseSync(path.join(dataDir, 'hadir.sqlite'));
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
export const db = {
  prepare(sql) {
    let values = [];
    const statement = sqlite.prepare(sql);
    const wrapper = {
      bind(...args) {
        values = args;
        return wrapper;
      },
      async first() {
        return statement.get(...values) || null;
      },
      async all() {
        return { results: statement.all(...values) };
      },
      async run() {
        return statement.run(...values);
      },
    };
    return wrapper;
  },
};
function photoPath(key) {
  const result = path.resolve(dataDir, key);
  if (!result.startsWith(path.resolve(dataDir, 'selfies') + path.sep))
    throw new Error('Invalid photo path');
  return result;
}
// Selesaikan penghapusan foto yang tertunda akibat aplikasi terhenti saat pembatalan.
for (const row of sqlite
  .prepare('SELECT id, photo_cleanup_key FROM attendance_cancellations WHERE photo_cleanup_key IS NOT NULL')
  .all()) {
  try {
    const target = photoPath(row.photo_cleanup_key);
    if (existsSync(target)) unlinkSync(target);
    sqlite.prepare('UPDATE attendance_cancellations SET photo_cleanup_key=NULL WHERE id=?').run(row.id);
  } catch {
    // Tetap simpan penanda agar dicoba lagi pada startup selanjutnya.
  }
}
export const bucket = {
  async put(key, bytes) {
    const target = photoPath(key);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  },
  async get(key) {
    const target = photoPath(key);
    return existsSync(target) ? { body: readFileSync(target) } : null;
  },
  async delete(key) {
    const target = photoPath(key);
    if (existsSync(target)) unlinkSync(target);
  },
};
