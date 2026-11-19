import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash,randomBytes } from 'node:crypto';
import jpeg from 'jpeg-js';
import { validateAttachment,bodyLimit,MAX_ATTACHMENT_BYTES,ABSENCE_BODY_BYTES,DEFAULT_BODY_BYTES } from '../server/absence-attachment.mjs';
import { officeDate } from '../server/absence-policy.mjs';

const dir=mkdtempSync(path.join(tmpdir(),'hadir-attachment-'));
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
 const token=randomBytes(32).toString('hex');tokens[id]=token;
 sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
}
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD4sAAAAASUVORK5CYII=','base64');
const jpg=jpeg.encode({data:Buffer.from([255,0,0,255]),width:1,height:1},70).data;
const file=(bytes=pdf,name='bukti.pdf',mimeType='application/pdf')=>({name,mimeType,base64:bytes.toString('base64')});
const origin='http://127.0.0.1:5197';
async function call(user,action,body,params={}){
 const url=new URL('/api/app',origin);url.searchParams.set('action',action);
 for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
 const headers={};
 if(user)headers.cookie='hadir_session='+tokens[user];
 if(body){headers.origin=origin;headers['content-type']='application/json';}
 return api(new Request(url,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify({action,...body})}:{})}));
}
const date=offset=>officeDate(new Date(Date.now()+offset*86400000),'Asia/Makassar');
const submit=(offset,attachment)=>call('a','absence-submit',{type:'sick',startDate:date(offset),endDate:date(offset),reason:'Bukti pengajuan',attachment});
const count=table=>sqlite.prepare('SELECT count(*) AS n FROM '+table).get().n;
test('valid JPEG PNG and PDF payloads are identified and hashed',()=>{
 for(const input of [file(),file(png,'image.png','image/png'),file(jpg,'photo.JPEG','image/jpeg')]){
  const valid=validateAttachment(input);
  assert.equal(valid.sha256,createHash('sha256').update(valid.bytes).digest('hex'));
 }
});
test('reject spoofed type, unsafe name, malformed encoding and truncated content',()=>{
 for(const bad of [file(pdf,'fake.png','image/png'),file(pdf,'../bukti.pdf'),file(pdf,'x.exe'),
  file(pdf,'x\r\n.pdf'),{...file(),base64:'%%%'},
  {...file(),base64:file().base64+' '},file(png.subarray(0,30),'image.png','image/png'),file(Buffer.from('%PDF-1.4\n'))]){
  assert.throws(()=>validateAttachment(bad),{status:400});
 }
});
test('size cap and route-specific HTTP body limits are enforced',()=>{
 assert.throws(()=>validateAttachment(file(Buffer.alloc(MAX_ATTACHMENT_BYTES+1))),{status:413});
 assert.equal(bodyLimit('POST',new URLSearchParams('action=absence-submit')),ABSENCE_BODY_BYTES);
 assert.equal(bodyLimit('POST',new URLSearchParams('action=attendance')),DEFAULT_BODY_BYTES);
 assert.equal(bodyLimit('GET',new URLSearchParams('action=absence-submit')),DEFAULT_BODY_BYTES);
 const large=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(MAX_ATTACHMENT_BYTES-15,32),Buffer.from('%%EOF\n')]);
 assert.equal(large.length,MAX_ATTACHMENT_BYTES);
 assert.equal(validateAttachment(file(large)).bytes.length,MAX_ATTACHMENT_BYTES);
});
let id;
test('submission stores metadata and binary atomically and returns only metadata in detail',async()=>{
 const result=await submit(1,file());assert.equal(result.status,201);
 id=(await result.json()).id;
 const detail=await (await call('a','absence-detail',undefined,{id})).json();
 assert.deepEqual(detail.attachment,{original_name:'bukti.pdf',mime_type:'application/pdf',file_size:pdf.length});
 assert.equal(detail.request.has_attachment,1);
 assert.equal(JSON.stringify(detail).includes('storage_key'),false);
 assert.equal(JSON.stringify(detail).includes('sha256'),false);
 assert.equal(count('absence_attachments'),1);
 assert.equal(count('absence_attachment_blobs'),1);
});
test('download is owner/admin only, binary and forced attachment with no cache',async()=>{
 for(const user of ['a','admin']){
  const res=await call(user,'absence-attachment',undefined,{id});
  assert.equal(res.status,200);
  assert.equal(res.headers.get('content-disposition'),'attachment; filename="lampiran.pdf"');
  assert.equal(res.headers.get('cache-control'),'private, no-store');
  assert.equal(res.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()),pdf);
 }
 assert.equal((await call('b','absence-attachment',undefined,{id})).status,404);
 assert.equal((await call(null,'absence-attachment',undefined,{id})).status,401);
 assert.equal((await call('a','absence-attachment',{id})).status,405);
});
test('invalid attachment or audit failure rolls back request, reservations and binary',async()=>{
 const tables=['absence_requests','absence_request_days','absence_day_reservations','absence_attachments','absence_attachment_blobs','absence_request_history'];
 const before=tables.map(count);
 assert.equal((await submit(2,file(pdf,'bad.png','image/png'))).status,400);
 assert.deepEqual(tables.map(count),before);
 sqlite.exec("CREATE TRIGGER test_attachment_audit_failure BEFORE INSERT ON absence_request_history BEGIN SELECT RAISE(ABORT,'test failure'); END");
 try{assert.equal((await submit(2,file())).status,500);}
 finally{sqlite.exec('DROP TRIGGER test_attachment_audit_failure');}
 assert.deepEqual(tables.map(count),before);
});
test('cancelled requests retain their attachment and integrity corruption fails closed',async()=>{
 const cancel=await call('a','absence-cancel',{id});
 assert.equal(cancel.status,200);
 assert.equal((await call('a','absence-attachment',undefined,{id})).status,200);
 sqlite.prepare('UPDATE absence_attachment_blobs SET content=?').run(Buffer.alloc(pdf.length,42));
 assert.equal((await call('admin','absence-attachment',undefined,{id})).status,500);
});
test('actual API accepts a maximum-sized attachment and rejects action confusion',async()=>{
 const large=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(MAX_ATTACHMENT_BYTES-15,32),Buffer.from('%%EOF\n')]);
 const res=await submit(3,file(large));
 assert.equal(res.status,201);
 const req=new Request(origin+'/api/app?action=absence-submit',{method:'POST',headers:{origin,cookie:'hadir_session='+tokens.a},body:JSON.stringify({action:'attendance'})});
 assert.equal((await api(req)).status,400);
});
