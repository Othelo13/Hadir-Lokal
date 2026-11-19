import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { handleDailyRecapDetail } from '../server/daily-recap-detail.mjs';
import { submitAbsence,transitionAbsence } from '../server/absence-service.mjs';

const dir=mkdtempSync(path.join(tmpdir(),'hadir-recap-detail-'));
process.env.HADIR_DATA_DIR=dir;process.env.HOST='127.0.0.1';
const {sqlite}=await import('../server/storage.mjs');
const {default:api}=await import('../server/api.ts');
after(()=>{sqlite.close();rmSync(dir,{recursive:true,force:true});});
const date='2025-11-19',coverage='2025-11-17T00:00:00.000Z',origin='http://127.0.0.1:5197';
const zone='Asia/Makassar',policy={maxBackDays:3,maxRangeDays:31,minReasonLength:5,maxReasonLength:500};
const now=new Date(date+'T01:00:00.000Z');
sqlite.prepare("UPDATE schema_migrations SET applied_at=? WHERE id='002-member-schedule-history'").run(coverage);
sqlite.exec("INSERT INTO config VALUES(1,'[1,2,3,4,5]','09:00','17:00','Asia/Makassar',1)");
sqlite.prepare(`INSERT INTO schedule_history(config_id,days,start,end,timezone,allow_late,event_type,recorded_at)
 VALUES(1,'[1,2,3,4,5]','09:00','17:00',?,1,'baseline',?)`).run(zone,coverage);
for(const [id,role,active] of [['admin','admin',1],['employee','employee',1],['inactive','admin',0],['a','employee',1],['b','employee',1],['empty','employee',1],['deleted','employee',1]]){
 sqlite.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run(id+'@example.invalid',id,id,role,active,'secret-password-hash');
 sqlite.prepare(`INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
 VALUES(?,?,?,?,?,'baseline',?)`).run(id,id,id+'@example.invalid',role,active,coverage);
}
sqlite.prepare("INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at) VALUES('deleted','deleted','deleted@example.invalid','employee',1,'deleted','2025-11-19T05:00:00.000Z')").run();
sqlite.exec("DELETE FROM members WHERE user_id='deleted'");
const tokens={};
for(const id of ['admin','employee','inactive']){
 const token=randomBytes(32).toString('hex');tokens[id]=token;
 sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
}
function record(id,user,kind,review,day=date){
 const key='selfies/'+user+'/'+id+'.jpg';
 sqlite.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,user,user+'@example.invalid',user,day,kind,day+(kind==='in'?'T01:00:00.000Z':'T09:00:00.000Z'),'ontime',key,'secret-qr',review);
 mkdirSync(path.join(dir,'selfies',user),{recursive:true});writeFileSync(path.join(dir,key),'synthetic selfie '+id);
}
record('in-a','a','in','rejected');record('out-a','a','out','pending');
record('in-other-date','a','in','approved','2025-11-18');record('deleted-in','deleted','in','approved');
const cancelId=randomUUID();
sqlite.prepare(`INSERT INTO attendance_cancellations(id,user_id,email,name,date,kind,time,reason,cancelled_by,cancelled_at,retry_authorized_at,retry_authorized_by,photo_cleanup_key)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(cancelId,'a','a@example.invalid','a',date,'in',date+'T00:45:00.000Z','Test cancellation','admin',date+'T00:50:00.000Z',date+'T00:55:00.000Z','admin','private-cleanup-key');
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const req=(type,reason,attachment)=>submitAbsence(sqlite,'b',{type,startDate:date,endDate:date,reason,...(attachment?{attachment}:{})},policy,now).id;
const rejected=req('leave','Rejected reason');transitionAbsence(sqlite,'admin',rejected,'reject','Review reason',policy,now);
const cancelled=req('leave','Cancelled reason');transitionAbsence(sqlite,'admin',cancelled,'cancel','Cancel reason',policy,now);
const approved=req('sick','Private medical reason',{name:'bukti.pdf',mimeType:'application/pdf',base64:pdf.toString('base64')});
transitionAbsence(sqlite,'admin',approved,'approve',null,policy,now);
const pending=submitAbsence(sqlite,'empty',{type:'leave',startDate:date,endDate:date,reason:'Pending reason'},policy,now).id;

async function request(user,action,params={},method='GET'){
 const url=new URL('/api/app',origin);url.searchParams.set('action',action);
 for(const [k,v] of Object.entries(params))for(const value of Array.isArray(v)?v:[v])url.searchParams.append(k,value);
 const headers={};if(user)headers.cookie='hadir_session='+tokens[user];
 if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';}
 return api(new Request(url,{method,headers,...(method==='POST'?{body:JSON.stringify({action})}:{})}));
}
async function detail(userId,user='admin',params={}){
 const res=await request(user,'daily-recap-detail',{date,userId,...params});
 return {status:res.status,data:await res.json(),cache:res.headers.get('cache-control')};
}
test('detail requires authenticated active administrator and GET',async()=>{
 assert.equal((await detail('a',null)).status,401);
 assert.equal((await detail('a','employee')).status,403);
 assert.equal((await detail('a','inactive')).status,401);
 assert.equal((await request('admin','daily-recap-detail',{date,userId:'a'},'POST')).status,405);
 assert.equal((await detail('a')).cache,'no-store');
});
test('detail matches daily recap row and includes rejected and pending selfie records',async()=>{
 const res=await detail('a');assert.equal(res.status,200);
 const list=await (await request('admin','daily-recap',{date,q:'a@example.invalid'})).json();
 assert.deepEqual(res.data.summary,list.rows[0]);
 assert.equal(res.data.summary.status,null);
 assert.deepEqual(res.data.records.map(r=>[r.id,r.review]),[['in-a','rejected'],['out-a','pending']]);
 assert.equal(res.data.records[0].timezone,zone);
 assert.equal(res.data.records[0].photoUrl,'/api/app?action=photo&id=in-a');
 assert.equal(res.data.absences.length,0);
});
test('cancellation history preserves reasons and retake metadata without photo paths',async()=>{
 const {data}=await detail('a');assert.equal(data.cancellations.length,1);
 const c=data.cancellations[0];assert.equal(c.id,cancelId);assert.equal(c.reason,'Test cancellation');
 assert.equal(c.retry_authorized_by,'admin');assert.equal(c.photoUrl,null);
 assert.equal(c.retry_authorized_at,date+'T00:55:00.000Z');
 const serialized=JSON.stringify(data);
 for(const secret of ['private-cleanup-key','photo_cleanup_key','selfies/','secret-qr','secret-password-hash','password_hash'])assert.equal(serialized.includes(secret),false);
});
test('detail includes all effective absence states, audit and safe attachment metadata',async()=>{
 const {data,status}=await detail('b');assert.equal(status,200);assert.equal(data.summary.status,'sick');
 assert.deepEqual(new Set(data.absences.map(r=>r.status)),new Set(['approved','rejected','cancelled']));
 const a=data.absences.find(r=>r.id===approved);
 assert.equal(a.reason,'Private medical reason');assert.equal(a.reserved,true);assert.equal(a.history.length,2);
 assert.equal(a.history.at(-1).to_status,'approved');
 assert.deepEqual(a.attachment,{original_name:'bukti.pdf',mime_type:'application/pdf',file_size:pdf.length,downloadUrl:'/api/app?action=absence-attachment&id='+approved});
 assert.equal(data.absences.find(r=>r.id===rejected).review_reason,'Review reason');
 assert.equal(data.absences.find(r=>r.id===cancelled).reserved,false);
 for(const secret of ['storage_key','sha256','base64','%PDF-1.4'])assert.equal(JSON.stringify(data).includes(secret),false);
 const res=await request('admin','absence-attachment',{id:approved});assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),pdf);
 assert.equal((await request('employee','absence-attachment',{id:approved})).status,404);
});
test('pending request is visible in detail but does not change empty recap status',async()=>{
 const {data,status}=await detail('empty');assert.equal(status,200);
 assert.equal(data.summary.status,null);assert.equal(data.summary.hasEvidence,false);
 assert.deepEqual(data.records,[]);assert.deepEqual(data.cancellations,[]);
 assert.equal(data.absences[0].id,pending);assert.equal(data.absences[0].status,'pending');
});
test('deleted member evidence remains accessible and other date or member is not mixed',async()=>{
 const {data,status}=await detail('deleted');assert.equal(status,200);
 assert.equal(data.summary.eligible,false);assert.equal(data.summary.status,'present');assert.equal(data.records[0].id,'deleted-in');
 assert.equal((await detail('deleted','admin',{date:'2025-11-20'})).status,404);
 assert.equal((await detail('a','admin',{date:'2025-11-18'})).data.records[0].id,'in-other-date');
 assert.equal((await detail('nonexistent')).status,404);
});
test('photo reference still requires authorized endpoint and does not expose disk path',async()=>{
 const res=await request('admin','photo',{id:'in-a'});assert.equal(res.status,200);
 assert.equal(await res.text(),'synthetic selfie in-a');assert.equal(res.headers.get('cache-control'),'private, no-store');
 assert.equal((await request('employee','photo',{id:'in-a'})).status,404);
});
test('invalid or ambiguous parameters and injection attempts fail safely',async()=>{
 for(const params of [{date:'2025-02-30',userId:'a'},{userId:'a'},{date},{date,userId:''},{date,userId:' a '},{date,userId:'x'.repeat(257)},{date,userId:['a','b']},{date:[date,date],userId:'a'},{date,userId:'a',page:'1'}]){
  assert.equal((await request('admin','daily-recap-detail',params)).status,400,JSON.stringify(params));
 }
 assert.equal((await detail("' OR 1=1 --")).status,404);
 assert.equal((await detail('a')).status,200);
});
test('detail snapshot rechecks session and role and rolls back on failure',()=>{
 const params=new URLSearchParams({date,userId:'a'}),admin=()=>sqlite.prepare("SELECT * FROM members WHERE user_id='admin'").get();
 assert.throws(()=>handleDailyRecapDetail(sqlite,'admin','GET',params,()=>null),{status:401});
 assert.throws(()=>handleDailyRecapDetail(sqlite,'admin','GET',params,()=>({...admin(),role:'employee'})),{status:403});
 assert.equal(handleDailyRecapDetail(sqlite,'admin','GET',params,admin).summary.userId,'a');
});
