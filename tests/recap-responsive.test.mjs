import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recapWrappedTabTarget } from '../src/recap-accessibility.ts';
import { recapPageInfo } from '../src/recap-view-model.ts';
import { canAuthorizeRecapRetake, canCancelRecapRecord } from '../src/recap-actions.ts';

test('forward Tab wraps from the final control to the first',()=>{
 assert.equal(recapWrappedTabTarget(3,4,false),0);
 assert.equal(recapWrappedTabTarget(1,4,false),null);
});
test('Shift+Tab wraps from the first control to the final control',()=>{
 assert.equal(recapWrappedTabTarget(0,4,true),3);
 assert.equal(recapWrappedTabTarget(1,4,true),null);
});
test('focus outside a dialog is directed to an available control',()=>{
 assert.equal(recapWrappedTabTarget(-1,3,false),0);
 assert.equal(recapWrappedTabTarget(-1,3,true),2);
 assert.equal(recapWrappedTabTarget(7,3,false),0);
});
test('zero focusable controls uses dialog fallback instead of invalid array index',()=>{
 assert.equal(recapWrappedTabTarget(0,0,false),null);
 assert.equal(recapWrappedTabTarget(-1,-1,true),null);
});
test('one control and invalid focus counts never trap focus incorrectly',()=>{
 assert.equal(recapWrappedTabTarget(0,1,false),0);
 assert.equal(recapWrappedTabTarget(0,1,true),0);
 assert.equal(recapWrappedTabTarget(0,Number.NaN,false),null);
});
test('mobile labels cover all visible columns without copying sensitive reasons',()=>{
 const source=readFileSync(new URL('../src/DailyRecapTable.tsx',import.meta.url),'utf8');
 for(const label of ['Anggota','Masuk','Pulang','Status','Keterangan','Detail']){
  assert.ok(source.includes('className="daily-recap-cell-label">'+label+'</span>'),label);
 }
 assert.equal(source.includes('row.absence.reason'),false);
});
test('responsive stylesheet isolates card layout from legacy tables and modals',()=>{
 const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
 assert.match(css,/\@media \(max-width: 760px\)/);
 assert.match(css,/\.daily-recap-table tbody tr\s*\{/);
 assert.match(css,/\.daily-recap-modal \{ max-height: calc\(100dvh - 24px\)/);
 assert.match(css,/\.daily-recap-pages nav button \{ min-width: 44px; min-height: 44px; \}/);
});
test('detail modal has focus restoration, Escape handling, and accessible close',()=>{
 const source=readFileSync(new URL('../src/DailyRecapDetail.tsx',import.meta.url),'utf8');
 for(const token of ['recapWrappedTabTarget','if (event.key === \'Escape\')','aria-modal="true"','opener?.isConnected','closeButton.current?.focus()', 'dialogRef']){
  assert.ok(source.includes(token),token);
 }
});
test('server pagination stays correct when 50-member page is partial',()=>{
 const info=recapPageInfo({page:3,pageSize:50,total:112,totalPages:3,rows:[]});
 assert.deepEqual(info,{from:101,to:112,total:112,page:3,totalPages:3});
});
test('mobile presentation cannot override server safety rules for retake or checkout',()=>{
 const record={id:'in',kind:'in'};
 const detail={date:'2026-11-19',records:[record,{id:'out',kind:'out'}],cancellations:[],absences:[]};
 assert.equal(canCancelRecapRecord(detail,record),false);
 const cancel={id:'c',date:'2026-11-19',kind:'in',retry_authorized_at:null};
 assert.equal(canAuthorizeRecapRetake({...detail,records:[],cancellations:[cancel]},cancel,'2026-11-20'),false);
});
