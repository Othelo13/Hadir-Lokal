import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash,randomBytes } from 'node:crypto';
import { officeDate } from '../server/absence-policy.mjs';
import { insertAttendanceWithAbsenceGuard } from '../server/attendance-write.mjs';

const dir=mkdtempSync(path.join(tmpdir(),'hadir-api-'));
process.env.HADIR_DATA_DIR=dir;
process.env.HOST='127.0.0.1';
const {sqlite}=await import('../server/storage.mjs');
const {default:api}=await import('../server/api.ts');
after(()=>{sqlite.close();rmSync(dir,{recursive:true,force:true});});
sqlite.exec(`INSERT INTO config VALUES(1,'[0,1,2,3,4,5,6]','09:00','17:00','Asia/Makassar',1);
  INSERT INTO members VALUES('a@example.invalid','a','Member A','employee',1,'dummy');
  INSERT INTO members VALUES('b@example.invalid','b','Member B','employee',1,'dummy');
  INSERT INTO members VALUES('admin@example.invalid','admin','Admin','admin',1,'dummy');`);
const tokens={};
for(const id of ['a','b','admin']){
  const token=randomBytes(32).toString('hex');
  tokens[id]=token;
  sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
}
const origin='http://127.0.0.1:5197';
const date=offset=>officeDate(new Date(Date.now()+offset*86400000),'Asia/Makassar');
const input=offset=>({type:'leave',startDate:date(offset),endDate:date(offset),reason:'Kegiatan kampus'});
async function call(user,action,{method='GET',params={},body={},requestOrigin=origin}={}){
  const url=new URL('/api/app',origin);
  url.searchParams.set('action',action);
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  const headers={};
  if(user)headers.cookie='hadir_session='+tokens[user];
  if(method==='POST'){headers.origin=requestOrigin;headers['content-type']='application/json';}
  const res=await api(new Request(url,{method,headers,...(method==='POST'?{body:JSON.stringify({action,...body})}:{})}));
  return {status:res.status,data:await res.json(),cache:res.headers.get('cache-control')};
}
const submit=(user,offset,body={})=>call(user,'absence-submit',{method:'POST',body:{...input(offset),...body}});
const change=(user,action,id,reason)=>call(user,'absence-'+action,{method:'POST',body:{id,reason}});
const detail=(user,id)=>call(user,'absence-detail',{params:{id}});
test('absence routes require authentication and enforce HTTP methods and same origin',async()=>{
  assert.equal((await call(null,'absence-list')).status,401);
  assert.equal((await call('a','absence-submit')).status,405);
  assert.equal((await call('a','absence-list',{method:'POST'})).status,405);
  assert.equal((await call('a','absence-submit',{method:'POST',body:input(1),requestOrigin:'https://other.invalid'})).status,403);
});
test('submission uses authenticated identity and rejects malformed attachments',async()=>{
  assert.equal((await submit('admin',1)).status,403);
  assert.equal((await submit('a',1,{attachment:'ignored'})).status,400);
  assert.equal((await submit('a',1,{reason:''})).status,400);
  const result=await submit('a',1,{userId:'b',status:'approved'});
  assert.equal(result.status,201);
  assert.equal(result.data.status,'pending');
  assert.equal((await detail('a',result.data.id)).data.request.user_id,'a');
  assert.equal((await submit('a',1)).status,409);
});
test('list and detail isolate members and exclude storage keys from responses',async()=>{
  const a=await submit('a',2),b=await submit('b',2);
  assert.equal(a.status,201);assert.equal(b.status,201);
  const own=await call('a','absence-list');
  assert.equal(own.status,200);assert.equal(own.cache,'no-store');
  assert.ok(own.data.rows.every(row=>row.user_id==='a'));
  assert.equal((await detail('a',b.data.id)).status,404);
  assert.equal((await detail('admin',b.data.id)).status,200);
  assert.equal((await detail('b',b.data.id)).data.days[0],date(2));
  assert.equal(Object.hasOwn(own.data.rows[0],'reason'),false);
  assert.equal(JSON.stringify(own.data).includes('storage_key'),false);
});
test('list validates filters and paginates, preserving admin access',async()=>{
  const result=await call('admin','absence-list',{params:{status:'pending',type:'leave',page:'999',pageSize:'10'}});
  assert.equal(result.status,200);assert.ok(result.data.total>=3);
  assert.equal(result.data.page,result.data.totalPages);
  assert.equal((await call('admin','absence-list',{params:{pageSize:'1000'}})).status,400);
  assert.equal((await call('admin','absence-list',{params:{status:'invalid'}})).status,400);
  assert.equal((await detail('admin','not-id')).status,400);
});
test('review and cancellation enforce role, ownership and required reason',async()=>{
  const {data:{id}}=await submit('a',3);
  assert.equal((await change('a','approve',id)).status,403);
  assert.equal((await change('b','cancel',id)).status,404);
  assert.equal((await change('admin','reject',id,'')).status,400);
  assert.equal((await change('admin','reject',id,'Tidak memenuhi syarat')).data.status,'rejected');
  assert.equal((await change('admin','approve',id)).status,409);
  const next=await submit('a',3);
  assert.equal(next.status,201);
  assert.equal((await change('a','cancel',next.data.id)).data.status,'cancelled');
});
test('approved absence blocks final attendance insert; cancellation releases it',async()=>{
  const {data:{id}}=await submit('a',4);
  assert.equal((await change('admin','approve',id)).data.status,'approved');
  const record={id:'guard-record',userId:'a',email:'a@example.invalid',name:'Member A',date:date(4),
    kind:'in',time:new Date().toISOString(),status:'ontime',photo:'selfies/a/guard.jpg',qr:'dummy'};
  assert.throws(()=>insertAttendanceWithAbsenceGuard(sqlite,record),{status:409});
  assert.equal(sqlite.prepare("SELECT count(*) n FROM records WHERE id='guard-record'").get().n,0);
  assert.equal((await change('a','cancel',id)).status,403);
  assert.equal((await change('admin','cancel',id,'Anggota kembali masuk')).data.status,'cancelled');
  insertAttendanceWithAbsenceGuard(sqlite,record);
  assert.equal((await submit('a',4)).status,409);
});
test('attendance during pending prevents approval and leaves request intact',async()=>{
  const {data:{id}}=await submit('b',5);
  insertAttendanceWithAbsenceGuard(sqlite,{id:'pending-record',userId:'b',email:'b@example.invalid',name:'Member B',date:date(5),
    kind:'in',time:new Date().toISOString(),status:'ontime',photo:'selfies/b/guard.jpg',qr:'dummy'});
  assert.equal((await change('admin','approve',id)).status,409);
  const result=await detail('admin',id);
  assert.equal(result.data.request.status,'pending');
  assert.equal(result.data.history.length,1);
});
