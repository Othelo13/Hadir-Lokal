import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { migrateAbsenceDomain } from '../server/migrate-absence.mjs';
import { migrateMemberScheduleHistory } from '../server/migrate-member-schedule.mjs';
import { migrateAbsenceAttachments } from '../server/migrate-absence-attachments.mjs';
import { submitAbsence, transitionAbsence } from '../server/absence-service.mjs';
import { commitAttendance, authorizeAttendanceRetake } from '../server/attendance-write.mjs';
const morning=new Date('2026-11-19T01:00:00Z'),evening=new Date('2026-11-19T09:00:00Z');
const date='2026-11-19',policy={maxBackDays:3,maxRangeDays:31,minReasonLength:5,maxReasonLength:500};
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
 migrateAbsenceDomain(db);migrateMemberScheduleHistory(db);migrateAbsenceAttachments(db);
 db.exec(`INSERT INTO members VALUES('a@example.invalid','a','Member A','employee',1,'dummy');
 INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'dummy');
 INSERT INTO config VALUES(1,'[0,1,2,3,4,5,6]','09:00','17:00','Asia/Makassar',1);
 INSERT INTO codes VALUES('qr','QR',1,'2026-01-01');`);
 const auth=(id='a')=>()=>db.prepare('SELECT * FROM members WHERE user_id=? AND active=1').get(id);
 const make=(kind='in',now=morning)=>{
  const id=randomUUID(),challenge=randomUUID();
  db.prepare('INSERT INTO challenges VALUES(?,?,?)').run(challenge,'a',now.valueOf()+180000);
  return {id,userId:'a',expectedDate:date,expectedTimezone:'Asia/Makassar',kind,challenge,photo:'selfies/a/'+id+'.jpg',qr:'qr'};
 };
 const commit=(input,now=morning,authenticate=auth())=>commitAttendance(db,input,authenticate,()=>now);
 const absence=()=>submitAbsence(db,'a',{type:'sick',startDate:date,endDate:date,reason:'Izin kesehatan'},policy,morning).id;
 const approve=id=>transitionAbsence(db,'admin',id,'approve',null,policy,morning);
 const cancel=id=>transitionAbsence(db,'admin',id,'cancel','Anggota kembali masuk',policy,morning);
 const retake=id=>authorizeAttendanceRetake(db,id,'admin',auth('admin'),()=>morning);
 const cancellation=(id,kind='in',at='2026-11-19T01:00:00.000Z')=>db.prepare(`INSERT INTO attendance_cancellations
 (id,user_id,email,name,date,kind,time,reason,cancelled_by,cancelled_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
 .run(id,'a','a@example.invalid','Member A',date,kind,morning.toISOString(),'Test reason','admin',at);
 const count=()=>db.prepare('SELECT count(*) n FROM records').get().n;
 return {db,auth,make,commit,absence,approve,cancel,retake,cancellation,count};
}
test('final write derives attendance status and identity from current database and consumes challenge once',t=>{
 const f=fixture(t), input=f.make();
 f.db.exec("UPDATE members SET name='New Name' WHERE user_id='a'; UPDATE config SET start='08:00' WHERE id=1");
 const result=f.commit({...input,status:'ontime',email:'fake',date:'2000-01-01'});
 const row=f.db.prepare('SELECT * FROM records').get();
 assert.equal(result.status,'late');assert.equal(row.name,'New Name');assert.equal(row.email,'a@example.invalid');
 assert.equal(row.date,date);assert.equal(row.time,morning.toISOString());
 assert.equal(f.db.prepare('SELECT count(*) n FROM challenges').get().n,0);
 assert.throws(()=>f.commit(input),{status:409});
});
test('approved absence blocks both kinds, pending permits attendance and approval then fails',t=>{
 const f=fixture(t),id=f.absence();
 f.approve(id);
 for(const kind of ['in','out'])assert.throws(()=>f.commit(f.make(kind)),{status:409});
 f.cancel(id);const next=f.absence();f.commit(f.make());
 assert.throws(()=>f.approve(next),{status:409});
 assert.equal(f.db.prepare('SELECT status FROM absence_requests WHERE id=?').get(next).status,'pending');
});
test('final write rejects changed role, inactive member and revoked session',t=>{
 const f=fixture(t),input=f.make();
 f.db.exec("UPDATE members SET role='admin' WHERE user_id='a'");
 assert.throws(()=>f.commit(input),{status:403});
 f.db.exec("UPDATE members SET role='employee',active=0 WHERE user_id='a'");
 assert.throws(()=>f.commit(input),{status:401});
 f.db.exec("UPDATE members SET active=1 WHERE user_id='a'");
 assert.throws(()=>f.commit(input,morning,()=>null),{status:401});
 assert.equal(f.count(),0);
});
test('final write rechecks schedule, late rule, office date and timezone',t=>{
 const f=fixture(t),input=f.make();
 f.db.exec("UPDATE config SET days='[0]' WHERE id=1");
 assert.throws(()=>f.commit(input),{status:400});
 f.db.exec("UPDATE config SET days='[0,1,2,3,4,5,6]',start='08:00',allow_late=0 WHERE id=1");
 assert.throws(()=>f.commit(input),{status:400});
 f.db.exec("UPDATE config SET timezone='Asia/Jakarta' WHERE id=1");
 assert.throws(()=>f.commit(input),{status:409});
 f.db.exec("UPDATE config SET timezone='Asia/Makassar' WHERE id=1");
 assert.throws(()=>f.commit(input,new Date('2026-11-20T01:00:00Z')),{status:409});
 assert.equal(f.count(),0);
});
test('checkout requires current check-in and current closing hour',t=>{
 const f=fixture(t),out=f.make('out',evening);
 assert.throws(()=>f.commit(out,evening),{status:400});
 f.commit(f.make());
 assert.throws(()=>f.commit(f.make('out'),morning),{status:400});
 f.db.exec("DELETE FROM records WHERE kind='in'");
 assert.throws(()=>f.commit(out,evening),{status:400});
 f.commit(f.make());f.commit(out,evening);
 assert.equal(f.count(),2);
});
test('QR deactivation and expired or foreign challenge prevent insert',t=>{
 const f=fixture(t),input=f.make();
 f.db.exec("UPDATE codes SET active=0");
 assert.throws(()=>f.commit(input),{status:400});
 f.db.exec("UPDATE codes SET active=1");
 assert.throws(()=>f.commit({...input,challenge:'missing'}),{status:400});
 f.db.prepare('UPDATE challenges SET expires=? WHERE id=?').run(morning.valueOf(),input.challenge);
 assert.throws(()=>f.commit(input),{status:400});
 f.db.prepare('UPDATE challenges SET user_id=?,expires=? WHERE id=?').run('admin',morning.valueOf()+1000,input.challenge);
 assert.throws(()=>f.commit(input),{status:400});
 assert.equal(f.count(),0);
});
test('latest cancellation requires authorization and approved absence prevents retake',t=>{
 const f=fixture(t);
 f.cancellation('old');f.cancellation('new');
 assert.throws(()=>f.retake('old'),{status:409});
 assert.throws(()=>f.commit(f.make()),{status:403});
 const id=f.absence();f.approve(id);
 assert.throws(()=>f.retake('new'),{status:409});
 f.cancel(id);f.retake('new');f.retake('new');
 f.commit(f.make());assert.equal(f.count(),1);
});
test('retake rejects stale admin or inactive target and preserves authorization history',t=>{
 const f=fixture(t);f.cancellation('c');
 assert.throws(()=>authorizeAttendanceRetake(f.db,'c','admin',()=>null,()=>morning),{status:401});
 f.db.exec("UPDATE members SET active=0 WHERE user_id='a'");
 assert.throws(()=>f.retake('c'),{status:409});
 assert.equal(f.db.prepare("SELECT retry_authorized_at FROM attendance_cancellations WHERE id='c'").get().retry_authorized_at,null);
});
test('insert failure rolls back challenge consumption and attendance',t=>{
 const f=fixture(t),input=f.make();
 f.db.exec("CREATE TRIGGER test_record_failure BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT,'test failure'); END");
 assert.throws(()=>f.commit(input));assert.equal(f.count(),0);
 assert.ok(f.db.prepare('SELECT id FROM challenges WHERE id=?').get(input.challenge));
 f.db.exec('DROP TRIGGER test_record_failure');f.commit(input);assert.equal(f.count(),1);
});
