import { readFileSync } from 'node:fs';

const migrationId = '001-absence-domain';
const schema = readFileSync(new URL('./migrations/001-absence-domain.sql', import.meta.url), 'utf8');

/**
 * Run only after the baseline schema is initialized. SQLite DDL and the
 * migration marker are committed together. Never mutate legacy rows.
 */
export function migrateAbsenceDomain(sqlite) {
  if (sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) {
    throw new Error('Foreign keys must be enabled before migrating.');
  }
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY, applied_at TEXT NOT NULL
    )`);
    const applied = sqlite.prepare('SELECT id FROM schema_migrations WHERE id=?').get(migrationId);
    if (!applied) {
      sqlite.exec(schema);
      sqlite.prepare('INSERT INTO schema_migrations(id,applied_at) VALUES (?,?)')
        .run(migrationId, new Date().toISOString());
    }
    sqlite.exec('COMMIT');
    return !applied;
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}
