import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('recap column headings and numeric body cells align centrally, but member names stay left', () => {
 const css = readFileSync(new URL('../src/member-recap-period.css', import.meta.url), 'utf8');
 const heading = css.match(/\.member-recap-table th\s*\{([^}]+)\}/);
 const identity = css.match(/\.member-recap-table td:first-child\s*\{([^}]+)\}/);
 const totals = css.match(/\.member-recap-table td:not\(:first-child\)\s*\{([^}]+)\}/);
 assert.ok(heading && identity && totals);
 assert.match(heading[1], /text-align:\s*center\s*;/);
 assert.match(identity[1], /text-align:\s*left\s*;/);
 assert.match(totals[1], /text-align:\s*center\s*;/);
 assert.match(totals[1], /font-variant-numeric:\s*tabular-nums\s*;/);
});
test('member recap still shows four count columns and keeps row drilldown', () => {
 const jsx = readFileSync(new URL('../src/MemberRecapTable.tsx', import.meta.url), 'utf8');
 for (const label of ['Anggota', 'Hadir', 'Tidak hadir', 'Izin', 'Sakit'])
  assert.ok(jsx.includes('<th>'+label+'</th>'), label);
 assert.match(jsx, /onClick=\{\(\)=>setSelected\(row\.userId\)\}/);
});
