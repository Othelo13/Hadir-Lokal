import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { migrateAbsenceDomain } from '../server/migrate-absence.mjs';
import { effectiveAbsenceDays, officeDate, nextAbsenceStatus } from '../server/absence-policy.mjs';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  return db;
}
function request(db, id, user = 'user-a') {
  db.prepare(`INSERT INTO absence_requests
    (id,user_id,name_snapshot,email_snapshot,type,start_date,end_date,reason,status,office_timezone,schedule_snapshot,created_at,updated_at)
    VALUES (?,?,'Example','test@example.invalid','leave','2026-11-19','2026-11-20','Example reason','pending','Asia/Makassar','[1,2,3,4,5,6]','2026-11-19T00:00:00Z','2026-11-19T00:00:00Z')`).run(id,user);
  db.prepare('INSERT INTO absence_request_days VALUES (?,?)').run(id,'2026-11-19');
}
test('additive migration is repeatable and preserves legacy attendance rows', () => {
  const db = database();
  try {
    db.exec(`INSERT INTO records VALUES ('r','u','test@example.invalid','Example','2026-11-19','in','2026-11-19T00:00:00Z','ontime','selfies/u/r.jpg','qr','pending')`);
    const before = db.prepare('SELECT * FROM records').all();
    assert.equal(migrateAbsenceDomain(db), true);
    assert.equal(migrateAbsenceDomain(db), false);
    assert.deepEqual(db.prepare('SELECT * FROM records').all(), before);
    assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 1);
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});
test('migration rolls back marker and DDL when baseline is missing', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    assert.throws(() => migrateAbsenceDomain(db));
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='schema_migrations' OR name='absence_requests'").get().n, 0);
  } finally { db.close(); }
});
test('date reservations prevent overlaps and mismatched request ownership', () => {
  const db = database();
  try {
    migrateAbsenceDomain(db);
    request(db,'a'); request(db,'b'); request(db,'c','user-b');
    db.prepare('INSERT INTO absence_day_reservations VALUES (?,?,?)').run('user-a','2026-11-19','a');
    assert.throws(() => db.prepare('INSERT INTO absence_day_reservations VALUES (?,?,?)').run('user-a','2026-11-19','b'));
    assert.throws(() => db.prepare('INSERT INTO absence_day_reservations VALUES (?,?,?)').run('other-user','2026-11-19','a'));
    db.prepare('INSERT INTO absence_day_reservations VALUES (?,?,?)').run('user-b','2026-11-19','c');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});
test('absence history is append-only and survives missing member account', () => {
  const db = database();
  try {
    migrateAbsenceDomain(db);
    request(db,'a');
    db.prepare('INSERT INTO absence_request_history VALUES (?,?,?,?,?,?,?)').run('h','a',null,'pending','user-a',null,'2026-11-19T00:00:00Z');
    assert.throws(() => db.exec("UPDATE absence_request_history SET reason='changed'"));
    assert.throws(() => db.exec('DELETE FROM absence_request_history'));
    assert.throws(() => db.exec("DELETE FROM absence_requests WHERE id='a'"));
    assert.equal(db.prepare('SELECT count(*) AS n FROM absence_request_history').get().n,1);
  } finally { db.close(); }
});
const policy = { workDays:[1,2,3,4,5,6], maxRangeDays:366 };
test('date policy permits historical and >31-day requests while bounding work and dates safely', () => {
  assert.deepEqual(effectiveAbsenceDays({...policy,startDate:'2026-11-19',endDate:'2026-11-23'}), ['2026-11-19','2026-11-20','2026-11-21','2026-11-23']);
  const historical = effectiveAbsenceDays({...policy,startDate:'2026-01-02',endDate:'2026-02-16'});
  assert.ok(historical.length > 31);
  assert.equal(historical[0], '2026-01-02');
  assert.equal(historical.at(-1), '2026-02-16');
  assert.throws(() => effectiveAbsenceDays({...policy,startDate:'2026-02-30',endDate:'2026-03-01'}), {status:400});
  assert.throws(() => effectiveAbsenceDays({...policy,startDate:'2026-11-22',endDate:'2026-11-22'}), {status:400});
  assert.throws(() => effectiveAbsenceDays({...policy,startDate:'2026-11-20',endDate:'2026-11-19'}), {status:400});
  assert.throws(() => effectiveAbsenceDays({...policy,startDate:'2026-01-01',endDate:'2027-01-02'}), {status:400});
  assert.ok(effectiveAbsenceDays({...policy,startDate:'2026-01-01',endDate:'2027-01-01'}).length > 0);
  assert.equal(officeDate(new Date('2026-11-18T16:05:00Z'),'Asia/Makassar'),'2026-11-19');
});
test('state machine enforces ownership, roles and terminal states', () => {
  const admin={role:'admin',active:true}, owner={role:'employee',active:true,isOwner:true};
  assert.equal(nextAbsenceStatus('pending','approve',admin),'approved');
  assert.equal(nextAbsenceStatus('pending','reject',admin),'rejected');
  assert.equal(nextAbsenceStatus('pending','cancel',owner),'cancelled');
  assert.equal(nextAbsenceStatus('approved','cancel',admin),'cancelled');
  assert.throws(() => nextAbsenceStatus('approved','cancel',owner),{status:403});
  assert.throws(() => nextAbsenceStatus('pending','approve',owner),{status:403});
  assert.throws(() => nextAbsenceStatus('cancelled','approve',admin),{status:409});
  assert.throws(() => nextAbsenceStatus('pending','cancel',{...owner,isOwner:false}),{status:403});
});
