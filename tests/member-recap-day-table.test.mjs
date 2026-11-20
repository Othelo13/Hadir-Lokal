import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {migrateAbsenceDomain} from '../server/migrate-absence.mjs';
import {migrateMemberScheduleHistory} from '../server/migrate-member-schedule.mjs';
import {migrateAbsenceAttachments} from '../server/migrate-absence-attachments.mjs';
import {handleMemberRecap} from '../server/member-recap.mjs';
import {formatRecapTime} from '../src/recap-presentation.ts';
import {buildAttendanceExcel} from '../src/excel-export.ts';

function fixture(t) {
 const db=new DatabaseSync(':memory:'); t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
 migrateAbsenceDomain(db);migrateMemberScheduleHistory(db);migrateAbsenceAttachments(db);
 const coverage='2026-11-17T00:00:00.000Z';
 db.prepare("UPDATE schema_migrations SET applied_at=? WHERE id='002-member-schedule-history'").run(coverage);
 db.exec(`INSERT INTO config VALUES(1,'[1,2,3,4,5]','09:00','17:00','Asia/Makassar',1);
 INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'dummy');
 INSERT INTO members VALUES('intern@example.invalid','intern','Intern','employee',1,'dummy');`);
 db.prepare(`INSERT INTO schedule_history(config_id,days,start,end,timezone,allow_late,event_type,recorded_at)
 VALUES(1,'[1,2,3,4,5]','09:00','17:00','Asia/Makassar',1,'baseline',?)`).run(coverage);
 db.prepare(`INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
 VALUES('intern','Intern','intern@example.invalid','employee',1,'baseline',?)`).run(coverage);
 const read=(date)=>handleMemberRecap(db,'admin','GET',
  new URLSearchParams({period:'day',date}),
  ()=>db.prepare("SELECT * FROM members WHERE user_id='admin'").get(),
  ()=>new Date('2026-11-20T02:00:00Z'));
 return {db,read};
}
test('sanitized check-in/check-out times are displayed in historical office timezone',t=>{
 const f=fixture(t),date='2026-11-18';
 const insert=f.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 insert.run('secret-id-in','intern','intern@example.invalid','Intern',date,'in',date+'T01:00:00Z','ontime','private-in.jpg','qr','approved');
 insert.run('secret-id-out','intern','intern@example.invalid','Intern',date,'out',date+'T09:00:00Z','ontime','private-out.jpg','qr','approved');
 const response=f.read(date),day=response.rows[0].days[0];
 assert.equal(day.state,'present');
 assert.deepEqual(day.checkIn,{time:date+'T01:00:00Z',timezone:'Asia/Makassar'});
 assert.deepEqual(day.checkOut,{time:date+'T09:00:00Z',timezone:'Asia/Makassar'});
 assert.equal(formatRecapTime(day.checkIn),'09:00');
 assert.equal(formatRecapTime(day.checkOut),'17:00');
 for(const secret of ['secret-id-in','secret-id-out','private-in.jpg','private-out.jpg','qr'])
  assert.equal(JSON.stringify(response).includes(secret),false);
});
test('missing and future timestamps stay empty, no invented clock values',t=>{
 const f=fixture(t);
 assert.equal(f.read('2026-11-19').rows[0].days.length,0);
 assert.equal(f.read('2026-11-25').rows[0].days.length,0);
 assert.equal(formatRecapTime(null),'—');
});
test('pending check-in timestamp does not turn pending review into confirmed presence',t=>{
 const f=fixture(t),date='2026-11-18';
 f.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
  'pending-in','intern','intern@example.invalid','Intern',date,'in',date+'T01:00:00Z','ontime','private.jpg','qr','pending');
 const day=f.read(date).rows[0].days[0];
 assert.equal(day.state,'pending');assert.equal(day.checkIn?.time,date+'T01:00:00Z');
});
test('detail table shows four requested headers and retains keyboard-openable daily details',()=>{
 const jsx=readFileSync(new URL('../src/MemberRecapTable.tsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../src/member-recap-period.css',import.meta.url),'utf8');
 for(const label of ['Tanggal','Waktu absen masuk','Waktu absen keluar','Status'])
  assert.ok(jsx.includes('<th scope="col">'+label+'</th>'),label);
 assert.match(jsx,/formatRecapTime\(day\.checkIn\)/);
 assert.match(jsx,/formatRecapTime\(day\.checkOut\)/);
 assert.match(jsx,/onClick=\{day\.hasDetail\?\(\)=>setSelectedDay\(day\.date\):undefined\}/);
 assert.match(css,/\.member-recap-day-table thead/);
 assert.doesNotMatch(jsx,/className="member-recap-day-list"/);
});

test('completed unsaved workdays increase absent totals without appearing in recorded-day detail',t=>{
 const f=fixture(t);
 const summary=f.read('2026-11-19').rows[0];
 assert.equal(summary.absent,1);
 assert.deepEqual(summary.days,[]);
});
test('approved leave and pending request dates appear as stored detail rows',t=>{
 const f=fixture(t),date='2026-11-18';
 f.db.exec(`INSERT INTO absence_requests(id,user_id,name_snapshot,email_snapshot,type,start_date,end_date,reason,status,office_timezone,schedule_snapshot,created_at,updated_at)
 VALUES('leave-1','intern','Intern','intern@example.invalid','leave','2026-11-18','2026-11-18','private','approved','Asia/Makassar','[1,2,3,4,5]','2026-11-17T01:00:00Z','2026-11-17T01:00:00Z');
 INSERT INTO absence_request_days VALUES('leave-1','2026-11-18');
 INSERT INTO absence_day_reservations VALUES('intern','2026-11-18','leave-1');`);
 const approved=f.read(date).rows[0];
 assert.equal(approved.leave,1);assert.deepEqual(approved.days.map(x=>x.date),[date]);
 assert.equal(approved.days[0].state,'leave');
 const another='2026-11-19';
 f.db.exec(`INSERT INTO absence_requests(id,user_id,name_snapshot,email_snapshot,type,start_date,end_date,reason,status,office_timezone,schedule_snapshot,created_at,updated_at)
 VALUES('pending-1','intern','Intern','intern@example.invalid','sick','2026-11-19','2026-11-19','private','pending','Asia/Makassar','[1,2,3,4,5]','2026-11-18T01:00:00Z','2026-11-18T01:00:00Z');
 INSERT INTO absence_request_days VALUES('pending-1','2026-11-19');`);
 const pending=f.read(another).rows[0];
 assert.equal(pending.pending,1);assert.deepEqual(pending.days.map(x=>x.date),[another]);
 assert.equal(pending.days[0].state,'pending');
});
test('cancelled attendance has real audit evidence and remains visible without active time',t=>{
 const f=fixture(t),date='2026-11-18';
 f.db.prepare(`INSERT INTO attendance_cancellations
 (id,user_id,email,name,date,kind,time,reason,cancelled_by,cancelled_at)
 VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
 'cancel-1','intern','intern@example.invalid','Intern',date,'in',
 date+'T01:00:00Z','Audit reason','admin','2026-11-18T10:00:00Z');
 const detail=f.read(date).rows[0];
 assert.equal(detail.absent,1); // unchanged classification
 assert.equal(detail.days.length,1);assert.equal(detail.days[0].hasDetail,true);
 assert.equal(detail.days[0].checkIn,null);
 assert.equal(JSON.stringify(detail).includes('Audit reason'),false);
});
test('empty detail displays a table empty state and not generated date rows',()=>{
 const jsx=readFileSync(new URL('../src/MemberRecapTable.tsx',import.meta.url),'utf8');
 assert.match(jsx,/member\.days\.length===0/);
 assert.match(jsx,/Belum ada catatan absensi, izin, atau sakit pada periode ini/);
});

test('legacy UTC clock stays explicit in recap display and Excel without guessing current office timezone',()=>{
 const legacy={time:'2026-10-31T06:09:29.466Z',timezone:null};
 assert.equal(formatRecapTime(legacy),'06:09 UTC');
 const bytes=buildAttendanceExcel([{
  id:'record-1',user_id:'intern',name:'Intern',email:'intern@example.invalid',
  date:'2026-10-31',kind:'in',time:legacy.time,timezone:null,status:'late',review:'approved'
 }],{timezone:'Asia/Makassar'});
 const workbook=new TextDecoder().decode(bytes);
 assert.match(workbook,/06[.:]09 UTC/);
 assert.doesNotMatch(workbook,/14[.:]09/);
 const history=readFileSync(new URL('../src/ui.tsx',import.meta.url),'utf8');
 assert.match(history,/fmtTime\(r\.time, r\.timezone\)/);
});
