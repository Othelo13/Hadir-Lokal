import { submitAbsence, transitionAbsence } from './absence-service.mjs';

// Provisional defaults for the development release; never supplied by clients.
export const absencePolicy = Object.freeze({
  maxBackDays:3, maxRangeDays:31, minReasonLength:5, maxReasonLength:500,
});
const statuses = new Set(['pending','approved','rejected','cancelled']);
const types = new Set(['leave','sick']);
const writes = new Map([['absence-approve','approve'],['absence-reject','reject'],['absence-cancel','cancel']]);
const actions = new Set(['absence-list','absence-detail','absence-submit',...writes.keys()]);
export function isAbsenceAction(action) { return actions.has(action); }

function fail(message,status=400) { throw Object.assign(new Error(message),{status}); }
function actor(sqlite,id) {
  const member = sqlite.prepare('SELECT user_id,role FROM members WHERE user_id=? AND active=1').get(id);
  if (!member) fail('Akses tidak diizinkan.',403);
  return member;
}
function validId(id) {
  if(typeof id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fail('ID pengajuan tidak valid.');
  return id;
}
function positiveInteger(raw,fallback,max) {
  if(raw===null) return fallback;
  if(!/^\d+$/.test(raw)) fail('Parameter halaman tidak valid.');
  const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<1||n>max) fail('Parameter halaman tidak valid.');
  return n;
}
function readSnapshot(sqlite,fn) {
  sqlite.exec('BEGIN');
  try {
    const result=fn();
    sqlite.exec('COMMIT');
    return result;
  } catch(error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}
const summaryColumns = `r.id,r.user_id,r.name_snapshot,r.email_snapshot,r.type,r.start_date,r.end_date,
  r.status,r.created_at,r.updated_at,
  (SELECT count(*) FROM absence_request_days d WHERE d.request_id=r.id) AS effective_day_count,
  EXISTS(SELECT 1 FROM absence_attachments a WHERE a.request_id=r.id) AS has_attachment`;

export function handleAbsenceAction(sqlite, actorId, action, method, params, body) {
  const read = action==='absence-list'||action==='absence-detail';
  if(method !== (read?'GET':'POST')) fail('Metode tidak didukung.',405);
  if(action==='absence-list') return readSnapshot(sqlite,()=>{
    const member=actor(sqlite,actorId), filters=[], args=[];
    if(member.role!=='admin') { filters.push('r.user_id=?'); args.push(actorId); }
    const status=params.get('status'), type=params.get('type');
    if(status!==null) {
      if(!statuses.has(status)) fail('Status pengajuan tidak valid.');
      filters.push('r.status=?');args.push(status);
    }
    if(type!==null) {
      if(!types.has(type)) fail('Jenis pengajuan tidak valid.');
      filters.push('r.type=?');args.push(type);
    }
    const pageSize=positiveInteger(params.get('pageSize'),10,50);
    if(![10,20,50].includes(pageSize)) fail('Ukuran halaman tidak valid.');
    const requested=positiveInteger(params.get('page'),1,1000000);
    const where=filters.length?' WHERE '+filters.join(' AND '):'';
    const total=sqlite.prepare('SELECT count(*) AS n FROM absence_requests r'+where).get(...args).n;
    const totalPages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(requested,totalPages);
    const rows=sqlite.prepare('SELECT '+summaryColumns+' FROM absence_requests r'+where+' ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize);
    return {rows,page,pageSize,total,totalPages};
  });
  if(action==='absence-detail') return readSnapshot(sqlite,()=>{
    const member=actor(sqlite,actorId),id=validId(params.get('id'));
    const row=sqlite.prepare(`SELECT ${summaryColumns},r.reason,r.office_timezone,r.schedule_snapshot,
      r.reviewed_by,r.reviewed_at,r.review_reason,r.cancelled_by,r.cancelled_at,r.cancel_reason
      FROM absence_requests r WHERE r.id=? AND (?='admin' OR r.user_id=?)`).get(id,member.role,actorId);
    if(!row) fail('Pengajuan tidak ditemukan.',404);
    const days=sqlite.prepare('SELECT date FROM absence_request_days WHERE request_id=? ORDER BY date').all(id).map(row=>row.date);
    const history=sqlite.prepare('SELECT from_status,to_status,actor_user_id,reason,created_at FROM absence_request_history WHERE request_id=? ORDER BY created_at,rowid').all(id);
    return {request:row,days,history};
  });
  if(action==='absence-submit') {
    // Attachment handling is a separate phase: do not silently discard it.
    if(Object.hasOwn(body,'attachment')) fail('Lampiran belum tersedia.');
    return submitAbsence(sqlite,actorId,{type:body.type,startDate:body.startDate,endDate:body.endDate,reason:body.reason},absencePolicy);
  }
  if(writes.has(action)) return transitionAbsence(sqlite,actorId,validId(body.id),writes.get(action),body.reason,absencePolicy);
  fail('Tindakan tidak dikenal.',404);
}
