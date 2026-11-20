import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('all member recap column headers are centered without altering cell alignment', () => {
 const css = readFileSync(new URL('../src/member-recap-period.css', import.meta.url), 'utf8');
 const headers = css.match(/\.member-recap-table th\s*\{([^}]+)\}/);
 assert.ok(headers, 'Header rule is present');
 assert.match(headers[1], /text-align:\s*center\s*;/);
 const globalCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
 assert.match(globalCss, /table\s*\{[^}]*text-align:\s*left\s*;/);
 assert.doesNotMatch(headers[1], /text-align:\s*left\s*;/);
});
test('five original columns and clickable member rows are unchanged', () => {
 const jsx = readFileSync(new URL('../src/MemberRecapTable.tsx', import.meta.url), 'utf8');
 for (const title of ['Anggota', 'Hadir', 'Tidak hadir', 'Izin', 'Sakit'])
  assert.ok(jsx.includes('<th>'+title+'</th>'), title);
 assert.match(jsx, /onClick=\{\(\)=>setSelected\(row\.userId\)\}/);
});
