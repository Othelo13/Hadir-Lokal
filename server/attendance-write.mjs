import { assertAttendanceAllowed } from './absence-service.mjs';

/** Serialize the final attendance insert with approval on the same SQLite database. */
export function insertAttendanceWithAbsenceGuard(sqlite, record) {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    assertAttendanceAllowed(sqlite,record.userId,record.date);
    sqlite.prepare(`INSERT INTO records
      (id,user_id,email,name,date,kind,time,status,photo,qr,review)
      VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`).run(
      record.id,record.userId,record.email,record.name,record.date,record.kind,
      record.time,record.status,record.photo,record.qr
    );
    sqlite.exec('COMMIT');
  } catch(error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}
