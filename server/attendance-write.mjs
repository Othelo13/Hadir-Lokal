import { assertAttendanceAllowed } from './absence-service.mjs';

function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function write(sqlite,fn){
  sqlite.exec('BEGIN IMMEDIATE');
  try{const result=fn();sqlite.exec('COMMIT');return result;}
  catch(error){sqlite.exec('ROLLBACK');throw error;}
}
export function officeLocal(now,zone){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short',
  }).formatToParts(now).map(p=>[p.type,p.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,clock:`${p.hour}:${p.minute}`,
    day:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday)};
}
function settings(sqlite){
  const config=sqlite.prepare('SELECT * FROM config WHERE id=1').get();
  if(!config)throw new Error('Missing office configuration.');
  return config;
}
function authenticated(authenticate,userId,role){
  const me=authenticate();
  if(!me||me.user_id!==userId||me.active!==1)fail('Sesi telah berakhir. Silakan masuk kembali.',401);
  if(me.role!==role)fail('Hak akses telah berubah.',403);
  return me;
}
function latestCancellation(sqlite,userId,date,kind){
  return sqlite.prepare(`SELECT id,retry_authorized_at FROM attendance_cancellations
    WHERE user_id=? AND date=? AND kind=? ORDER BY cancelled_at DESC,rowid DESC LIMIT 1`).get(userId,date,kind);
}
function assertEligible(sqlite,userId,kind,config,today){
  if(!['in','out'].includes(kind))fail('Jenis absensi tidak valid.');
  assertAttendanceAllowed(sqlite,userId,today.date);
  if(!JSON.parse(config.days).includes(today.day))fail('Hari ini bukan hari kerja.');
  if(kind==='in'&&today.clock>config.start&&!config.allow_late)fail('Absen masuk ditutup setelah pukul '+config.start+'. Hubungi admin.');
  if(kind==='out'&&today.clock<config.end)fail('Absen pulang dibuka pukul '+config.end+'.');
  if(kind==='out'&&!sqlite.prepare("SELECT id FROM records WHERE user_id=? AND date=? AND kind='in'").get(userId,today.date))
    fail('Lakukan absen masuk terlebih dahulu.');
  if(sqlite.prepare('SELECT id FROM records WHERE user_id=? AND date=? AND kind=?').get(userId,today.date,kind))
    fail('Absensi ini sudah tercatat hari ini.',409);
  const latest=latestCancellation(sqlite,userId,today.date,kind);
  if(latest&&!latest.retry_authorized_at)fail('Absensi sebelumnya dibatalkan. Hubungi admin untuk izin absensi ulang.',403);
}
/** Call after validating the selfie and QR content, using the same connection as authentication.
 * Never trust date, role, name, time, status or QR active state from an earlier read.
 * The injected clock is server-side, for deterministic tests only.
 */
export function commitAttendance(sqlite,input,authenticate,clock=()=>new Date()){
  return write(sqlite,()=>{
    const me=authenticated(authenticate,input.userId,'employee');
    const now=clock(), config=settings(sqlite), today=officeLocal(now,config.timezone);
    if(today.date!==input.expectedDate||config.timezone!==input.expectedTimezone)
      fail('Tanggal atau zona waktu kantor berubah. Muat ulang sebelum absen.',409);
    assertEligible(sqlite,me.user_id,input.kind,config,today);
    if(!sqlite.prepare('SELECT id FROM codes WHERE id=? AND active=1').get(input.qr))
      fail('QR tidak berlaku atau bukan QR kantor ini.');
    if(typeof input.challenge!=='string'||!sqlite.prepare('DELETE FROM challenges WHERE id=? AND user_id=? AND expires>? RETURNING id')
      .get(input.challenge,me.user_id,now.valueOf()))fail('Sesi kamera kedaluwarsa. Buka kamera kembali.');
    const status=input.kind==='in'&&today.clock>config.start?'late':'ontime';
    sqlite.prepare(`INSERT INTO records (id,user_id,email,name,date,kind,time,status,photo,qr,review)
      VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`).run(input.id,me.user_id,me.email,me.name,today.date,input.kind,now.toISOString(),status,input.photo,input.qr);
    return {id:input.id,date:today.date,status};
  });
}
/** Authorize only the latest cancellation on the current office date, with no approved absence. */
export function authorizeAttendanceRetake(sqlite,id,actorId,authenticate,clock=()=>new Date()){
  return write(sqlite,()=>{
    authenticated(authenticate,actorId,'admin');
    const now=clock(),config=settings(sqlite),today=officeLocal(now,config.timezone);
    const row=sqlite.prepare('SELECT * FROM attendance_cancellations WHERE id=?').get(id);
    if(!row)fail('Catatan pembatalan tidak ditemukan.',404);
    if(row.date!==today.date)fail('Izin absensi ulang hanya tersedia pada hari yang sama.',409);
    if(!sqlite.prepare("SELECT user_id FROM members WHERE user_id=? AND role='employee' AND active=1").get(row.user_id))
      fail('Anggota tidak lagi berhak melakukan absensi.',409);
    assertAttendanceAllowed(sqlite,row.user_id,row.date);
    if(sqlite.prepare('SELECT id FROM records WHERE user_id=? AND date=? AND kind=?').get(row.user_id,row.date,row.kind))
      fail('Absensi aktif sudah tercatat.',409);
    const latest=latestCancellation(sqlite,row.user_id,row.date,row.kind);
    if(latest?.id!==row.id)fail('Berikan izin melalui pembatalan terbaru.',409);
    if(!row.retry_authorized_at)sqlite.prepare('UPDATE attendance_cancellations SET retry_authorized_at=?,retry_authorized_by=? WHERE id=?')
      .run(now.toISOString(),actorId,row.id);
  });
}
