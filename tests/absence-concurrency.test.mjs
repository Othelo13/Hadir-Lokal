import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { migrateAbsenceDomain } from '../server/migrate-absence.mjs';
import { migrateMemberScheduleHistory } from '../server/migrate-member-schedule.mjs';
import { migrateAbsenceAttachments } from '../server/migrate-absence-attachments.mjs';
import { submitAbsence,transitionAbsence } from '../server/absence-service.mjs';
import { commitAttendance } from '../server/attendance-write.mjs';

const worker=fileURLToPath(new URL('../scripts/support/absence-race-worker.mjs',import.meta.url));
const now='2026-11-19T09:00:00.000Z',date='2026-11-19';
const policy={maxBackDays:3,maxRangeDays:31,minReasonLength:5,maxReasonLength:500};
const request={type:'leave',startDate:date,endDate:date,reason:'Kegiatan kampus'};
function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'hadir-race-')),file=path.join(dir,'hadir.sqlite');
 const db=new DatabaseSync(file);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
 db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
 migrateAbsenceDomain(db);migrateMemberScheduleHistory(db);migrateAbsenceAttachments(db);
 db.exec(`INSERT INTO members VALUES('a@example.invalid','a','Member A','employee',1,'dummy');
 INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'dummy');
 INSERT INTO members VALUES('admin2@example.invalid','admin2','Admin 2','admin',1,'dummy');
 INSERT INTO config VALUES(1,'[0,1,2,3,4,5,6]','09:00','17:00','Asia/Makassar',1);
 INSERT INTO codes VALUES('qr','QR',1,'2026-01-01');`);
 const job=(operation,actor,input={})=>({file,now,policy,operation,actor,...input});
 const pending=()=>submitAbsence(db,'a',request,policy,new Date(now)).id;
 const approve=id=>transitionAbsence(db,'admin',id,'approve',null,policy,new Date(now));
 const attendance=(kind='in',challenge=randomUUID())=>{
  if(!db.prepare('SELECT id FROM challenges WHERE id=?').get(challenge))db.prepare('INSERT INTO challenges VALUES(?,?,?)').run(challenge,'a',Date.parse(now)+180000);
  const id=randomUUID();
  return job('attendance','a',{input:{id,userId:'a',expectedDate:date,expectedTimezone:'Asia/Makassar',kind,challenge,photo:'selfies/a/'+id+'.jpg',qr:'qr'}});
 };
 const transition=(id,action='approve',actor='admin')=>job('transition',actor,{id,action,reason:action==='cancel'?'Anggota kembali masuk':null});
 const count=table=>db.prepare('SELECT count(*) n FROM '+table).get().n;
 const state=id=>db.prepare('SELECT status FROM absence_requests WHERE id=?').get(id).status;
 return {db,job,pending,approve,attendance,transition,count,state};
}
function launch(job){
 const child=fork(worker,[JSON.stringify(job)],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
 let stderr='',result,readyResolve,attemptResolve,doneResolve,doneReject;
 let ready=false,attempt=false;
 const started=new Promise(resolve=>{readyResolve=resolve;});
 const attempting=new Promise(resolve=>{attemptResolve=resolve;});
 const done=new Promise((resolve,reject)=>{doneResolve=resolve;doneReject=reject;});
 // Attach a handler immediately so an early child failure is not unhandled.
 done.catch(()=>{});
 child.stderr.on('data',chunk=>{stderr+=chunk;});
 child.on('message',m=>{
  if(m.phase==='ready'){ready=true;readyResolve();}
  if(m.phase==='attempt'){attempt=true;attemptResolve();}
  if(m.phase==='result')result=m.result;
 });
 child.once('error',doneReject);
 child.once('exit',code=>{
  if(code===0&&result)doneResolve(result);
  else doneReject(new Error('Race worker exited '+code+': '+stderr));
 });
 return {child,started,attempting,done,go:()=>child.send('go'),get ready(){return ready;},get attempt(){return attempt;}};
}
async function race(db,...jobs){
 const workers=jobs.map(launch);
 let locked=false;
 // A separate parent connection holds a write lock while both workers attempt their transactions.
 const timeout=AbortSignal.timeout(15000);
 const deadline=new Promise((_,reject)=>timeout.addEventListener('abort',()=>reject(new Error('Race worker timeout')),{once:true}));
 const wait=p=>Promise.race([p,deadline,...workers.map(w=>w.done.then(()=>{throw new Error('Worker exited before barrier');}))]);
 try{
  await wait(Promise.all(workers.map(w=>w.started)));
  db.exec('BEGIN IMMEDIATE');locked=true;
  workers.forEach(w=>w.go());
  await wait(Promise.all(workers.map(w=>w.attempting)));
  await delay(60);
  db.exec('COMMIT');locked=false;
  return await Promise.race([Promise.all(workers.map(w=>w.done)),deadline]);
 }finally{
  if(locked)db.exec('ROLLBACK');
  for(const w of workers)if(w.child.exitCode===null&&w.child.signalCode===null)w.child.kill();
  await Promise.allSettled(workers.map(w=>w.done));
 }
}
function oneSuccess(results){
 assert.equal(results.filter(r=>r.ok).length,1,JSON.stringify(results));
 assert.equal(results.find(r=>!r.ok).status,409,JSON.stringify(results));
}
function consistent(f){
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(f.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 assert.equal(f.db.prepare(`SELECT count(*) n FROM records a JOIN absence_day_reservations d
 ON a.user_id=d.user_id AND a.date=d.date JOIN absence_requests r ON r.id=d.request_id WHERE r.status='approved'`).get().n,0);
 assert.equal(f.db.prepare(`SELECT count(*) n FROM absence_day_reservations d JOIN absence_requests r ON r.id=d.request_id
 WHERE r.status NOT IN ('pending','approved')`).get().n,0);
}
test('independent workers serialize approval versus check-in',async t=>{
 const f=fixture(t),id=f.pending();
 const results=await race(f.db,f.transition(id),f.attendance());
 oneSuccess(results);
 assert.equal(f.count('records'),results[1].ok?1:0);
 assert.equal(f.state(id),results[0].ok?'approved':'pending');
 consistent(f);
});
test('independent workers allow checkout but reject approval when check-in already exists',async t=>{
 const f=fixture(t),id=f.pending(),entry=f.attendance();
 commitAttendance(f.db,entry.input,()=>f.db.prepare("SELECT * FROM members WHERE user_id='a'").get(),()=>new Date(now));
 const results=await race(f.db,f.transition(id),f.attendance('out'));
 assert.equal(results[0].status,409);assert.equal(results[1].ok,true,JSON.stringify(results));
 assert.equal(f.count('records'),2);assert.equal(f.state(id),'pending');consistent(f);
});
test('independent overlapping submissions produce one request and one reservation',async t=>{
 const f=fixture(t),job=f.job('submit','a',{input:request});
 oneSuccess(await race(f.db,job,job));
 assert.equal(f.count('absence_requests'),1);assert.equal(f.count('absence_day_reservations'),1);
 assert.equal(f.count('absence_request_history'),1);consistent(f);
});
test('two independent administrators cannot approve the same request twice',async t=>{
 const f=fixture(t),id=f.pending();
 oneSuccess(await race(f.db,f.transition(id),f.transition(id,'approve','admin2')));
 assert.equal(f.state(id),'approved');assert.equal(f.count('absence_request_history'),2);
 assert.equal(f.count('absence_day_reservations'),1);consistent(f);
});
test('approved absence cancellation versus attendance remains consistent in either order',async t=>{
 const f=fixture(t),id=f.pending();f.approve(id);
 const results=await race(f.db,f.transition(id,'cancel'),f.attendance());
 assert.equal(results[0].ok,true,JSON.stringify(results));
 assert.ok(results[1].ok||results[1].status===409,JSON.stringify(results));
 assert.equal(f.state(id),'cancelled');assert.equal(f.count('absence_day_reservations'),0);
 assert.equal(f.count('records'),results[1].ok?1:0);consistent(f);
});
test('independent attendance workers cannot reuse the same camera challenge',async t=>{
 const f=fixture(t),a=f.attendance(),b=f.attendance('in',a.input.challenge);
 oneSuccess(await race(f.db,a,b));
 assert.equal(f.count('records'),1);assert.equal(f.count('challenges'),0);consistent(f);
});
test('failed transaction on an independent worker rolls back before another request succeeds',async t=>{
 const f=fixture(t);
 f.db.exec("CREATE TRIGGER test_failed_submit BEFORE INSERT ON absence_request_history WHEN NEW.to_status='pending' BEGIN SELECT RAISE(ABORT,'test audit failure'); END");
 const results=await race(f.db,f.job('submit','a',{input:request}),f.attendance());
 assert.equal(results[0].ok,false);assert.equal(results[1].ok,true,JSON.stringify(results));
 assert.equal(f.count('absence_requests'),0);assert.equal(f.count('absence_day_reservations'),0);
 assert.equal(f.count('absence_request_history'),0);assert.equal(f.count('records'),1);consistent(f);
});
