import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {migrateAbsenceDomain} from '../server/migrate-absence.mjs';
import {migrateMemberScheduleHistory} from '../server/migrate-member-schedule.mjs';
import {migrateAbsenceAttachments} from '../server/migrate-absence-attachments.mjs';
import {handleMemberRecap} from '../server/member-recap.mjs';
import {formatRecapTime} from '../src/recap-presentation.ts';

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
 const missing=f.read('2026-11-19').rows[0].days[0];
 assert.equal(missing.checkIn,null);assert.equal(missing.checkOut,null);
 assert.equal(formatRecapTime(missing.checkIn),'—');
 const future=f.read('2026-11-25').rows[0].days[0];
 assert.equal(future.state,'future');assert.equal(future.checkIn,null);assert.equal(future.checkOut,null);
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
