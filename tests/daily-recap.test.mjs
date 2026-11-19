import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { migrateAbsenceDomain } from '../server/migrate-absence.mjs';
import { migrateMemberScheduleHistory } from '../server/migrate-member-schedule.mjs';
import { migrateAbsenceAttachments } from '../server/migrate-absence-attachments.mjs';
import { submitAbsence,transitionAbsence } from '../server/absence-service.mjs';
import { dailyEvidence } from '../server/daily-recap.mjs';
const date='2026-11-19',now=new Date(date+'T00:00:00Z'),policy={maxBackDays:3,maxRangeDays:31,minReasonLength:5,maxReasonLength:500};
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
 migrateAbsenceDomain(db);migrateMemberScheduleHistory(db);migrateAbsenceAttachments(db);
 db.exec(`INSERT INTO config VALUES(1,'[1,2,3,4,5]','09:00','17:00','Asia/Makassar',1);
 INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'secret');`);
 const member=(id,name=id)=>db.prepare("INSERT INTO members VALUES(?,?,?,'employee',1,'secret')").run(id+'@example.invalid',id,name);
 const record=(id,userId,kind='in',status='ontime',review='approved',opts={})=>{
  const time=opts.time??date+(kind==='in'?'T00:45:00Z':'T09:05:00Z');
  db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,userId,opts.email??userId+'@example.invalid',opts.name??userId,opts.date??date,kind,time,status,'selfies/private.jpg','secret-qr',review);
 };
 const absence=(userId,type='leave',status='approved',endDate=date)=>{
  const id=submitAbsence(db,userId,{type,startDate:date,endDate,reason:'Private medical reason'},policy,now).id;
  if(status!=='pending')transitionAbsence(db,'admin',id,status==='approved'?'approve':status==='rejected'?'reject':'cancel','Test reason',policy,now);
  return id;
 };
 const cancel=(id,userId)=>db.prepare(`INSERT INTO attendance_cancellations(id,user_id,email,name,date,kind,time,reason,cancelled_by,cancelled_at,photo_cleanup_key)
 VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,userId,userId+'@example.invalid',userId,date,'in',date+'T00:45:00Z','Private cancellation reason','admin',date+'T01:00:00Z','private/path');
 return {db,member,record,absence,cancel,rows:(day=date)=>dailyEvidence(db,day)};
}
test('daily evidence merges check-in and checkout by immutable identity rather than email or name',t=>{
 const f=fixture(t);
 f.record('i','a','in','late','approved',{name:'Old name',email:'old@example.invalid'});
 f.record('o','a','out','ontime','pending',{name:'New name',email:'new@example.invalid'});
 const [row]=f.rows();
 assert.equal(f.rows().length,1);assert.equal(row.userId,'a');assert.equal(row.name,'New name');
 assert.equal(row.status,'late');assert.equal(row.checkIn.id,'i');assert.equal(row.checkOut.id,'o');
 assert.equal(row.provisional,true);
});
test('missing checkout does not change attendance status; pending review is provisional',t=>{
 const f=fixture(t);f.record('i','a','in','ontime','pending');
 const [row]=f.rows();assert.equal(row.status,'present');assert.equal(row.checkOut,null);assert.equal(row.provisional,true);
});
test('rejected and cancelled events remain evidence but not attendance',t=>{
 const f=fixture(t);f.record('i','a','in','ontime','rejected');f.cancel('c','b');
 const rows=f.rows();assert.equal(rows.length,2);
 for(const row of rows){assert.equal(row.status,null);assert.equal(row.checkIn,null);}
 assert.equal(rows.find(r=>r.userId==='b').cancellationCount,1);
 assert.equal(rows.find(r=>r.userId==='a').activeRecordCount,1);
});
test('rejected checkout is omitted and out-only is not promoted to present',t=>{
 const f=fixture(t);f.record('i','a');f.record('o','a','out','ontime','rejected');f.record('o2','b','out');
 const rows=f.rows();assert.equal(rows[0].status,'present');assert.equal(rows[0].checkOut,null);
 assert.equal(rows[1].status,null);assert.equal(rows[1].checkOut.id,'o2');assert.ok(rows[1].issues.includes('checkout_without_valid_checkin'));
});
test('only approved absences count and only on reserved effective work dates',t=>{
 const f=fixture(t);
 for(const id of ['a','b','c','d','e'])f.member(id);
 f.absence('a','leave','approved','2026-11-23');f.absence('b','sick');
 f.absence('c','leave','pending');f.absence('d','leave','rejected');f.absence('e','leave','cancelled');
 assert.deepEqual(f.rows().map(r=>[r.userId,r.status]),[['a','leave'],['b','sick']]);
 assert.deepEqual(f.rows('2026-11-21'),[]);assert.equal(f.rows('2026-11-23')[0].status,'leave');
});
test('approved absence and cancelled attendance can coexist without conflict',t=>{
 const f=fixture(t);f.member('a');f.cancel('c','a');f.absence('a','sick');
 const [row]=f.rows();assert.equal(row.status,'sick');assert.equal(row.cancellationCount,1);assert.deepEqual(row.issues,[]);
});
test('legacy inconsistent approved absence plus active attendance is flagged rather than silently counted',t=>{
 const f=fixture(t);f.member('a');f.absence('a');f.record('i','a','in','ontime','rejected');
 const [row]=f.rows();assert.equal(row.status,null);assert.ok(row.issues.includes('attendance_absence_conflict'));
});
test('missing reservation fails closed and preserves evidence',t=>{
 const f=fixture(t);f.member('a');const id=f.absence('a');
 f.db.prepare('DELETE FROM absence_day_reservations WHERE request_id=?').run(id);
 const [row]=f.rows();assert.equal(row.status,null);assert.ok(row.issues.includes('missing_absence_reservation'));
});
test('historical evidence survives deleted member and does not mix dates or leak sensitive fields',t=>{
 const f=fixture(t);f.member('a');f.member('b');f.record('i','a');f.absence('b','sick');
 f.db.exec("DELETE FROM members WHERE user_id IN ('a','b')");
 f.record('other','c','in','late','approved',{date:'2026-11-18'});
 const rows=f.rows();assert.equal(rows.length,2);
 const serialized=JSON.stringify(rows);
 for(const secret of ['Private medical reason','secret-qr','selfies/private.jpg','password_hash','storage_key'])assert.equal(serialized.includes(secret),false);
 assert.equal(f.rows('2026-11-18')[0].userId,'c');
 assert.throws(()=>f.rows('2026-02-30'),{status:400});
});
test('same name does not merge distinct members and ordering is deterministic',t=>{
 const f=fixture(t);
 f.record('b','b','in','ontime','approved',{name:'Same'});
 f.record('a','a','in','ontime','approved',{name:'Same'});
 assert.deepEqual(f.rows().map(r=>r.userId),['a','b']);
});
