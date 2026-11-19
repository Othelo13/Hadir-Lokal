import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { migrateAbsenceDomain } from '../server/migrate-absence.mjs';
import { migrateMemberScheduleHistory } from '../server/migrate-member-schedule.mjs';
import { migrateAbsenceAttachments } from '../server/migrate-absence-attachments.mjs';
import { handleDailyRecap } from '../server/daily-recap-api.mjs';
import { handleDailyRecapDetail } from '../server/daily-recap-detail.mjs';
import { submitAbsence,transitionAbsence } from '../server/absence-service.mjs';

const date='2026-11-19',coverage='2026-11-17T00:00:00.000Z',now=new Date('2026-11-20T02:00:00.000Z');
const policy={maxBackDays:3,maxRangeDays:31,minReasonLength:5,maxReasonLength:500};
function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'hadir-recap-snapshot-')),file=path.join(dir,'hadir.sqlite');
 const db=new DatabaseSync(file);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
 db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
 migrateAbsenceDomain(db);migrateMemberScheduleHistory(db);migrateAbsenceAttachments(db);
 const writer=new DatabaseSync(file);
 writer.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
 t.after(()=>{writer.close();db.close();rmSync(dir,{recursive:true,force:true});});
 db.prepare("UPDATE schema_migrations SET applied_at=? WHERE id='002-member-schedule-history'").run(coverage);
 db.exec(`INSERT INTO config VALUES(1,'[1,2,3,4,5]','09:00','17:00','Asia/Makassar',1);
 INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'dummy');
 INSERT INTO members VALUES('a@example.invalid','a','A','employee',1,'dummy');`);
 db.prepare(`INSERT INTO schedule_history(config_id,days,start,end,timezone,allow_late,event_type,recorded_at)
 VALUES(1,'[1,2,3,4,5]','09:00','17:00','Asia/Makassar',1,'baseline',?)`).run(coverage);
 db.prepare(`INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
 VALUES('a','A','a@example.invalid','employee',1,'baseline',?)`).run(coverage);
 const auth=()=>db.prepare("SELECT * FROM members WHERE user_id='admin' AND active=1").get();
 const list=(authenticate=auth,params={date})=>handleDailyRecap(db,'admin','GET',new URLSearchParams(params),authenticate,()=>now);
 const detail=(authenticate=auth,userId='a')=>handleDailyRecapDetail(db,'admin','GET',new URLSearchParams({date,userId}),authenticate,()=>now);
 const pending=()=>submitAbsence(db,'a',{type:'sick',startDate:date,endDate:date,reason:'Synthetic reason'},policy,new Date(date+'T01:00:00Z')).id;
 const approve=id=>transitionAbsence(writer,'admin',id,'approve',null,policy,new Date(date+'T02:00:00Z'));
 const cancel=id=>transitionAbsence(writer,'admin',id,'cancel','Synthetic cancellation',policy,new Date(date+'T03:00:00Z'));
 return {db,writer,auth,list,detail,pending,approve,cancel};
}
test('recap snapshot does not mix pre-approval and post-approval state across WAL connections',t=>{
 const f=fixture(t),id=f.pending();
 const before=f.list(()=>{
  const actor=f.auth(); // first SELECT establishes the read snapshot
  f.approve(id); // another connection commits while reader is open
  return actor;
 });
 assert.equal(before.rows[0].status,null);
 assert.equal(before.rows[0].absence,null);
 const after=f.list();
 assert.equal(after.rows[0].status,'sick');
 assert.equal(after.rows[0].absence.id,id);
 assert.equal(f.writer.prepare('SELECT status FROM absence_requests WHERE id=?').get(id).status,'approved');
});
test('detail snapshot keeps summary, approval, reservation and audit consistent during cancellation',t=>{
 const f=fixture(t),id=f.pending();f.approve(id);
 const before=f.detail(()=>{
  const actor=f.auth();
  f.cancel(id);
  return actor;
 });
 assert.equal(before.summary.status,'sick');
 assert.equal(before.absences[0].status,'approved');
 assert.equal(before.absences[0].reserved,true);
 assert.equal(before.absences[0].history.at(-1).to_status,'approved');
 const after=f.detail();
 assert.equal(after.summary.status,null);
 assert.equal(after.absences[0].status,'cancelled');
 assert.equal(after.absences[0].reserved,false);
 assert.equal(after.absences[0].history.at(-1).to_status,'cancelled');
});
test('uncommitted writer changes are invisible to recap and rollback does not alter results',t=>{
 const f=fixture(t),before=f.list();
 f.writer.exec('BEGIN IMMEDIATE');
 try{
  f.writer.prepare(`INSERT INTO records VALUES('temp','a','a@example.invalid','A',?,'in',?,'late','private.jpg','qr','pending')`).run(date,date+'T01:00:00Z');
  const during=f.list();assert.deepEqual(during,before);
 }finally{f.writer.exec('ROLLBACK');}
 assert.deepEqual(f.list(),before);
 assert.equal(f.db.prepare('SELECT count(*) n FROM records').get().n,0);
});
test('recap and detail remain read-only with 3000 historical members and distinct event timestamps',t=>{
 const f=fixture(t),count=3000;
 const member=f.db.prepare(`INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
 VALUES(?,?,?,'employee',1,'baseline',?)`);
 const record=f.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 f.db.exec('BEGIN IMMEDIATE');
 try{
  for(let i=0;i<count;i++){
   const id='synthetic-'+String(i).padStart(4,'0'),time=new Date(Date.parse(date+'T00:00:00Z')+i*1000).toISOString();
   member.run(id,id,id+'@example.invalid',coverage);
   record.run('r-'+id,id,id+'@example.invalid',id,date,'in',time,i%2?'late':'ontime','private.jpg','qr','approved');
  }
  f.db.exec('COMMIT');
 }catch(e){f.db.exec('ROLLBACK');throw e;}
 const changes=f.db.prepare('SELECT total_changes() n').get().n;
 const start=performance.now(),list=f.list(f.auth,{date,pageSize:'50',page:'61'}),listMs=performance.now()-start;
 const detailStart=performance.now(),detail=f.detail(f.auth,'synthetic-2999'),detailMs=performance.now()-detailStart;
 assert.equal(list.total,count+1);assert.equal(list.totalPages,61);
 assert.equal(list.rows.length,1);assert.equal(list.rows[0].userId,'synthetic-2999');
 assert.deepEqual(detail.summary,list.rows[0]);assert.equal(detail.records.length,1);
 assert.equal(detail.summary.status,'late');
 assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(f.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 t.diagnostic('Synthetic 3001-row recap: '+listMs.toFixed(2)+' ms; detail: '+detailMs.toFixed(2)+' ms (local handler timings, no HTTP/network).');
});
