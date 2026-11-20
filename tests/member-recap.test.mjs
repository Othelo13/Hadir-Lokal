import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {migrateAbsenceDomain} from '../server/migrate-absence.mjs';
import {migrateMemberScheduleHistory} from '../server/migrate-member-schedule.mjs';
import {migrateAbsenceAttachments} from '../server/migrate-absence-attachments.mjs';
import {handleMemberRecap} from '../server/member-recap.mjs';

const coverage='2026-11-17T00:00:00.000Z';
const current=new Date('2026-11-20T02:00:00.000Z');
function fixture(t){
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
 migrateAbsenceDomain(db);
 migrateMemberScheduleHistory(db);
 migrateAbsenceAttachments(db);
 db.prepare("UPDATE schema_migrations SET applied_at=? WHERE id='002-member-schedule-history'").run(coverage);
 db.exec(`INSERT INTO config VALUES(1,'[1,2,3,4,5]','09:00','17:00','Asia/Makassar',1);
 INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'dummy');
 INSERT INTO members VALUES('alice@example.invalid','alice','Alice','employee',1,'dummy');
 INSERT INTO members VALUES('bob@example.invalid','bob','Bob','employee',1,'dummy');
 INSERT INTO members VALUES('inactive@example.invalid','inactive','Inactive','employee',0,'dummy');`);
 db.prepare(`INSERT INTO schedule_history(config_id,days,start,end,timezone,allow_late,event_type,recorded_at)
 VALUES(1,'[1,2,3,4,5]','09:00','17:00','Asia/Makassar',1,'baseline',?)`).run(coverage);
 for(const id of ['alice','bob','inactive']){
  db.prepare(`INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
  VALUES(?,?,?,'employee',?,'baseline',?)`).run(id,id,id+'@example.invalid',id==='inactive'?0:1,coverage);
 }
 const auth=()=>db.prepare("SELECT * FROM members WHERE user_id='admin'").get();
 const read=(q={},authenticate=auth)=>handleMemberRecap(db,'admin','GET',new URLSearchParams(q),authenticate,()=>current);
 function attendance(id,date,status='ontime'){
  db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
   'record-'+id+'-'+date,id,id+'@example.invalid',id,date,'in',date+'T01:00:00Z',status,'private.jpg','qr','approved');
 }
 function absence(id,date,type='leave',status='approved'){
  const req='request-'+id+'-'+date;
  db.prepare(`INSERT INTO absence_requests(id,user_id,name_snapshot,email_snapshot,type,start_date,end_date,reason,status,office_timezone,schedule_snapshot,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,'Sensitive diagnosis',?,'Asia/Makassar','[1,2,3,4,5]',?,?)`)
  .run(req,id,id,id+'@example.invalid',type,date,date,status,coverage,coverage);
  db.prepare('INSERT INTO absence_request_days VALUES(?,?)').run(req,date);
  if(status==='approved')db.prepare('INSERT INTO absence_day_reservations VALUES(?,?,?)').run(id,date,req);
 }
 return {db,auth,read,attendance,absence};
}
test('includes active interns even without records, excluding admin and inactive accounts',t=>{
 const f=fixture(t),result=f.read();
 assert.deepEqual(result.rows.map(r=>r.userId),['alice','bob']);
 assert.equal(result.month,'2026-11');
 assert.equal(result.total,2);
 assert.equal(JSON.stringify(result).includes('password_hash'),false);
});
test('counts attended late approved leave and sick independently over completed dates',t=>{
 const f=fixture(t);
 f.attendance('alice','2026-11-17');
 f.attendance('alice','2026-11-18','late');
 f.absence('alice','2026-11-19','leave');
 f.absence('alice','2026-11-20','sick');
 const a=f.read().rows[0];
 assert.deepEqual([a.present,a.late,a.absent,a.leave,a.sick],[2,1,0,1,1]);
 assert.equal(a.pending,0);
 assert.equal(JSON.stringify(f.read()).includes('Sensitive diagnosis'),false);
});
test('missing finished working dates count as absent but current date never does',t=>{
 const f=fixture(t),row=f.read().rows[0];
 assert.equal(row.absent,2); // Nov 18–19; migration day Nov 17 has partial coverage
 assert.equal(row.present,0);
 assert.equal(row.pending,0);
 assert.equal(f.read().verifiedWorkdays,2);
});
test('pending leave is not mistaken for a confirmed absence',t=>{
 const f=fixture(t);f.absence('bob','2026-11-18','leave','pending');
 const bob=f.read().rows.find(row=>row.userId==='bob');
 assert.equal(bob.pending,1);
 assert.equal(bob.absent,1);
});
test('historical coverage before migration is not counted as absence',t=>{
 const f=fixture(t),result=f.read();
 assert.ok(result.unverifiedDates>0);
 assert.equal(result.rows[0].absent,2);
});
test('future months return current employees with zeroes but no projected absence',t=>{
 const f=fixture(t),result=f.read({month:'2026-12'});
 assert.equal(result.rows.length,2);
 assert.ok(result.rows.every(r=>!r.present&&!r.absent&&!r.leave&&!r.sick));
});
test('search and paging happen over members, not daily attendance records',t=>{
 const f=fixture(t),result=f.read({q:' BOB@EXAMPLE.INVALID ',page:'5'});
 assert.equal(result.total,1);assert.equal(result.rows[0].userId,'bob');
 assert.equal(result.page,1);assert.equal(result.totalPages,1);
});
test('invalid month, size, search and duplicate parameters fail closed',t=>{
 const f=fixture(t);
 for(const q of [{month:'2026-13'},{month:'2026-1'},{month:'9999-01'},{page:'0'},{pageSize:'30'},
  {q:'x'.repeat(101)},{q:'x\n'},{month:['2026-11','2026-11']},{unexpected:'x'}]){
  assert.throws(()=>f.read(q),{status:400});
 }
});
test('live active admin session is required for month summary',t=>{
 const f=fixture(t);
 assert.throws(()=>f.read({},()=>null),{status:401});
 assert.throws(()=>f.read({},()=>({...f.auth(),role:'employee'})),{status:403});
 assert.throws(()=>handleMemberRecap(f.db,'admin','POST',new URLSearchParams(),f.auth),{status:405});
 assert.equal(f.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('daily period reports selected date and one day for each active intern',t=>{
 const f=fixture(t);f.attendance('alice','2026-11-18','late');
 const r=f.read({period:'day',date:'2026-11-18'});
 assert.equal(r.period,'day');assert.equal(r.startDate,'2026-11-18');
 assert.equal(r.endDate,'2026-11-18');assert.equal(r.rows.length,2);
 assert.deepEqual([r.rows[0].present,r.rows[0].late,r.rows[0].absent],[1,1,0]);
 assert.deepEqual(r.rows[0].days,[{date:'2026-11-18',state:'present',late:true,hasDetail:true}]);
 assert.equal(r.rows[1].absent,1);
});
test('weekly period spans Monday through Sunday even across calendar months',t=>{
 const f=fixture(t);
 const current=f.read({period:'week',date:'2026-11-20'});
 assert.deepEqual([current.startDate,current.endDate],['2026-11-16','2026-11-22']);
 assert.equal(current.rows[0].days.length,7);
 assert.equal(current.rows[0].days.find(d=>d.date==='2026-11-20').state,'ongoing');
 assert.equal(current.rows[0].days.find(d=>d.date==='2026-11-22').state,'future');
 const cross=f.read({period:'week',date:'2026-11-01'});
 assert.deepEqual([cross.startDate,cross.endDate],['2026-10-26','2026-11-01']);
});
test('weekly and monthly totals agree for fully covered workdays',t=>{
 const f=fixture(t);
 f.attendance('alice','2026-11-18','late');
 f.absence('alice','2026-11-19','leave');
 const week=f.read({period:'week',date:'2026-11-20'});
 const month=f.read({period:'month',month:'2026-11'});
 assert.deepEqual([week.rows[0].present,week.rows[0].late,week.rows[0].leave,week.rows[0].absent],
  [month.rows[0].present,month.rows[0].late,month.rows[0].leave,month.rows[0].absent]);
});
test('pending approvals are not reclassified as absent in a single day',t=>{
 const f=fixture(t);f.absence('bob','2026-11-18','sick','pending');
 const day=f.read({period:'day',date:'2026-11-18'});
 const bob=day.rows.find(row=>row.userId==='bob');
 assert.equal(bob.pending,1);assert.equal(bob.absent,0);
 assert.equal(bob.days[0].state,'pending');
});
test('historical coverage before migration never creates a false absence',t=>{
 const f=fixture(t);
 const result=f.read({period:'day',date:'2026-11-16'});
 assert.equal(result.unverifiedDates,1);
 assert.equal(result.rows[0].absent,0);
 assert.equal(result.rows[0].days[0].state,'unknown');
});
test('malformed period parameters and cross-mode filters fail before reporting',t=>{
 const f=fixture(t);
 for(const params of [
  {period:'quarter'},{period:'day',date:'2026-02-30'},
  {period:'week',month:'2026-11'},{period:'month',date:'2026-11-20'},
  {period:['day','month']},{period:'week',date:'9999-01-01'},
 ])assert.throws(()=>f.read(params),{status:400});
});
