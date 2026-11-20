import test from 'node:test';
import assert from 'node:assert/strict';
import { canAuthorizeRecapRetake, canCancelRecapRecord, canReviewRecapRecord, validCancellationReason, submitRecapAction, RecapActionError } from '../src/recap-actions.ts';
const today='2026-11-19';
const record=(kind='in',review='pending')=>({id:'r-'+kind,user_id:'employee',date:today,kind,review});
const cancel=(id='c-in',kind='in',extra={})=>({id,user_id:'employee',date:today,kind,retry_authorized_at:null,...extra});
const detail=(extras={})=>({date:today,records:[],cancellations:[],absences:[],...extras});

test('review action sends only record ID and an allowed review state',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async (url,options)=>{
  assert.equal(url,'/api/app');assert.equal(options.method,'POST');
  assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
  assert.equal(options.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(options.body),{action:'review',id:'r1',review:'approved'});
  return Response.json({ok:true});
 });
 assert.deepEqual(await submitRecapAction({type:'review',id:'r1',review:'approved'}),{ok:true});
 assert.equal(mock.mock.callCount(),1);
});
test('cancellation trims a valid reason and preserves warning from already committed cancellation',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async (_url,options)=>{
  assert.deepEqual(JSON.parse(options.body),{action:'cancel-attendance',id:'r2',reason:'Foto tidak sesuai'});
  return Response.json({ok:true,warning:'Pembersihan foto tertunda.'});
 });
 assert.deepEqual(await submitRecapAction({type:'cancel',id:'r2',reason:'  Foto tidak sesuai  '}),{ok:true,warning:'Pembersihan foto tertunda.'});
 assert.equal(mock.mock.callCount(),1);
});
test('invalid cancellation reasons are rejected before any network request',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({ok:true}));
 assert.equal(validCancellationReason('  benar '),true);
 for (const reason of ['', '    ', '1234', 'a'.repeat(501)]){
  assert.equal(validCancellationReason(reason),false);
  await assert.rejects(submitRecapAction({type:'cancel',id:'r2',reason}),e=>e instanceof RecapActionError&&e.status===400);
 }
 assert.equal(mock.mock.callCount(),0);
});
test('retake permission sends the cancelled record ID',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async(_url,options)=>{
  assert.deepEqual(JSON.parse(options.body),{action:'authorize-retake',id:'c1'});
  return Response.json({ok:true});
 });
 await submitRecapAction({type:'retake',id:'c1'});
 assert.equal(mock.mock.callCount(),1);
});
test('HTTP errors and malformed success payloads never appear as success',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({error:'Bukan admin'},{status:403}));
 await assert.rejects(submitRecapAction({type:'retake',id:'c1'}),e=>e instanceof RecapActionError&&e.status===403&&e.message==='Bukan admin');
 mock.mock.mockImplementation(async()=>Response.json({message:'not saved'}));
 await assert.rejects(submitRecapAction({type:'retake',id:'c1'}),e=>e instanceof RecapActionError);
});
test('review gates prevent redundant writes but allow changes to rejected evidence',()=>{
 assert.equal(canReviewRecapRecord(record('in','approved'),'approved'),false);
 assert.equal(canReviewRecapRecord(record('in','rejected'),'approved'),true);
 assert.equal(canReviewRecapRecord(record('out','pending'),'rejected'),true);
 assert.equal(canReviewRecapRecord(record('other','pending'),'approved'),false);
});
test('cancel check-in requires checkout cancellation first, checkout is cancelable',()=>{
 const entered=record('in'),exited=record('out');
 assert.equal(canCancelRecapRecord(detail({records:[entered,exited]}),entered),false);
 assert.equal(canCancelRecapRecord(detail({records:[entered,exited]}),exited),true);
 assert.equal(canCancelRecapRecord(detail({records:[entered]}),entered),true);
});
test('retake only on office today and most recent cancellation for the same kind',()=>{
 const newest=cancel('new'),old=cancel('old');
 const d=detail({cancellations:[newest,old]});
 assert.equal(canAuthorizeRecapRetake(d,newest,today),true);
 assert.equal(canAuthorizeRecapRetake(d,old,today),false);
 assert.equal(canAuthorizeRecapRetake(d,newest,'2026-11-20'),false);
 assert.equal(canAuthorizeRecapRetake({...d,date:'2026-11-18'},newest,today),false);
});
test('retake is not advertised when active attendance, approval or prior authorization exists',()=>{
 const c=cancel(),d=detail({cancellations:[c]});
 assert.equal(canAuthorizeRecapRetake({...d,records:[record()]},c,today),false);
 assert.equal(canAuthorizeRecapRetake({...d,absences:[{status:'approved',reserved:true}]},c,today),false);
 assert.equal(canAuthorizeRecapRetake(d,{...c,retry_authorized_at:'2026-11-19T02:00:00Z'},today),false);
 assert.equal(canAuthorizeRecapRetake(d,{...c,kind:'invalid'},today),false);
});
test('separate cancellation kinds retain independent most-recent histories',()=>{
 const a=cancel('in-new','in'),b=cancel('out-new','out');
 const d=detail({cancellations:[b,a]});
 assert.equal(canAuthorizeRecapRetake(d,a,today),true);
 assert.equal(canAuthorizeRecapRetake(d,b,today),true);
});
