import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=(p)=>readFileSync(new URL(p,import.meta.url),'utf8');
test('recap footer reuses exact history pagination classes',()=>{
 const history=source('../src/ui.tsx'),recap=source('../src/MemberRecapTable.tsx');
 for(const cls of ['history-pagination','history-pagination-info','history-pagination-controls','history-page-size','history-page-nav','history-page-button']){
  assert.ok(history.includes(cls),'History missing '+cls);
  assert.ok(recap.includes(cls),'Recap missing '+cls);
 }
});
test('five requested recap columns preserved',()=>{
 const s=source('../src/MemberRecapTable.tsx');
 for(const name of ['Anggota','Hadir','Tidak hadir','Izin','Sakit'])assert.ok(s.includes('<th>'+name+'</th>'));
 assert.doesNotMatch(s,/<th>(Perlu tinjauan|Riwayat)<\/th>/);
});
test('full member row remains keyboard operable',()=>{
 const s=source('../src/MemberRecapTable.tsx');
 assert.match(s,/onClick=\{\(\)=>setSelected\(row\.userId\)\}/);
 assert.match(s,/role="button" tabIndex=\{0\}/);
 assert.match(s,/event\.key==='Enter'\|\|event\.key===' '/);
});
test('recap uses history scale and padding',()=>{
 const css=source('../src/member-recap-period.css');
 for(const token of ['font-size: 8px;', 'letter-spacing: 1px;', 'padding: 15px 20px;', 'padding: 16px 20px;', 'font-size: 11px;', 'width: 30px;', 'height: 30px;'])assert.ok(css.includes(token),token);
 assert.match(css,/text-transform: uppercase/);
});
test('mobile recap scrolls like history instead of becoming a card grid',()=>{
 const globalCss=source('../src/styles.css'),localCss=source('../src/member-recap-period.css');
 assert.doesNotMatch(globalCss,/\.member-recap-table tbody \{ display: grid/);
 assert.match(localCss,/\.member-recap \.member-recap-wrap \{ overflow-x: auto; \}/);
 assert.match(localCss,/\.member-recap-table \{ min-width: 760px; \}/);
});

test('filter controls have no focus rings and keep keyboard focus feedback without affecting other UI',()=>{
 const globalCss=source('../src/styles.css');
 const localCss=source('../src/member-recap-period.css');
 const recap=source('../src/MemberRecapTable.tsx');
 assert.match(globalCss,/\.daily-recap-search-field:focus-within\s*\{\s*outline:\s*3px solid/);
 assert.match(globalCss,/\.member-recap :is\(button,input,select\):focus-visible\s*\{\s*outline:\s*3px solid/);
 assert.match(localCss,/\.member-recap \.daily-recap-filters :is\(input, select, button\):focus-visible\s*\{\s*outline:\s*none;/);
 assert.match(localCss,/\.member-recap \.daily-recap-filters \.daily-recap-search-field:focus-within\s*\{\s*outline:\s*none;/);
 assert.match(localCss,/\.member-recap \.daily-recap-filters \.daily-recap-search-field input:focus-visible\s*\{\s*outline:\s*none;/);
 assert.match(localCss,/background-color:\s*#f6f9f2/);
 for (const token of ['className="daily-recap-filters"','className="daily-recap-search-field"'])
  assert.ok(recap.includes(token));
 assert.match(recap,/className="[^"]*daily-recap-reset[^"]*"/);
});
