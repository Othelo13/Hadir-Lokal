import { readFileSync } from 'node:fs';
const id='003-private-absence-attachments';
const schema=readFileSync(new URL('./migrations/003-private-absence-attachments.sql',import.meta.url),'utf8');
export function migrateAbsenceAttachments(sqlite) {
  if(sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys!==1) throw new Error('Foreign keys must be enabled before migrating.');
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    if(!sqlite.prepare("SELECT id FROM schema_migrations WHERE id='002-member-schedule-history'").get()) throw new Error('History migration must run first.');
    if(sqlite.prepare('SELECT id FROM schema_migrations WHERE id=?').get(id)){
      sqlite.exec('COMMIT');
      return false;
    }
    sqlite.exec(schema);
    sqlite.prepare('INSERT INTO schema_migrations(id,applied_at) VALUES (?,?)').run(id,new Date().toISOString());
    sqlite.exec('COMMIT');
    return true;
  } catch(error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}
