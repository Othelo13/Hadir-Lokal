import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync as load } from 'node:fs';
import { migrateAbsenceDomain } from '../server/migrate-absence.mjs';
import { migrateMemberScheduleHistory } from '../server/migrate-member-schedule.mjs';
import { migrateAbsenceAttachments } from '../server/migrate-absence-attachments.mjs';
import { handleMemberRecap } from '../server/member-recap.mjs';

test('member recap table contains only the four requested attendance status columns',()=>{
 const source=readFileSync(new URL('../src/MemberRecapTable.tsx',import.meta.url),'utf8');
 for(const label of ['Anggota','Hadir','Tidak hadir','Izin','Sakit']){
  assert.ok(source.includes('<th>'+label+'</th>'), 'Missing column '+label);
 }
 assert.doesNotMatch(source,/<th>Perlu tinjauan<\/th>/);
 assert.doesNotMatch(source,/className="member-cell-label">Perlu tinjauan/);
 assert.doesNotMatch(source,/\['Perlu tinjauan',member\.pending\]/);
 assert.match(source,/onClick=\{\(\)=>setSelected\(row\.userId\)\}/);
});

test('detail summary grid adapts to four categories on desktop',()=>{
 const css=readFileSync(new URL('../src/member-recap-period.css',import.meta.url),'utf8');
 assert.match(css,/\.member-recap-totals\s*\{[^}]*repeat\(4,minmax\(0,1fr\)\)/);
});

test('hidden pending column does not make an unapproved absence count as a confirmed absence',t=>{
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(load(new URL('../server/schema.sql',import.meta.url),'utf8'));
 migrateAbsenceDomain(db);
 migrateMemberScheduleHistory(db);
 migrateAbsenceAttachments(db);
 const coverage='2026-11-17T00:00:00.000Z';
 db.prepare("UPDATE schema_migrations SET applied_at=? WHERE id='002-member-schedule-history'").run(coverage);
 db.exec(`INSERT INTO config VALUES(1,'[1,2,3,4,5]','09:00','17:00','Asia/Makassar',1);
 INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'dummy');
 INSERT INTO members VALUES('intern@example.invalid','intern','Intern','employee',1,'dummy');`);
 db.prepare(`INSERT INTO schedule_history(config_id,days,start,end,timezone,allow_late,event_type,recorded_at)
 VALUES(1,'[1,2,3,4,5]','09:00','17:00','Asia/Makassar',1,'baseline',?)`).run(coverage);
 db.prepare(`INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
 VALUES('intern','Intern','intern@example.invalid','employee',1,'baseline',?)`).run(coverage);
 db.exec(`INSERT INTO absence_requests(id,user_id,name_snapshot,email_snapshot,type,start_date,end_date,reason,status,office_timezone,schedule_snapshot,created_at,updated_at)
 VALUES('req','intern','Intern','intern@example.invalid','sick','2026-11-18','2026-11-18','Private evidence','pending','Asia/Makassar','[1,2,3,4,5]','2026-11-18T00:00:00Z','2026-11-18T00:00:00Z');
 INSERT INTO absence_request_days VALUES('req','2026-11-18');`);
 const auth=()=>db.prepare("SELECT * FROM members WHERE user_id='admin'").get();
 const result=handleMemberRecap(db,'admin','GET',new URLSearchParams({period:'day',date:'2026-11-18'}),auth,()=>new Date('2026-11-20T02:00:00Z'));
 assert.equal(result.rows.length,1);
 const row=result.rows[0];
 assert.deepEqual([row.present,row.absent,row.leave,row.sick],[0,0,0,0]);
 assert.equal(row.pending,1);
 assert.equal(row.days[0].state,'pending');
});
