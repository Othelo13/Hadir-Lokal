import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { migrateAbsenceDomain } from '../server/migrate-absence.mjs';
import { submitAbsence, transitionAbsence, assertAttendanceAllowed } from '../server/absence-service.mjs';

const now = new Date('2026-11-19T01:00:00Z');
const policy = { maxRangeDays:366,minReasonLength:5,maxReasonLength:500 };
const input = { type:'leave',startDate:'2026-11-19',endDate:'2026-11-23',reason:'Kegiatan kampus' };
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
  migrateAbsenceDomain(db);
  db.exec(`INSERT INTO config VALUES(1,'[1,2,3,4,5,6]','09:00','17:00','Asia/Makassar',1);
    INSERT INTO members VALUES('a@example.invalid','a','Member A','employee',1,'dummy');
    INSERT INTO members VALUES('b@example.invalid','b','Member B','employee',1,'dummy');
    INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'dummy');`);
  return db;
}
const submit = (db,actor='a',data=input) => submitAbsence(db,actor,data,policy,now);
const transition = (db,id,action,actor='admin',reason=null) => transitionAbsence(db,actor,id,action,reason,policy,now);
const count = (db,table) => db.prepare('SELECT count(*) AS n FROM '+table).get().n;
const status = (db,id) => db.prepare('SELECT status FROM absence_requests WHERE id=?').get(id).status;
function attendance(db,date,review='pending',kind='in') {
  db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run('record-'+date+'-'+kind,'a','a@example.invalid','Member A',date,kind,now.toISOString(),'ontime','selfies/a/example.jpg','qr',review);
}
test('submission creates snapshot, effective days, reservations and one audit entry',t=>{
  const db=fixture(t), result=submit(db);
  assert.deepEqual(result.days,['2026-11-19','2026-11-20','2026-11-21','2026-11-23']);
  assert.equal(status(db,result.id),'pending');
  assert.equal(count(db,'absence_day_reservations'),4);
  assert.equal(count(db,'absence_request_history'),1);
  const row=db.prepare('SELECT * FROM absence_requests WHERE id=?').get(result.id);
  assert.equal(row.name_snapshot,'Member A');
  assert.equal(row.office_timezone,'Asia/Makassar');
  assert.doesNotThrow(()=>assertAttendanceAllowed(db,'a','2026-11-19'));
});
test('overlap fails atomically; different members can use the same dates',t=>{
  const db=fixture(t);
  submit(db);
  assert.throws(()=>submit(db,'a',{...input,startDate:'2026-11-23',endDate:'2026-11-24'}),{status:409});
  assert.equal(count(db,'absence_requests'),1);
  assert.equal(count(db,'absence_request_history'),1);
  submit(db,'b');
  assert.equal(count(db,'absence_day_reservations'),8);
});
test('approval keeps reservations, blocks attendance and cannot be repeated',t=>{
  const db=fixture(t), {id}=submit(db);
  assert.equal(transition(db,id,'approve').status,'approved');
  assert.throws(()=>assertAttendanceAllowed(db,'a','2026-11-19'),{status:409});
  assert.doesNotThrow(()=>assertAttendanceAllowed(db,'a','2026-11-22'));
  assert.doesNotThrow(()=>assertAttendanceAllowed(db,'b','2026-11-19'));
  assert.throws(()=>transition(db,id,'approve'),{status:409});
  assert.equal(count(db,'absence_request_history'),2);
});
test('active attendance including rejected selfie and out-only blocks submission',t=>{
  const db=fixture(t);
  attendance(db,'2026-11-20','rejected','out');
  assert.throws(()=>submit(db),{status:409});
  assert.equal(count(db,'absence_requests'),0);
  assert.equal(count(db,'absence_day_reservations'),0);
});
test('attendance after submission blocks approval across the entire range',t=>{
  const db=fixture(t), {id}=submit(db);
  attendance(db,'2026-11-23');
  assert.throws(()=>transition(db,id,'approve'),{status:409});
  assert.equal(status(db,id),'pending');
  assert.equal(count(db,'absence_request_history'),1);
  assert.equal(count(db,'absence_day_reservations'),4);
});
test('reject requires reason, releases reservations and allows resubmission',t=>{
  const db=fixture(t), {id}=submit(db);
  assert.throws(()=>transition(db,id,'reject'),{status:400});
  assert.equal(transition(db,id,'reject','admin','Tidak memenuhi ketentuan').status,'rejected');
  assert.equal(count(db,'absence_day_reservations'),0);
  assert.equal(count(db,'absence_request_days'),4);
  assert.notEqual(submit(db).id,id);
});
test('owner can cancel pending, but approved cancellation requires admin and reason',t=>{
  const db=fixture(t), first=submit(db);
  assert.equal(transition(db,first.id,'cancel','a').status,'cancelled');
  const second=submit(db);
  transition(db,second.id,'approve');
  assert.throws(()=>transition(db,second.id,'cancel','a'),{status:403});
  assert.throws(()=>transition(db,second.id,'cancel'),{status:400});
  assert.equal(transition(db,second.id,'cancel','admin','Anggota kembali masuk').status,'cancelled');
  assert.doesNotThrow(()=>assertAttendanceAllowed(db,'a','2026-11-19'));
  assert.equal(count(db,'absence_day_reservations'),0);
  assert.equal(count(db,'absence_request_history'),5);
});
test('role, ownership and active account are checked in the transaction',t=>{
  const db=fixture(t), {id}=submit(db);
  assert.throws(()=>submit(db,'admin'),{status:403});
  assert.throws(()=>transition(db,id,'approve','a'),{status:403});
  assert.throws(()=>transition(db,id,'cancel','b'),{status:404});
  db.exec("UPDATE members SET active=0 WHERE user_id='a'");
  assert.throws(()=>transition(db,id,'cancel','a'),{status:403});
  assert.throws(()=>transition(db,id,'approve'),{status:409});
  db.exec("DELETE FROM members WHERE user_id='a'");
  assert.equal(transition(db,id,'cancel','admin','Akun sudah dihapus').status,'cancelled');
});
test('invalid dates, type and reason cannot create requests',t=>{
  const db=fixture(t);
  for(const data of [{...input,type:'other'},{...input,reason:'   '},{...input,startDate:'2026-02-30'},{...input,reason:'x'.repeat(501)}]){
    assert.throws(()=>submit(db,'a',data),{status:400});
  }
  assert.equal(count(db,'absence_requests'),0);
});
test('failure writing audit rolls back submission and approval',t=>{
  const db=fixture(t);
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON absence_request_history BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(()=>submit(db));
  assert.equal(count(db,'absence_requests'),0);
  assert.equal(count(db,'absence_day_reservations'),0);
  db.exec('DROP TRIGGER fail_audit');
  const {id}=submit(db);
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON absence_request_history BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(()=>transition(db,id,'approve'));
  assert.equal(status(db,id),'pending');
  assert.equal(count(db,'absence_day_reservations'),4);
  assert.equal(count(db,'absence_request_history'),1);
});

test('historical multi-week request may be submitted without a three-day lookback',t=>{
  const db=fixture(t);
  const old={...input,startDate:'2026-09-01',endDate:'2026-10-15'};
  const result=submit(db,'a',old);
  assert.equal(status(db,result.id),'pending');
  assert.ok(result.days.length>31);
  assert.equal(count(db,'absence_day_reservations'),result.days.length);
  assert.equal(transition(db,result.id,'approve').status,'approved');
  assert.throws(()=>assertAttendanceAllowed(db,'a','2026-09-01'),{status:409});
});
