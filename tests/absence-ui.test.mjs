import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('absence workflow appears for both roles without changing the old navigation',()=>{
 const ui=read('../src/ui.tsx');
 assert.match(ui,/AbsenceRequests/);
 assert.match(ui,/Izin & sakit/);
 assert.match(ui,/tab === 'absence'/);
});
test('absence screens use authenticated API, statuses, role controls and attachment guard',()=>{
 const ui=read('../src/AbsenceRequests.tsx');
 for(const action of ['absence-list','absence-detail','absence-submit','absence-attachment'])assert.ok(ui.includes(action),action);
 for(const term of ["'approve'","'reject'","'cancel'","credentials: 'same-origin'","5*1024*1024","FileReader","admin&&detail.request.status==='pending'"])assert.ok(ui.includes(term),term);
 assert.doesNotMatch(ui,/dangerouslySetInnerHTML/);
});

test('member form and history remain inline but have visually distinct headings',()=>{
 const jsx=read('../src/AbsenceRequests.tsx');
 const styles=read('../src/absence-requests.css');
 assert.match(jsx,/formOpen\?'Pengajuan & riwayat':'Riwayat pengajuan'/);
 assert.match(jsx,/className="absence-form-heading"/);
 assert.match(jsx,/!admin&&formOpen&&<div className="absence-history-heading"/);
 assert.match(styles,/\.absence-history-heading\s*\{[^}]*border-bottom:/);
 assert.match(styles,/\.absence-form-heading\s*\{[^}]*gap:/);
});
test('attachment picker keeps native upload input accessible with selected filename and removal',()=>{
 const jsx=read('../src/AbsenceRequests.tsx');
 const styles=read('../src/absence-requests.css');
 assert.match(jsx,/type="file" accept="\.jpg,\.jpeg,\.png,\.pdf" aria-labelledby="absence-file-caption"/);
 assert.match(jsx,/htmlFor="absence-file-input"/);
 assert.match(jsx,/file\?\.name\?\?'Belum ada file dipilih'/);
 assert.match(jsx,/aria-label="Hapus lampiran"/);
 assert.match(jsx,/if\(fileInputRef\.current\)fileInputRef\.current\.value=''/);
 assert.match(styles,/\.absence-file-input:focus-visible \+ \.absence-file-button/);
 assert.match(styles,/\.absence-file-name\s*\{[^}]*text-overflow:ellipsis/);
});
test('form input fonts match Hadir and helper text omits technical range details',()=>{
 const jsx=read('../src/AbsenceRequests.tsx');
 const styles=read('../src/absence-requests.css');
 assert.match(styles,/\.absence-page input,\.absence-page select,\.absence-page textarea\s*\{[^}]*font-family:inherit/);
 assert.match(jsx,/Kamu dapat mengajukan izin atau sakit untuk tanggal sebelumnya maupun mendatang\./);
 assert.doesNotMatch(jsx,/366 hari kalender/);
 assert.match(jsx,/5\*1024\*1024/);
});
