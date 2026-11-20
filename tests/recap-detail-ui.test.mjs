import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recapReviewLabel, recapAbsenceLabel, recapAttendanceKind, recapInstantLabel,
  recapPhotoHref, recapAttachmentHref, recapDetailSummary, recapCancellationSummary,
} from '../src/recap-detail-model.ts';
import { getDailyRecapDetail, RecapApiError } from '../src/recap-api.ts';

const row={userId:'user-1',name:'Anggota',email:'a@example.invalid',date:'2026-11-19',
  status:'late',checkIn:{id:'in',time:'2026-11-19T00:45:00.000Z',review:'pending',timezone:'Asia/Makassar'},
  checkOut:null,absence:null,provisional:true,issues:[],cancellationCount:0,activeRecordCount:1,
  hasEvidence:true,eligible:true,identitySource:'history'};
function detail(overrides={}){
 return {date:'2026-11-19',userId:'user-1',summary:row,context:{coverage:'complete',timezone:'Asia/Makassar'},
  records:[],cancellations:[],absences:[],...overrides};
}
test('detail summary keeps status and time from selected daily row',()=>{
 const result=recapDetailSummary(detail());
 assert.deepEqual(result,{name:'Anggota',email:'a@example.invalid',date:'2026-11-19',
  status:'Terlambat',note:'Menunggu tinjauan',checkIn:'08:45',checkOut:'—'});
});
test('detail identity falls back safely for deleted member with unavailable name',()=>{
 assert.equal(recapDetailSummary(detail({summary:{...row,name:null,email:'old@example.invalid'}})).name,'old@example.invalid');
 assert.equal(recapDetailSummary(detail({summary:{...row,name:null,email:null}})).name,'Anggota tanpa nama');
});
test('review and absence labels preserve distinct pending rejected and cancelled',()=>{
 assert.deepEqual(['pending','approved','rejected'].map(recapReviewLabel),
  ['Menunggu tinjauan','Disetujui','Ditolak']);
 assert.deepEqual(['pending','approved','rejected','cancelled'].map(recapAbsenceLabel),
  ['Menunggu persetujuan','Disetujui','Ditolak','Dibatalkan']);
});
test('in and out are identified independently while unknown kind is not invented',()=>{
 assert.equal(recapAttendanceKind('in'),'Absen masuk');
 assert.equal(recapAttendanceKind('out'),'Absen pulang');
 assert.equal(recapAttendanceKind('unknown'),'Jenis absensi tidak dikenal');
});
test('timestamp formatter uses historical timezone or marks UTC as unknown timezone',()=>{
 const instant='2026-11-19T00:45:00.000Z';
 assert.match(recapInstantLabel(instant,'Asia/Makassar'),/08:45/);
 assert.match(recapInstantLabel(instant,'Asia/Makassar'),/Asia\/Makassar/);
 assert.match(recapInstantLabel(instant,null),/00:45.*UTC/);
 assert.equal(recapInstantLabel('invalid',null),'—');
 assert.equal(recapInstantLabel(null,'Asia/Makassar'),'—');
});
test('private file links are constructed only from record or request IDs',()=>{
 const id='foo &?=#bar';
 assert.equal(recapPhotoHref({id}),'/api/app?action=photo&id=foo%20%26%3F%3D%23bar');
 assert.equal(recapAttachmentHref({id}),'/api/app?action=absence-attachment&id=foo%20%26%3F%3D%23bar');
});
test('cancellation retains reason and retake authorization without photo references',()=>{
 const cancel={id:'x',user_id:'user-1',date:'2026-11-19',kind:'in',time:'2026-11-19T00:45:00Z',
  timezone:'Asia/Makassar',reason:'Foto tidak sesuai',cancelled_by:'admin',
  cancelled_at:'2026-11-19T00:55:00Z',retry_authorized_at:'2026-11-19T01:00:00Z'};
 const result=recapCancellationSummary(cancel);
 assert.equal(result.kind,'Absen masuk');assert.equal(result.reason,'Foto tidak sesuai');
 assert.equal(result.retakeAuthorized,true);assert.equal(JSON.stringify(result).includes('photo'),false);
});
test('detail client uses encoded date/id with GET and prevents caching',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async(url,opts)=>{
  const parsed=new URL(url,'http://localhost');
  assert.equal(parsed.searchParams.get('action'),'daily-recap-detail');
  assert.equal(parsed.searchParams.get('date'),'2026-11-19');
  assert.equal(parsed.searchParams.get('userId'),'user & +');
  assert.equal(opts.method,'GET');assert.equal(opts.cache,'no-store');
  return Response.json(detail({userId:'user & +'}));
 });
 const result=await getDailyRecapDetail('2026-11-19','user & +');
 assert.equal(result.userId,'user & +');assert.equal(mock.mock.callCount(),1);
});
test('detail client propagates access denial and request cancellation',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({error:'Akses ditolak'},{status:403}));
 await assert.rejects(getDailyRecapDetail('2026-11-19','a'),e=>e instanceof RecapApiError&&e.status===403);
 const abort=new DOMException('Aborted','AbortError');
 mock.mock.mockImplementation(async()=>{throw abort;});
 await assert.rejects(getDailyRecapDetail('2026-11-19','a'),e=>e===abort);
});
