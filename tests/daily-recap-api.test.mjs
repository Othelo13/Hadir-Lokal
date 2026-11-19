import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash,randomBytes } from 'node:crypto';
import { officeDate } from '../server/absence-policy.mjs';
import { handleDailyRecap } from '../server/daily-recap-api.mjs';

const dir=mkdtempSync(path.join(tmpdir(),'hadir-daily-recap-api-'));
process.env.HADIR_DATA_DIR=dir;
process.env.HOST='127.0.0.1';
const {sqlite}=await import('../server/storage.mjs');
const {default:api}=await import('../server/api.ts');
after(()=>{sqlite.close();rmSync(dir,{recursive:true,force:true});});
const zone='Asia/Makassar',origin='http://127.0.0.1:5197',date='2025-11-19';
const coverage='2025-11-17T00:00:00.000Z';
sqlite.prepare("UPDATE schema_migrations SET applied_at=? WHERE id='002-member-schedule-history'").run(coverage);
sqlite.exec(`INSERT INTO config VALUES(1,'[0,1,2,3,4,5,6]','09:00','17:00','Asia/Makassar',1);
 INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'dummy');
 INSERT INTO members VALUES('employee@example.invalid','employee','Employee','employee',1,'dummy');
 INSERT INTO members VALUES('inactive@example.invalid','inactive','Inactive','admin',0,'dummy');`);
sqlite.prepare(`INSERT INTO schedule_history(config_id,days,start,end,timezone,allow_late,event_type,recorded_at)
 VALUES(1,'[1,2,3,4,5]','09:00','17:00',?,1,'baseline',?)`).run(zone,coverage);
const member=sqlite.prepare(`INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
 VALUES(?,?,?,'employee',1,'baseline',?)`);
for(let i=0;i<53;i++){
 const id='u'+String(i).padStart(2,'0'),name=i===0?'Álpha':'Member '+String(i).padStart(2,'0');
 member.run(id,name,id+'@example.invalid',coverage);
}
sqlite.exec(`INSERT INTO records VALUES('rec','u00','u00@example.invalid','Old Name','2025-11-19','in','2025-11-19T00:45:00.000Z','ontime','selfies/secret.jpg','secret-qr','pending');
 INSERT INTO absence_requests(id,user_id,name_snapshot,email_snapshot,type,start_date,end_date,reason,status,office_timezone,schedule_snapshot,created_at,updated_at)
 VALUES('req','u01','Member 01','u01@example.invalid','sick','2025-11-19','2025-11-19','Private medical detail','approved','Asia/Makassar','[1,2,3,4,5]','2025-11-19T00:00:00.000Z','2025-11-19T00:00:00.000Z');
 INSERT INTO absence_request_days VALUES('req','2025-11-19');
 INSERT INTO absence_day_reservations VALUES('u01','2025-11-19','req');`);
const tokens={};
function session(id){
 const token=randomBytes(32).toString('hex');tokens[id]=token;
 sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
}
for(const id of ['admin','employee','inactive'])session(id);
async function call(user='admin',params={},method='GET'){
 const url=new URL('/api/app?action=daily-recap',origin);
 for(const [k,v] of Object.entries(params))for(const value of Array.isArray(v)?v:[v])url.searchParams.append(k,value);
 const headers={};
 if(user)headers.cookie='hadir_session='+tokens[user];
 if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';}
 const res=await api(new Request(url,{method,headers,...(method==='POST'?{body:JSON.stringify({action:'daily-recap'})}:{})}));
 return {status:res.status,data:await res.json(),cache:res.headers.get('cache-control')};
}
test('daily recap requires live authenticated active admin and GET',async()=>{
 assert.equal((await call(null,{date})).status,401);
 assert.equal((await call('employee',{date})).status,403);
 assert.equal((await call('inactive',{date})).status,401);
 assert.equal((await call('admin',{date},'POST')).status,405);
 assert.equal((await call('admin',{date})).status,200);
});
test('default date comes from current office timezone, not caller timezone',async()=>{
 const before=officeDate(new Date(),zone);
 const response=await call();
 const after=officeDate(new Date(),zone);
 assert.equal(response.status,200);
 assert.ok([before,after].includes(response.data.date));
 assert.equal(response.data.pageSize,10);
 assert.equal(response.cache,'no-store');
 const fixed=handleDailyRecap(sqlite,'admin','GET',new URLSearchParams(),()=>sqlite.prepare("SELECT * FROM members WHERE user_id='admin'").get(),()=>new Date('2025-11-18T17:00:00Z'));
 assert.equal(fixed.date,date);
});
test('historical recap includes roster and evidence with safe fields and current status',async()=>{
 const response=await call('admin',{date,pageSize:'50',q:'u0'});
 assert.equal(response.status,200);
 assert.equal(response.data.context.coverage,'complete');
 assert.equal(response.data.total,10);
 const present=response.data.rows.find(r=>r.userId==='u00');
 assert.equal(present.name,'Álpha');assert.equal(present.status,'present');assert.equal(present.provisional,true);
 assert.equal(present.checkIn.timezone,zone);
 const sick=response.data.rows.find(r=>r.userId==='u01');
 assert.equal(sick.status,'sick');assert.equal(sick.absence.id,'req');
 assert.equal(response.data.rows.find(r=>r.userId==='u02').status,null);
 const serialized=JSON.stringify(response.data);
 for(const secret of ['Private medical detail','selfies/secret.jpg','secret-qr','password_hash','storage_key','dummy'])assert.equal(serialized.includes(secret),false);
});
test('search is normalized, case insensitive, trimmed and literal',async()=>{
 for(const q of ['  ÁLPHA  ','A\u0301LPHA','U00@EXAMPLE.INVALID']){
  const r=await call('admin',{date,q});assert.equal(r.status,200);
  assert.equal(r.data.total,1);assert.equal(r.data.rows[0].userId,'u00');
 }
 for(const q of ['%','_',"' OR 1=1 --"]){
  const r=await call('admin',{date,q});assert.equal(r.status,200);assert.equal(r.data.total,0);
 }
});
test('pagination works after filtering with stable order and clamps out-of-range pages',async()=>{
 const a=await call('admin',{date,pageSize:'10'}),b=await call('admin',{date,pageSize:'10',page:'2'});
 assert.equal(a.data.total,53);assert.equal(a.data.totalPages,6);
 assert.equal(a.data.rows.length,10);assert.equal(b.data.rows.length,10);
 assert.equal(new Set([...a.data.rows,...b.data.rows].map(r=>r.userId)).size,20);
 const last=await call('admin',{date,pageSize:'20',page:'999'});
 assert.equal(last.data.page,3);assert.equal(last.data.rows.length,13);
 const filter=await call('admin',{date,q:'Member 1',pageSize:'50'});
 assert.equal(filter.data.total,10);assert.equal(filter.data.totalPages,1);
 const empty=await call('admin',{date,q:'missing',page:'2'});
 assert.equal(empty.data.page,1);assert.equal(empty.data.totalPages,1);assert.deepEqual(empty.data.rows,[]);
});
test('invalid dates, duplicate parameters, excessive pages and search inputs fail safely',async()=>{
 for(const params of [{date:'2025-02-30'},{date:''},{date:'0000-01-01'},{date:'9999-12-31'},{page:'0'},{page:'1.5'},{page:'1000001'},{pageSize:'1000'},{pageSize:'15'},{q:'x'.repeat(101)},{q:'x\n'},{page:['1','2']},{date:[date,date]},{action:'daily-recap'},{asOf:'2025-01-01'}]){
  assert.equal((await call('admin',params)).status,400,JSON.stringify(params));
 }
 assert.equal((await call('admin',{date})).status,200);
});
test('precoverage date preserves evidence without inventing a roster',async()=>{
 sqlite.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('legacy','deleted','old@example.invalid','Deleted Member','2025-11-16','in','2025-11-16T01:00:00Z','late','private.jpg','qr','approved');
 const r=await call('admin',{date:'2025-11-16'});
 assert.equal(r.status,200);assert.equal(r.data.context.coverage,'unknown');
 assert.equal(r.data.total,1);assert.equal(r.data.rows[0].userId,'deleted');
 assert.equal(r.data.rows[0].eligible,null);assert.equal(r.data.rows[0].checkIn.timezone,null);
});
test('recap does not inherit legacy state endpoint record cap',async()=>{
 const day='2025-11-15',insert=sqlite.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 sqlite.exec('BEGIN IMMEDIATE');
 try{
  for(let i=0;i<2051;i++){
   const id='large-'+String(i).padStart(4,'0');
   insert.run(id,id,id+'@example.invalid',id,day,'in',day+'T01:00:00Z','ontime','private.jpg','qr','approved');
  }
  sqlite.exec('COMMIT');
 }catch(error){sqlite.exec('ROLLBACK');throw error;}
 const r=await call('admin',{date:day,pageSize:'50',page:'42'});
 assert.equal(r.status,200);assert.equal(r.data.total,2051);assert.equal(r.data.totalPages,42);
 assert.equal(r.data.rows.length,1);assert.equal(r.data.rows[0].userId,'large-2050');
});
test('snapshot rechecks authorization and releases transaction after failure',()=>{
 const params=new URLSearchParams({date}),admin=()=>sqlite.prepare("SELECT * FROM members WHERE user_id='admin'").get();
 assert.throws(()=>handleDailyRecap(sqlite,'admin','GET',params,()=>null),{status:401});
 assert.throws(()=>handleDailyRecap(sqlite,'admin','GET',params,()=>({...admin(),role:'employee'})),{status:403});
 assert.throws(()=>handleDailyRecap(sqlite,'admin','GET',params,()=>({...admin(),user_id:'another'})),{status:401});
 assert.equal(handleDailyRecap(sqlite,'admin','GET',params,admin).total,53);
});
