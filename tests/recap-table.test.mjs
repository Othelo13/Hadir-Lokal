import test from 'node:test';
import assert from 'node:assert/strict';
import { recapTableRow,recapPageInfo } from '../src/recap-view-model.ts';

function sample(overrides={}){
  return {userId:'stable-id',date:'2026-11-19',name:'Anggota',email:'member@example.invalid',
    checkIn:null,checkOut:null,status:null,absence:null,provisional:false,hasEvidence:false,
    issues:[],cancellationCount:0,activeRecordCount:0,eligible:true,identitySource:'history',...overrides};
}
test('daily table shows safe status and historical event times',()=>{
 const row=recapTableRow(sample({status:'late',checkIn:{id:'in',time:'2026-11-19T00:45:00Z',review:'approved',timezone:'Asia/Makassar'}}));
 assert.equal(row.userId,'stable-id');assert.equal(row.name,'Anggota');assert.equal(row.checkIn,'08:45');
 assert.equal(row.checkOut,'—');assert.equal(row.statusLabel,'Terlambat');assert.equal(row.note,'—');
});
test('approved absences show generic notes rather than medical reasons',()=>{
 const row=recapTableRow(sample({status:'sick',absence:{id:'r',type:'sick'},reason:'Private diagnosis'}));
 assert.equal(row.statusLabel,'Sakit');assert.equal(row.note,'Disetujui');
 assert.equal(JSON.stringify(row).includes('Private diagnosis'),false);
});
test('missing identity and unknown event timezone remain explicit',()=>{
 const row=recapTableRow(sample({name:null,email:null,checkOut:{id:'o',time:'2026-11-19T00:45:00Z',review:'pending',timezone:null}}));
 assert.equal(row.name,'Anggota tanpa nama');assert.equal(row.email,'—');
 assert.equal(row.checkOut,'00:45 UTC');assert.equal(row.statusLabel,'—');
});
test('recap note prioritizes conflicting evidence over provisional review',()=>{
 const conflict=recapTableRow(sample({status:'present',issues:['attendance_absence_conflict'],provisional:true}));
 assert.equal(conflict.note,'Perlu pemeriksaan');
 const pending=recapTableRow(sample({status:'present',provisional:true}));
 assert.equal(pending.note,'Menunggu tinjauan');
});
test('page information comes from backend total rather than loaded rows',()=>{
 const response={rows:[sample()],page:3,pageSize:20,total:53,totalPages:3};
 assert.deepEqual(recapPageInfo(response),{from:41,to:53,total:53,page:3,totalPages:3});
 assert.deepEqual(recapPageInfo({...response,rows:[],page:1,total:0,totalPages:1}),{from:0,to:0,total:0,page:1,totalPages:1});
});
