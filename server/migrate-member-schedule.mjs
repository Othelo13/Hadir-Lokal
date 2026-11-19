import { readFileSync } from 'node:fs';

export const HISTORY_MIGRATION = '002-member-schedule-history';
const schema = readFileSync(new URL('./migrations/002-member-schedule-history.sql', import.meta.url), 'utf8');

/** Requires migration 001 and the legacy schema. Baseline and triggers are atomic. */
export function migrateMemberScheduleHistory(sqlite) {
  if (sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) {
    throw new Error('Foreign keys must be enabled before migrating.');
  }
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const prerequisite = sqlite.prepare('SELECT id FROM schema_migrations WHERE id=?').get('001-absence-domain');
    if (!prerequisite) throw new Error('Absence domain migration must run first.');
    if (sqlite.prepare('SELECT id FROM schema_migrations WHERE id=?').get(HISTORY_MIGRATION)) {
      sqlite.exec('COMMIT');
      return false;
    }
    sqlite.exec(schema);
    const timestamp = sqlite.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS timestamp").get().timestamp;
    sqlite.prepare(`INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
      SELECT user_id,name,email,role,active,'baseline',? FROM members`).run(timestamp);
    sqlite.prepare(`INSERT INTO schedule_history(config_id,days,start,end,timezone,allow_late,event_type,recorded_at)
      SELECT id,days,start,end,timezone,allow_late,'baseline',? FROM config WHERE id=1`).run(timestamp);
    sqlite.prepare('INSERT INTO schema_migrations(id,applied_at) VALUES (?,?)').run(HISTORY_MIGRATION,timestamp);
    sqlite.exec('COMMIT');
    return true;
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}
