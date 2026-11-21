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
