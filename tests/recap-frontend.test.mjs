import test from 'node:test';
import assert from 'node:assert/strict';
import { getDailyRecap,getDailyRecapDetail,RecapApiError } from '../src/recap-api.ts';
import { recapStatusLabel,formatRecapTime,recapNote,coverageMessage } from '../src/recap-presentation.ts';

test('recap GET uses same-origin no-store and encoded filter parameters',async t=>{
 const signal=new AbortController().signal;
 const mock=t.mock.method(globalThis,'fetch',async(url,init)=>{
  const p=new URL(url,'http://localhost').searchParams;
  assert.equal(p.get('action'),'daily-recap');assert.equal(p.get('q'),'A & B');
  assert.equal(p.get('date'),'2026-11-19');assert.equal(p.get('page'),'2');assert.equal(p.get('pageSize'),'20');
  assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');assert.equal(init.credentials,'same-origin');
  assert.equal(init.signal,signal);assert.equal(init.body,undefined);
  return Response.json({rows:[],total:0});
 });
 assert.equal((await getDailyRecap({date:'2026-11-19',q:' A & B ',page:2,pageSize:20},signal)).total,0);
 assert.equal(mock.mock.callCount(),1);
});
test('default recap date is omitted and detail encodes stable IDs',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async(url)=>{
  const p=new URL(url,'http://localhost').searchParams;
  if(p.get('action')==='daily-recap')assert.equal(p.has('date'),false);
  else{assert.equal(p.get('action'),'daily-recap-detail');assert.equal(p.get('userId'),'id & +');assert.equal(p.get('date'),'2026-11-19');}
  return Response.json({});
 });
 await getDailyRecap();await getDailyRecapDetail('2026-11-19','id & +');assert.equal(mock.mock.callCount(),2);
});
test('recap client preserves authorization errors and handles non-JSON failures',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({error:'Tidak diizinkan.'},{status:403}));
 await assert.rejects(getDailyRecap(),e=>e instanceof RecapApiError&&e.status===403&&e.message==='Tidak diizinkan.');
 mock.mock.mockImplementation(async()=>new Response('bad gateway',{status:502}));
 await assert.rejects(getDailyRecap(),e=>e instanceof RecapApiError&&e.status===502);
 mock.mock.mockImplementation(async()=>new Response('invalid',{status:200}));
 await assert.rejects(getDailyRecap(),e=>e instanceof RecapApiError&&e.status===200);
});
test('recap client preserves aborted request rather than converting it to an API error',async t=>{
 const error=new DOMException('Aborted','AbortError');
 t.mock.method(globalThis,'fetch',async()=>{throw error;});
 await assert.rejects(getDailyRecap(),e=>e===error);
});
test('recap labels do not introduce a new attendance status',()=>{
 assert.deepEqual(['present','late','leave','sick',null].map(recapStatusLabel),['Hadir','Terlambat','Izin','Sakit','—']);
});
test('recap times use historical timezone or explicit UTC when unknown',()=>{
 const time='2026-11-19T00:45:00.000Z';
 assert.equal(formatRecapTime({time,timezone:'Asia/Makassar'}),'08:45');
 assert.equal(formatRecapTime({time,timezone:'Asia/Jakarta'}),'07:45');
 assert.equal(formatRecapTime({time,timezone:null}),'00:45 UTC');
 assert.equal(formatRecapTime(null),'—');
 assert.equal(formatRecapTime({time:'invalid',timezone:null}),'—');
});
test('recap notes prioritize inconsistency and omit sensitive reasons',()=>{
 const row={issues:[],status:null,provisional:false,cancellationCount:0};
 assert.equal(recapNote(row),'—');
 assert.equal(recapNote({...row,status:'sick'}),'Disetujui');
 assert.equal(recapNote({...row,provisional:true}),'Menunggu tinjauan');
 assert.equal(recapNote({...row,cancellationCount:1}),'Ada riwayat pembatalan');
 assert.equal(recapNote({...row,issues:['attendance_absence_conflict'],status:'sick'}),'Perlu pemeriksaan');
});
test('coverage messages distinguish incomplete, future and nonworking dates',()=>{
 assert.match(coverageMessage({coverage:'unknown'}),/belum tersedia/);
 assert.match(coverageMessage({coverage:'partial'}),/terbatas/);
 assert.match(coverageMessage({coverage:'future'}),/mendatang/);
 assert.match(coverageMessage({coverage:'complete',workday:false}),/Bukan hari kerja/);
 assert.equal(coverageMessage({coverage:'complete',workday:true}),null);
});
