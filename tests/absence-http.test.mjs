import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync,readFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { scryptSync } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import QRCode from 'qrcode';
import jpeg from 'jpeg-js';
import { officeLocal } from '../server/attendance-write.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
async function freePort(){
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
 const port=socket.address().port;await new Promise((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));return port;
}
function photo(code){
 const qr=QRCode.create('HADIR:'+code,{errorCorrectionLevel:'M'}).modules;
 const width=640,height=480,scale=8,side=qr.size*scale;
 const data=Buffer.alloc(width*height*4,255),left=Math.floor((width-side)/2),top=Math.floor((height-side)/2);
 for(let y=0;y<side;y++)for(let x=0;x<side;x++)if(qr.get(Math.floor(y/scale),Math.floor(x/scale))){
  const i=((top+y)*width+left+x)*4;data[i]=data[i+1]=data[i+2]=0;
 }
 return jpeg.encode({data,width,height},90).data;
}
test('real HTTP login, absence attachment, QR attendance, cancellation, retake and daily recap workflow', {timeout:90000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'hadir-http-')),file=path.join(dir,'hadir.sqlite');
 const db=new DatabaseSync(file);
 let child,exited;
 t.after(async()=>{
  if(child&&child.exitCode===null&&child.signalCode===null)child.kill();
  if(exited)await exited;
  db.close();rmSync(dir,{recursive:true,force:true});
 });
 db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
 const zone=['Asia/Makassar','Asia/Jakarta','Asia/Jayapura'].find(z=>{const clock=officeLocal(new Date(),z).clock;return clock>='01:00'&&clock<'23:00';})??'Asia/Makassar';
 db.prepare("INSERT INTO config VALUES(1,'[0,1,2,3,4,5,6]','00:00','00:01',?,1)").run(zone);
 const password='test-only-password',salt='0123456789abcdef0123456789abcdef',hash='scrypt:'+salt+':'+scryptSync(password,salt,64).toString('hex');
 for(const [id,role] of [['a','employee'],['b','employee'],['admin','admin']])
  db.prepare('INSERT INTO members VALUES(?,?,?,?,1,?)').run(id+'@example.invalid',id,id,role,hash);
 db.exec("INSERT INTO codes VALUES('qr-test','Test QR',1,'2026-01-01')");
 const port=await freePort(),origin='http://127.0.0.1:'+port;
 child=spawn(process.execPath,['--input-type=module','-e',"import { buildServer } from './scripts/build-server.mjs'; buildServer(); await import('./server/index.mjs');"],{
  cwd:root,env:{...process.env,HADIR_DEV:'1',HOST:'127.0.0.1',PORT:String(port),HADIR_DATA_DIR:dir,HADIR_PUBLIC_ORIGIN:''},
  stdio:['ignore','pipe','pipe']
 });
 let output='';
 child.stdout.on('data',c=>{output+=c;});child.stderr.on('data',c=>{output+=c;});
 exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve);});
 let healthy=false;
 for(let i=0;i<150;i++){
  if(child.exitCode!==null||child.signalCode!==null)break;
  try{const res=await fetch(origin+'/health',{signal:AbortSignal.timeout(500)});if(res.ok){healthy=true;break;}}catch{}
  await delay(100);
 }
 assert.ok(healthy,output);
 const cookies={};
 async function call(user,action,body,params={}){
  const url=new URL('/api/app',origin);url.searchParams.set('action',action);
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  const headers={};
  if(cookies[user])headers.cookie=cookies[user];
  if(body!==undefined){headers.origin=origin;headers['content-type']='application/json';}
  return fetch(url,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify({action,...body})}),signal:AbortSignal.timeout(10000)});
 }
 async function expect(res,status){assert.equal(res.status,status,await res.clone().text());return res;}
 async function json(res,status=200){return (await expect(res,status)).json();}
 for(const user of ['a','b','admin']){
  const res=await expect(await call(user,'login',{email:user+'@example.invalid',password}),200);
  cookies[user]=res.headers.get('set-cookie').split(';')[0];await res.arrayBuffer();
 }
 const state=await json(await call('a','state'));
 const date=state.today.date;
 async function recap(id='a'){
  const list=await json(await call('admin','daily-recap',undefined,{date,pageSize:'50'}));
  const detail=await json(await call('admin','daily-recap-detail',undefined,{date,userId:id}));
  const row=list.rows.find(r=>r.userId===id);
  assert.ok(row);assert.deepEqual(detail.summary,row);
  return detail;
 }
 assert.equal((await call('a','daily-recap',undefined,{date})).status,403);
 assert.equal((await call('b','daily-recap-detail',undefined,{date,userId:'a'})).status,403);
 assert.equal((await call(null,'daily-recap',undefined,{date})).status,401);
 assert.equal((await recap()).summary.status,null);
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
 const absence=await json(await call('a','absence-submit',{type:'sick',startDate:date,endDate:date,reason:'Test pengajuan',
  attachment:{name:'bukti.pdf',mimeType:'application/pdf',base64:pdf.toString('base64')}}),201);
 assert.equal((await call('b','absence-attachment',undefined,{id:absence.id})).status,404);
 const download=await expect(await call('admin','absence-attachment',undefined,{id:absence.id}),200);
 assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);
 assert.match(download.headers.get('content-disposition'),/^attachment/);
 const pending=await recap();
 assert.equal(pending.summary.status,null);
 assert.equal(pending.absences[0].status,'pending');
 const initial=await json(await call('a','challenge',{}));
 await json(await call('admin','absence-approve',{id:absence.id}));
 const approved=await recap();
 assert.equal(approved.summary.status,'sick');
 assert.equal(approved.summary.checkIn,null);
 assert.equal(approved.absences[0].status,'approved');
 assert.equal(approved.absences[0].history.length,2);
 assert.ok(approved.absences[0].attachment.downloadUrl);
 const safeList=await json(await call('admin','daily-recap',undefined,{date}));
 assert.equal(JSON.stringify(safeList).includes('Test pengajuan'),false);
 const bytes=photo('qr-test'),payload='data:image/jpeg;base64,'+bytes.toString('base64');
 assert.equal((await call('a','attendance',{kind:'in',challenge:initial.id,photo:payload})).status,409);
 assert.equal((await call('a','challenge',{})).status,409);
 await json(await call('admin','absence-cancel',{id:absence.id,reason:'Anggota kembali masuk'}));
 const released=await recap();
 assert.equal(released.summary.status,null);
 assert.equal(released.absences[0].status,'cancelled');
 assert.equal(released.absences[0].reserved,false);
 const challenge=await json(await call('a','challenge',{}));
 assert.equal((await call('a','attendance',{kind:'in',challenge:challenge.id,photo:'data:image/jpeg;base64,AAAA'})).status,400);
 await json(await call('a','attendance',{kind:'in',challenge:challenge.id,photo:payload}));
 let entry=db.prepare("SELECT * FROM records WHERE user_id='a' AND kind='in'").get();
 assert.ok(entry);assert.ok(existsSync(path.join(dir,entry.photo)));
 const present=await recap(),expected=entry.status==='late'?'late':'present';
 assert.equal(present.summary.status,expected);
 assert.equal(present.summary.provisional,true);
 assert.equal(present.summary.checkIn.id,entry.id);
 await json(await call('admin','review',{id:entry.id,review:'rejected'}));
 const rejected=await recap();
 assert.equal(rejected.summary.status,null);assert.equal(rejected.summary.checkIn,null);
 assert.equal(rejected.records[0].review,'rejected');
 await json(await call('admin','review',{id:entry.id,review:'approved'}));
 const restored=await recap();
 assert.equal(restored.summary.status,expected);assert.equal(restored.summary.provisional,false);
 const selfie=await expect(await call('a','photo',undefined,{id:entry.id}),200);
 assert.deepEqual(Buffer.from(await selfie.arrayBuffer()),bytes);
 assert.equal((await call('b','photo',undefined,{id:entry.id})).status,404);
 const out=await json(await call('a','challenge',{}));
 await json(await call('a','attendance',{kind:'out',challenge:out.id,photo:payload}));
 let exit=db.prepare("SELECT * FROM records WHERE user_id='a' AND kind='out'").get();
 const complete=await recap();
 assert.equal(complete.summary.checkOut.id,exit.id);
 assert.equal(complete.summary.status,expected);
 assert.equal((await call('admin','cancel-attendance',{id:entry.id,reason:'Test pembatalan'})).status,409);
 await json(await call('admin','cancel-attendance',{id:exit.id,reason:'Test pembatalan'}));
 await json(await call('admin','cancel-attendance',{id:entry.id,reason:'Test pembatalan'}));
 assert.equal(existsSync(path.join(dir,entry.photo)),false);
 assert.equal(existsSync(path.join(dir,exit.photo)),false);
 const cancelled=await recap();
 assert.equal(cancelled.summary.status,null);assert.equal(cancelled.records.length,0);
 assert.equal(cancelled.cancellations.length,2);
 assert.ok(cancelled.cancellations.every(c=>c.photoUrl===null));
 const retry=await json(await call('a','challenge',{}));
 assert.equal((await call('a','attendance',{kind:'in',challenge:retry.id,photo:payload})).status,403);
 await json(await call('admin','authorize-retake',{id:entry.id}));
 const authorized=await recap();
 assert.ok(authorized.cancellations.find(c=>c.id===entry.id).retry_authorized_at);
 await json(await call('a','attendance',{kind:'in',challenge:retry.id,photo:payload}));
 const retaken=await recap();
 assert.ok(['present','late'].includes(retaken.summary.status));
 assert.notEqual(retaken.summary.checkIn.id,entry.id);
 assert.equal(retaken.cancellations.length,2);
 assert.equal(db.prepare('SELECT count(*) n FROM records').get().n,1);
 assert.equal(db.prepare('SELECT count(*) n FROM attendance_cancellations').get().n,2);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
