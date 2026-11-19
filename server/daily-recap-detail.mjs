import { parseCalendarDate } from './absence-policy.mjs';
import { historicalDailyRecap } from './historical-daily-recap.mjs';
import { scheduleAt } from './member-schedule-history.mjs';

function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function single(params,key){
 const values=params.getAll(key);
 if(values.length>1)fail('Parameter '+key+' tidak boleh berulang.');
 return values[0]??null;
}

/** Admin-only detail of a row in the daily recap, from one read snapshot. */
export function handleDailyRecapDetail(sqlite,actorId,method,params,authenticate,clock=()=>new Date()){
 if(method!=='GET')fail('Metode tidak didukung.',405);
 sqlite.exec('BEGIN');
 try{
  const actor=authenticate();
  if(!actor||actor.user_id!==actorId||actor.active!==1)fail('Sesi telah berakhir. Silakan masuk kembali.',401);
  if(actor.role!=='admin')fail('Hanya admin yang dapat melihat detail rekap absensi.',403);
  for(const key of params.keys())if(!['action','date','userId'].includes(key))fail('Parameter detail tidak dikenal.');
  const action=single(params,'action');
  if(action!==null&&action!=='daily-recap-detail')fail('Tindakan tidak sesuai.');
  const date=single(params,'date'),userId=single(params,'userId');
  parseCalendarDate(date);
  if(date<'1900-01-01'||date>'9998-12-31')fail('Tanggal rekap di luar rentang yang didukung.');
  // Legacy stable IDs are not necessarily UUIDs. Bind as a literal, never SQL or path.
  if(typeof userId!=='string'||!userId.length||userId.length>256||userId!==userId.trim()||/[\x00-\x1f\x7f]/.test(userId))
   fail('ID anggota tidak valid.');
  const now=clock(),{context,rows}=historicalDailyRecap(sqlite,date,now);
  const summary=rows.find(row=>row.userId===userId);
  if(!summary)fail('Detail rekap tidak ditemukan.',404);
  function timezone(time){
   const at=Date.parse(time);
   return Number.isFinite(at)&&at<=now.valueOf()?scheduleAt(sqlite,new Date(at)).schedule?.timezone??null:null;
  }
  const records=sqlite.prepare(`SELECT id,user_id,name,email,date,kind,time,status,review
   FROM records WHERE user_id=? AND date=? ORDER BY time,id`).all(userId,date).map(row=>({
    ...row,timezone:timezone(row.time),photoUrl:'/api/app?action=photo&id='+encodeURIComponent(row.id),
   }));
  const cancellations=sqlite.prepare(`SELECT id,user_id,name,email,date,kind,time,reason,cancelled_by,cancelled_at,
   retry_authorized_at,retry_authorized_by FROM attendance_cancellations
   WHERE user_id=? AND date=? ORDER BY cancelled_at DESC,rowid DESC`).all(userId,date).map(row=>({
    ...row,timezone:timezone(row.time),photoUrl:null,
   }));
  const requests=sqlite.prepare(`SELECT r.id,r.type,r.start_date,r.end_date,r.reason,r.status,r.office_timezone,
   r.created_at,r.updated_at,r.reviewed_by,r.reviewed_at,r.review_reason,r.cancelled_by,r.cancelled_at,r.cancel_reason,
   EXISTS(SELECT 1 FROM absence_day_reservations d WHERE d.request_id=r.id AND d.user_id=r.user_id AND d.date=day.date) AS reserved
   FROM absence_request_days day JOIN absence_requests r ON r.id=day.request_id
   WHERE r.user_id=? AND day.date=? ORDER BY r.created_at DESC,r.id DESC`).all(userId,date);
  const history=sqlite.prepare(`SELECT from_status,to_status,actor_user_id,reason,created_at
   FROM absence_request_history WHERE request_id=? ORDER BY created_at,rowid`);
  const attachment=sqlite.prepare('SELECT original_name,mime_type,file_size FROM absence_attachments WHERE request_id=?');
  const absences=requests.map(request=>{
   const metadata=attachment.get(request.id);
   return {...request,reserved:!!request.reserved,history:history.all(request.id),
    attachment:metadata?{...metadata,downloadUrl:'/api/app?action=absence-attachment&id='+encodeURIComponent(request.id)}:null};
  });
  const result={date,userId,context,summary,records,cancellations,absences};
  sqlite.exec('COMMIT');
  return result;
 }catch(error){
  sqlite.exec('ROLLBACK');
  throw error;
 }
}
