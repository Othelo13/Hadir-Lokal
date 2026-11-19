import { HISTORY_MIGRATION } from './migrate-member-schedule.mjs';

function canonicalInstant(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error('Invalid history instant.');
  return date.toISOString();
}

/** No inferred membership or schedule before history coverage begins. */
export function historyCoverage(sqlite) {
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (!table) return null;
  return sqlite.prepare('SELECT applied_at FROM schema_migrations WHERE id=?').get(HISTORY_MIGRATION)?.applied_at ?? null;
}

export function memberAt(sqlite,userId,instant) {
  const at = canonicalInstant(instant), coverage = historyCoverage(sqlite);
  if (!coverage || at < coverage) return { known:false,member:null };
  const event = sqlite.prepare(`SELECT * FROM member_history
    WHERE user_id=? AND recorded_at<=?
    ORDER BY recorded_at DESC,event_id DESC LIMIT 1`).get(userId,at);
  return { known:true,member:!event || event.event_type==='deleted' ? null : event };
}

export function scheduleAt(sqlite,instant) {
  const at = canonicalInstant(instant), coverage = historyCoverage(sqlite);
  if (!coverage || at < coverage) return { known:false,schedule:null };
  const event = sqlite.prepare(`SELECT * FROM schedule_history
    WHERE config_id=1 AND recorded_at<=?
    ORDER BY recorded_at DESC,event_id DESC LIMIT 1`).get(at);
  return { known:true,schedule:!event || event.event_type==='deleted' ? null : event };
}
