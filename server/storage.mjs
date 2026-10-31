import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const dataDir = path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });
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
