import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { migrateAbsenceDomain } from '../server/migrate-absence.mjs';
import { migrateMemberScheduleHistory } from '../server/migrate-member-schedule.mjs';
import { historyCoverage, memberAt, scheduleAt } from '../server/member-schedule-history.mjs';
import { deleteEmployee } from '../server/member-policy.mjs';

const future = '2099-12-31T00:00:00.000Z';
function fixture(t,seed=true) {
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
  migrateAbsenceDomain(db);
  if(seed) db.exec(`INSERT INTO members VALUES('a@example.invalid','a','Member A','employee',1,'secret-hash');
    INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'secret-hash');
    INSERT INTO config VALUES(1,'[1,2,3,4,5,6]','09:00','17:00','Asia/Makassar',1);
    INSERT INTO records VALUES('r','a','a@example.invalid','Member A','2026-11-19','in','2026-11-19T00:00:00Z','ontime','selfies/a/r.jpg','qr','pending');`);
  return db;
}
const count=(db,table)=>db.prepare('SELECT count(*) AS n FROM '+table).get().n;
test('migration snapshots current data once without altering legacy rows',t=>{
  const db=fixture(t);
  const records=db.prepare('SELECT * FROM records').all();
  const members=db.prepare('SELECT * FROM members').all();
  assert.equal(migrateMemberScheduleHistory(db),true);
  assert.equal(migrateMemberScheduleHistory(db),false);
  assert.equal(count(db,'member_history'),2);
  assert.equal(count(db,'schedule_history'),1);
  assert.deepEqual(db.prepare('SELECT * FROM records').all(),records);
  assert.deepEqual(db.prepare('SELECT * FROM members').all(),members);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('pre-coverage history is unknown rather than invented',t=>{
  const db=fixture(t);
  assert.equal(historyCoverage(db),null);
  assert.deepEqual(memberAt(db,'a',future),{known:false,member:null});
  migrateMemberScheduleHistory(db);
  const coverage=historyCoverage(db);
  const before=new Date(Date.parse(coverage)-1);
  assert.deepEqual(memberAt(db,'a',before),{known:false,member:null});
  assert.deepEqual(scheduleAt(db,before),{known:false,schedule:null});
  assert.equal(memberAt(db,'a',coverage).member.event_type,'baseline');
  assert.equal(scheduleAt(db,coverage).schedule.timezone,'Asia/Makassar');
});
test('new member, profile, role and active changes retain identity and snapshots',t=>{
  const db=fixture(t);
  migrateMemberScheduleHistory(db);
  db.exec("INSERT INTO members VALUES('b@example.invalid','b','Member B','employee',1,'secret-hash')");
  db.exec("UPDATE members SET email='new@example.invalid',name='Updated' WHERE user_id='b'");
  db.exec("UPDATE members SET role='admin',active=0 WHERE user_id='b'");
  const rows=db.prepare("SELECT * FROM member_history WHERE user_id='b' ORDER BY event_id").all();
  assert.deepEqual(rows.map(x=>x.event_type),['created','updated','updated']);
  assert.equal(rows[0].email,'b@example.invalid');
  assert.equal(memberAt(db,'b',future).member.email,'new@example.invalid');
  assert.equal(memberAt(db,'b',future).member.active,0);
  assert.equal(memberAt(db,'b',future).member.role,'admin');
  assert.deepEqual(memberAt(db,'nonexistent',future),{known:true,member:null});
});
test('password changes and no-op profile changes do not capture credentials or events',t=>{
  const db=fixture(t);
  migrateMemberScheduleHistory(db);
  db.exec("UPDATE members SET password_hash='new-secret' WHERE user_id='a'");
  db.exec("UPDATE members SET name=name,email=email WHERE user_id='a'");
  assert.equal(count(db,'member_history'),2);
  assert.ok(!Object.keys(memberAt(db,'a',future).member).includes('password_hash'));
});
test('existing employee deletion preserves history and attendance',t=>{
  const db=fixture(t);
  migrateMemberScheduleHistory(db);
  deleteEmployee(db,'admin','a');
  assert.deepEqual(memberAt(db,'a',future),{known:true,member:null});
  const events=db.prepare("SELECT * FROM member_history WHERE user_id='a' ORDER BY event_id").all();
  assert.deepEqual(events.map(x=>x.event_type),['baseline','deleted']);
  assert.equal(events[1].name,'Member A');
  assert.equal(count(db,'records'),1);
});
test('schedule changes preserve weekdays, hours, timezone and late policy',t=>{
  const db=fixture(t);
  migrateMemberScheduleHistory(db);
  db.exec("UPDATE config SET days='[1,2,3,4,5]',start='08:00',end='16:00',timezone='Asia/Jakarta',allow_late=0 WHERE id=1");
  db.exec('UPDATE config SET days=days WHERE id=1');
  const events=db.prepare('SELECT * FROM schedule_history ORDER BY event_id').all();
  assert.equal(events.length,2);
  assert.equal(events[0].days,'[1,2,3,4,5,6]');
  assert.equal(events[0].start,'09:00');
  const current=scheduleAt(db,future).schedule;
  assert.equal(current.days,'[1,2,3,4,5]');
  assert.equal(current.start,'08:00');
  assert.equal(current.end,'16:00');
  assert.equal(current.timezone,'Asia/Jakarta');
  assert.equal(current.allow_late,0);
});
test('empty installation captures first setup and later deletion',t=>{
  const db=fixture(t,false);
  migrateMemberScheduleHistory(db);
  assert.equal(count(db,'member_history'),0);
  assert.deepEqual(scheduleAt(db,future),{known:true,schedule:null});
  db.exec(`INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'dummy');
    INSERT INTO config VALUES(1,'[1]','09:00','17:00','Asia/Makassar',0);`);
  assert.equal(memberAt(db,'admin',future).member.event_type,'created');
  assert.equal(scheduleAt(db,future).schedule.event_type,'created');
  db.exec('DELETE FROM config WHERE id=1');
  assert.deepEqual(scheduleAt(db,future),{known:true,schedule:null});
});
test('audit changes roll back with source transaction and history is append-only',t=>{
  const db=fixture(t);
  migrateMemberScheduleHistory(db);
  db.exec("BEGIN IMMEDIATE; UPDATE members SET name='temporary' WHERE user_id='a'; UPDATE config SET start='08:00' WHERE id=1; ROLLBACK;");
  assert.equal(count(db,'member_history'),2);
  assert.equal(count(db,'schedule_history'),1);
  assert.throws(()=>db.exec("UPDATE member_history SET name='changed'"));
  assert.throws(()=>db.exec('DELETE FROM schedule_history'));
  assert.throws(()=>db.exec("UPDATE members SET user_id='changed' WHERE user_id='a'"));
  assert.throws(()=>db.exec('UPDATE config SET id=2 WHERE id=1'));
});
test('migration failure rolls back all DDL and the migration marker',t=>{
  const db=fixture(t);
  db.exec('DROP TABLE config');
  assert.throws(()=>migrateMemberScheduleHistory(db));
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('member_history','schedule_history')").get().n,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM schema_migrations WHERE id='002-member-schedule-history'").get().n,0);
});
