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

test('status filter hides the green focus outline only within absence page toolbar',()=>{
 const jsx=read('../src/AbsenceRequests.tsx');
 const css=read('../src/absence-requests.css');
 assert.match(jsx,/className="absence-page-controls"/);
 assert.match(jsx,/aria-label="Filter status pengajuan"/);
 assert.match(css,/\.absence-page \.absence-page-controls select:focus-visible\s*\{\s*outline:none;box-shadow:none;background-color:#f6f9f2;/);
 assert.doesNotMatch(css,/^select:focus-visible\s*\{/m);
});

test('mobile horizontal scroll hint appears only in absence tables on narrow screens',()=>{
 const jsx=read('../src/AbsenceRequests.tsx');
 const css=read('../src/absence-requests.css');
 assert.match(jsx,/<p className="absence-table-hint">Geser tabel untuk melihat kolom lainnya\. Ketuk baris untuk melihat detail pengajuan\.<\/p>/);
 assert.match(jsx,/className="table-wrap"><table className="absence-table"/);
 assert.match(css,/\.absence-table-hint\s*\{\s*display:none;\s*\}/);
 assert.match(css,/@media\(max-width:700px\)\s*\{\s*\.absence-table-hint\s*\{\s*display:block;/);
 assert.match(css,/\.absence-table\s*\{min-width:620px;\}/);
});

test('both roles open absence details by clicking a full row or pressing Enter/Space',()=>{
 const jsx=read('../src/AbsenceRequests.tsx');
 const css=read('../src/absence-requests.css');
 assert.match(jsx,/<thead><tr>\{admin&&<th>Anggota<\/th>\}<th>Jenis<\/th><th>Periode<\/th><th>Hari kerja<\/th><th>Status<\/th><\/tr><\/thead>/);
 assert.doesNotMatch(jsx,/<th>Detail<\/th>/);
 assert.doesNotMatch(jsx,/>Lihat detail<\/button>/);
 assert.match(jsx,/<tr key=\{row\.id\} role="button" tabIndex=\{0\}/);
 assert.match(jsx,/aria-expanded=\{selected===row\.id\}/);
 assert.match(jsx,/aria-controls=\{selected===row\.id\?'absence-request-detail':undefined\}/);
 assert.match(jsx,/onClick=\{event=>toggleDetail\(row\.id,event\.currentTarget\)\}/);
 assert.match(jsx,/event\.key==='Enter'\|\|event\.key===' '/);
 assert.match(jsx,/id="absence-request-detail" ref=\{detailDialogRef\} tabIndex=\{-1\}/);
 assert.match(css,/\.absence-table tbody tr\[role="button"\]\s*\{cursor:pointer;\}/);
 assert.match(css,/\.absence-table tbody tr\[role="button"\]:focus-visible\s*\{[^}]*background:/);
});

test('request details render in a responsive modal rather than beneath the table',()=>{
 const jsx=read('../src/AbsenceRequests.tsx');
 const css=read('../src/absence-requests.css');
 assert.match(jsx,/import \{ createPortal \} from 'react-dom'/);
 assert.match(jsx,/\{selected&&createPortal\(/);
 assert.match(jsx,/className="overlay absence-modal-overlay"/);
 assert.match(jsx,/role="dialog" aria-modal="true" aria-labelledby="absence-detail-heading"/);
 assert.match(jsx,/className="modal absence-detail absence-modal-card"/);
 assert.match(css,/\.modal\.absence-modal-card\s*\{[^}]*max-height:calc\(100dvh - 40px\)/);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(jsx,/aria-label="Tutup detail"/);
});
test('modal locks background scroll, traps focus, closes by Escape/backdrop and restores focus',()=>{
 const jsx=read('../src/AbsenceRequests.tsx');
 assert.match(jsx,/document\.body\.style\.overflow = 'hidden'/);
 assert.match(jsx,/document\.body\.style\.overflow = previousOverflow/);
 assert.match(jsx,/if \(opener\?\.isConnected\) opener\.focus\(\)/);
 assert.match(jsx,/event\.key === 'Escape'/);
 assert.match(jsx,/event\.key !== 'Tab'/);
 assert.match(jsx,/event\.currentTarget===event\.target&&!busyRef\.current/);
 assert.match(jsx,/onKeyDown=\{event=>\{if\(event\.key==='Enter'\|\|event\.key===' '/);
 assert.match(jsx,/detailCloseRef\.current\?\.focus\(\)/);
});
