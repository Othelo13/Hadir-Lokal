import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const component=readFileSync(new URL('../src/MemberRecapTable.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/member-recap-period.css',import.meta.url),'utf8');
test('recap table no longer displays historical coverage banner or duplicate date range',()=>{
 assert.doesNotMatch(component,/className="member-recap-period-caption"/);
 assert.doesNotMatch(component,/recap\.unverifiedDates\s*>\s*0/);
 assert.doesNotMatch(component,/Ada \{recap\.unverifiedDates\}/);
 assert.doesNotMatch(css,/\.member-recap-period-caption/);
});
test('period selector and member detail date remain available',()=>{
 assert.match(component,/Pilih periode rekap/);
 assert.match(component,/type=\{period==='month'\?'month':'date'\}/);
 assert.match(component,/function periodDescription\(/);
 assert.match(component,/\{periodDescription\(recap\)\}/);
 assert.match(component,/className="table-wrap member-recap-wrap"/);
});
test('clickable member rows and attendance columns are preserved',()=>{
 assert.match(component,/onClick=\{\(\)=>setSelected\(row\.userId\)\}/);
 for(const title of ['Anggota','Hadir','Tidak hadir','Izin','Sakit'])
  assert.ok(component.includes('<th>'+title+'</th>'),title);
});
