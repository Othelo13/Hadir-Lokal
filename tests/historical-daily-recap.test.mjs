import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { migrateAbsenceDomain } from '../server/migrate-absence.mjs';
import { migrateMemberScheduleHistory } from '../server/migrate-member-schedule.mjs';
import { migrateAbsenceAttachments } from '../server/migrate-absence-attachments.mjs';
import { historicalDailyRecap,recapDayContext } from '../server/historical-daily-recap.mjs';
const date='2026-11-19',now=new Date('2026-11-22T12:00:00Z');
function fixture(t,coverage='2026-11-17T00:00:00.000Z'){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
 migrateAbsenceDomain(db);migrateMemberScheduleHistory(db);migrateAbsenceAttachments(db);
 db.prepare("UPDATE schema_migrations SET applied_at=? WHERE id='002-member-schedule-history'").run(coverage);
 const member=(id,at=coverage,opts={})=>db.prepare(`INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
 VALUES(?,?,?,?,?,?,?)`).run(id,opts.name??id,opts.email??id+'@example.invalid',opts.role??'employee',opts.active??1,opts.event??'baseline',at);
 const schedule=(at=coverage,opts={})=>db.prepare(`INSERT INTO schedule_history(config_id,days,start,end,timezone,allow_late,event_type,recorded_at)
 VALUES(1,?,?,?,?,?,?,?)`).run(JSON.stringify(opts.days??[1,2,3,4,5]),opts.start??'09:00',opts.end??'17:00',opts.zone??'Asia/Makassar',opts.late??1,opts.event??'baseline',at);
 const record=(id,day=date,opts={})=>db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('r-'+id,id,opts.email??id+'@example.invalid',opts.name??id,day,'in',opts.time??day+'T01:00:00.000Z',opts.status??'ontime','private.jpg','private-qr','approved');
 const recap=(day=date,clock=now)=>historicalDailyRecap(db,day,clock);
 return {db,member,schedule,record,recap};
}
test('known working day includes eligible employees without attendance and excludes admins/inactive',t=>{
 const f=fixture(t);f.schedule();f.member('a');f.member('b');f.member('admin',undefined,{role:'admin'});f.member('inactive',undefined,{active:0});f.record('a');
 const result=f.recap();
 assert.equal(result.context.coverage,'complete');assert.equal(result.context.workday,true);
 assert.equal(result.context.asOf,'2026-11-19T15:59:59.999Z');
 assert.deepEqual(result.rows.map(r=>[r.userId,r.status,r.eligible,r.hasEvidence]),[['a','present',true,true],['b',null,true,false]]);
});
test('join date and deletion are evaluated at the end of the requested local day',t=>{
 const f=fixture(t);f.schedule();f.member('new','2026-11-20T01:00:00.000Z',{event:'created'});
 f.member('old');f.member('old','2026-11-20T01:00:00.000Z',{event:'deleted'});f.record('old','2026-11-20');
 assert.deepEqual(f.recap().rows.map(r=>r.userId),['old']);
 assert.deepEqual(f.recap('2026-11-20').rows.map(r=>[r.userId,r.eligible,r.hasEvidence]),[['new',true,false],['old',false,true]]);
});
test('rename and role change use historical snapshots and never erase evidence',t=>{
 const f=fixture(t);f.schedule();f.member('a',undefined,{name:'Old name'});
 f.member('a','2026-11-20T03:00:00.000Z',{name:'New name',role:'admin',event:'updated'});f.record('a','2026-11-20',{name:'Attendance snapshot'});
 assert.equal(f.recap().rows[0].name,'Old name');
 const [row]=f.recap('2026-11-20').rows;assert.equal(row.name,'New name');assert.equal(row.eligible,false);assert.equal(row.status,'present');
});
test('schedule edits do not rewrite past working days or stored attendance classification',t=>{
 const f=fixture(t);f.schedule();f.member('a');
 f.schedule('2026-11-20T01:00:00.000Z',{days:[1,2,3,4],start:'10:00',event:'updated'});
 f.record('a','2026-11-20',{status:'late'});
 assert.equal(f.recap().context.schedule.start,'09:00');assert.equal(f.recap().rows[0].eligible,true);
 const result=f.recap('2026-11-20');assert.equal(result.context.workday,false);
 assert.equal(result.context.schedule.start,'10:00');assert.equal(result.rows[0].status,'late');assert.equal(result.rows[0].eligible,false);
});
test('nonworking date excludes empty roster but preserves attendance evidence',t=>{
 const f=fixture(t);f.schedule();f.member('a');f.member('b');f.record('b','2026-11-21');
 const result=f.recap('2026-11-21');assert.equal(result.context.workday,false);assert.deepEqual(result.rows.map(r=>r.userId),['b']);
});
test('precoverage date retains evidence without invented roster or timezone',t=>{
 const f=fixture(t);f.schedule();f.member('a');f.record('legacy','2026-11-16');
 const result=f.recap('2026-11-16');
 assert.equal(result.context.coverage,'unknown');assert.equal(result.context.rosterKnown,false);
 assert.deepEqual(result.rows.map(r=>r.userId),['legacy']);assert.equal(result.rows[0].eligible,null);
 assert.equal(result.rows[0].checkIn.timezone,null);assert.equal(result.rows[0].identitySource,'evidence');
});
test('migration-day coverage is marked partial and only known members are included',t=>{
 const f=fixture(t,'2026-11-19T08:00:00.000Z');f.schedule();f.member('a');
 f.record('legacy',date,{time:'2026-11-19T00:00:00.000Z'});
 const result=f.recap();assert.equal(result.context.coverage,'partial');assert.equal(result.context.rosterKnown,true);
 assert.equal(result.rows.find(r=>r.userId==='legacy').checkIn.timezone,null);
 assert.equal(result.rows.find(r=>r.userId==='a').hasEvidence,false);
});
test('today is capped at the supplied server clock and future roster is not predicted',t=>{
 const f=fixture(t);f.schedule();f.member('a');f.member('b','2026-11-19T08:00:00.000Z',{event:'created'});
 const clock=new Date('2026-11-19T02:00:00.000Z');
 assert.equal(f.recap(date,clock).context.asOf,clock.toISOString());
 assert.deepEqual(f.recap(date,clock).rows.map(r=>r.userId),['a']);
 assert.equal(f.recap('2026-11-20',clock).context.coverage,'future');assert.deepEqual(f.recap('2026-11-20',clock).rows,[]);
});
test('historic timezone resolves day boundaries and per-event timezone independently',t=>{
 const f=fixture(t);f.schedule(undefined,{zone:'Asia/Jakarta'});f.member('a');
 f.schedule('2026-11-20T01:00:00.000Z',{zone:'Asia/Jayapura',event:'updated'});
 f.record('a','2026-11-19');
 const before=f.recap();assert.equal(before.context.timezone,'Asia/Jakarta');assert.equal(before.context.asOf,'2026-11-19T16:59:59.999Z');assert.equal(before.rows[0].checkIn.timezone,'Asia/Jakarta');
 const changed=f.recap('2026-11-20');assert.equal(changed.context.timezone,'Asia/Jayapura');assert.equal(changed.context.asOf,'2026-11-20T14:59:59.999Z');assert.equal(changed.context.timezoneChanged,true);assert.equal(changed.context.coverage,'partial');
});
test('same-timestamp history events use event ID ordering and deleted schedule cannot infer a roster',t=>{
 const f=fixture(t);f.schedule();f.member('a');f.member('a','2026-11-19T00:00:00.000Z',{name:'First',event:'updated'});f.member('a','2026-11-19T00:00:00.000Z',{name:'Last',event:'updated'});
 assert.equal(f.recap().rows[0].name,'Last');
 f.schedule('2026-11-19T05:00:00.000Z',{event:'deleted'});f.record('a');
 const result=f.recap();assert.equal(result.context.rosterKnown,false);assert.equal(result.context.schedule,null);assert.equal(result.rows[0].eligible,null);assert.equal(result.rows[0].status,'present');
});
test('approved future absence remains evidence without projected membership',t=>{
 const f=fixture(t);f.schedule();f.member('a');
 f.db.exec(`INSERT INTO absence_requests(id,user_id,name_snapshot,email_snapshot,type,start_date,end_date,reason,status,office_timezone,schedule_snapshot,created_at,updated_at)
 VALUES('req','a','A snapshot','a@example.invalid','sick','2026-11-23','2026-11-23','Private reason','approved','Asia/Makassar','[1,2,3,4,5]','2026-11-19T00:00:00.000Z','2026-11-19T00:00:00.000Z');
 INSERT INTO absence_request_days VALUES('req','2026-11-23');
 INSERT INTO absence_day_reservations VALUES('a','2026-11-23','req');`);
 const result=f.recap('2026-11-23');assert.equal(result.context.coverage,'future');assert.equal(result.rows[0].status,'sick');assert.equal(result.rows[0].eligible,null);
 assert.equal(JSON.stringify(result).includes('Private reason'),false);
});
