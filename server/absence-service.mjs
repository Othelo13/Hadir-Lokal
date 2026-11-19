import { randomUUID } from 'node:crypto';
import { storeAttachment } from './absence-attachment.mjs';
import { effectiveAbsenceDays, officeDate, nextAbsenceStatus } from './absence-policy.mjs';

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function write(sqlite, operation) {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    sqlite.exec('COMMIT');
    return result;
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

function actor(sqlite, id) {
  const member = sqlite.prepare('SELECT user_id,name,email,role,active FROM members WHERE user_id=?').get(id);
  if (!member || member.active !== 1) fail('Akses tidak diizinkan.', 403);
  return member;
}

function reasonText(value, { minReasonLength, maxReasonLength }, required) {
  if (!Number.isSafeInteger(minReasonLength) || minReasonLength < 1 ||
      !Number.isSafeInteger(maxReasonLength) || maxReasonLength < minReasonLength ||
      maxReasonLength > 10000) throw new Error('Invalid absence reason policy.');
  if (value != null && typeof value !== 'string') fail('Alasan tidak valid.');
  const reason = (value ?? '').trim();
  if (!reason && !required) return null;
  if (reason.length < minReasonLength || reason.length > maxReasonLength) fail('Panjang alasan tidak valid.');
  return reason;
}

function audit(sqlite, requestId, from, to, actorId, reason, now) {
  sqlite.prepare(`INSERT INTO absence_request_history
    (id,request_id,from_status,to_status,actor_user_id,reason,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(randomUUID(),requestId,from,to,actorId,reason,now);
}

function assertNoAttendance(sqlite, userId, days) {
  const exists = sqlite.prepare('SELECT id FROM records WHERE user_id=? AND date=? LIMIT 1');
  for (const day of days) {
    // Rejected selfies remain active records until explicitly cancelled.
    if (exists.get(userId,day)) fail('Terdapat catatan absensi aktif pada tanggal ' + day + '.', 409);
  }
}

/** For P2: caller MUST hold BEGIN IMMEDIATE through the attendance insert. */
export function assertAttendanceAllowed(sqlite, userId, date) {
  const absence = sqlite.prepare(`SELECT r.id FROM absence_day_reservations d
    JOIN absence_requests r ON r.id=d.request_id
    WHERE d.user_id=? AND d.date=? AND r.status='approved'`).get(userId,date);
  if (absence) fail('Izin atau sakit telah disetujui untuk tanggal tersebut.',409);
}

/** Submit a full-day absence; identity and schedule are read from the database. */
export function submitAbsence(sqlite, actorId, input, policy, now = new Date()) {
  return write(sqlite, () => {
    const member = actor(sqlite,actorId);
    if (member.role !== 'employee') fail('Hanya anggota yang dapat mengajukan izin atau sakit.',403);
    if (!['leave','sick'].includes(input.type)) fail('Jenis pengajuan tidak valid.');
    const reason = reasonText(input.reason,policy,true);
    const config = sqlite.prepare('SELECT days,timezone FROM config WHERE id=1').get();
    if (!config) throw new Error('Missing office configuration.');
    const workDays = JSON.parse(config.days);
    const days = effectiveAbsenceDays({
      startDate:input.startDate,endDate:input.endDate,today:officeDate(now,config.timezone),
      workDays,maxBackDays:policy.maxBackDays,maxRangeDays:policy.maxRangeDays
    });
    assertNoAttendance(sqlite,actorId,days);
    const reservation = sqlite.prepare('SELECT request_id FROM absence_day_reservations WHERE user_id=? AND date=?');
    for (const day of days) {
      if (reservation.get(actorId,day)) fail('Sudah ada pengajuan aktif pada tanggal ' + day + '.',409);
    }
    const id = randomUUID(), timestamp = now.toISOString();
    sqlite.prepare(`INSERT INTO absence_requests
      (id,user_id,name_snapshot,email_snapshot,type,start_date,end_date,reason,status,office_timezone,schedule_snapshot,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?,?)`).run(id,actorId,member.name,member.email,input.type,
        input.startDate,input.endDate,reason,config.timezone,JSON.stringify(workDays),timestamp,timestamp);
    const insertDay = sqlite.prepare('INSERT INTO absence_request_days(request_id,date) VALUES (?,?)');
    const reserve = sqlite.prepare('INSERT INTO absence_day_reservations(user_id,date,request_id) VALUES (?,?,?)');
    for (const day of days) {
      insertDay.run(id,day);
      reserve.run(actorId,day,id);
    }
    if(Object.hasOwn(input,'attachment')) storeAttachment(sqlite,id,input.attachment,timestamp);
    audit(sqlite,id,null,'pending',actorId,null,timestamp);
    return { id,status:'pending',days };
  });
}

/** Review or cancel a request; status, reservations and audit commit together. */
export function transitionAbsence(sqlite, actorId, requestId, action, reasonValue, policy, now = new Date()) {
  return write(sqlite, () => {
    const member = actor(sqlite,actorId);
    const row = sqlite.prepare('SELECT * FROM absence_requests WHERE id=?').get(requestId);
    if (!row || (member.role !== 'admin' && row.user_id !== actorId)) fail('Pengajuan tidak ditemukan.',404);
    const next = nextAbsenceStatus(row.status,action,{
      role:member.role,isOwner:row.user_id === actorId,active:true
    });
    const reason = reasonText(reasonValue,policy,action==='reject' || (action==='cancel' && member.role==='admin'));
    if (next === 'approved') {
      const owner = sqlite.prepare("SELECT user_id FROM members WHERE user_id=? AND role='employee' AND active=1").get(row.user_id);
      if (!owner) fail('Anggota tidak lagi berhak mengajukan izin atau sakit.',409);
      const days = sqlite.prepare('SELECT date FROM absence_request_days WHERE request_id=? ORDER BY date').all(requestId).map(x=>x.date);
      if (!days.length) fail('Pengajuan tidak memiliki tanggal efektif.',409);
      const reservations = sqlite.prepare('SELECT date FROM absence_day_reservations WHERE request_id=? AND user_id=? ORDER BY date').all(requestId,row.user_id).map(x=>x.date);
      if (days.length !== reservations.length || days.some((day,index)=>day !== reservations[index])) {
        fail('Reservasi tanggal pengajuan tidak konsisten.',409);
      }
      assertNoAttendance(sqlite,row.user_id,days);
    }
    const timestamp = now.toISOString();
    if (next === 'cancelled') {
      sqlite.prepare(`UPDATE absence_requests SET status=?,updated_at=?,cancelled_by=?,cancelled_at=?,cancel_reason=? WHERE id=?`)
        .run(next,timestamp,actorId,timestamp,reason,requestId);
    } else {
      sqlite.prepare(`UPDATE absence_requests SET status=?,updated_at=?,reviewed_by=?,reviewed_at=?,review_reason=? WHERE id=?`)
        .run(next,timestamp,actorId,timestamp,reason,requestId);
    }
    if (next === 'cancelled' || next === 'rejected') {
      sqlite.prepare('DELETE FROM absence_day_reservations WHERE request_id=?').run(requestId);
    }
    audit(sqlite,requestId,row.status,next,actorId,reason,timestamp);
    return { id:requestId,status:next };
  });
}
