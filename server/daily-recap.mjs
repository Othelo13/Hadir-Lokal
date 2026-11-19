import { parseCalendarDate } from './absence-policy.mjs';

const validReviews=new Set(['pending','approved']);
const statusForIn={ontime:'present',late:'late'};
const statusForAbsence={leave:'leave',sick:'sick'};
function compareText(a,b){return a<b?-1:a>b?1:0;}

/**
 * Read only, evidence-based daily rows. Caller owns the snapshot transaction
 * if combining with membership/schedule queries. No arbitrary row cap.
 * Historical roster eligibility is a separate step.
 */
export function dailyEvidence(sqlite,date){
  parseCalendarDate(date);
  const rows=new Map();
  function get(userId){
    if(!rows.has(userId))rows.set(userId,{
      userId,date,name:null,email:null,checkIn:null,checkOut:null,status:null,
      absence:null,provisional:false,hasEvidence:true,issues:[],
      cancellationCount:0,activeRecordCount:0,
    });
    return rows.get(userId);
  }
  const snapshots=new Map();
  function identity(row,name,email,time,priority){
    const previous=snapshots.get(row.userId);
    if(!previous||time>previous.time||(time===previous.time&&priority>previous.priority)){
      row.name=name;row.email=email;snapshots.set(row.userId,{time,priority});
    }
  }
  const records=sqlite.prepare(`SELECT id,user_id,name,email,kind,time,status,review
    FROM records WHERE date=? ORDER BY time,id`).all(date);
  for(const record of records){
    const row=get(record.user_id);
    row.activeRecordCount++;
    identity(row,record.name,record.email,record.time,3);
    if(!['in','out'].includes(record.kind)){
      row.issues.push('invalid_attendance_kind');continue;
    }
    if(!validReviews.has(record.review)){
      if(record.review!=='rejected')row.issues.push('invalid_review');
      continue;
    }
    if(!Object.hasOwn(statusForIn,record.status)){
      row.issues.push('invalid_attendance_status');continue;
    }
    const event={id:record.id,time:record.time,review:record.review};
    if(record.kind==='in'){
      row.checkIn=event;
      row.status=statusForIn[record.status];
    }else row.checkOut=event;
    if(record.review==='pending')row.provisional=true;
  }
  const cancelled=sqlite.prepare(`SELECT id,user_id,name,email,cancelled_at
    FROM attendance_cancellations WHERE date=? ORDER BY cancelled_at,id`).all(date);
  for(const event of cancelled){
    const row=get(event.user_id);row.cancellationCount++;
    identity(row,event.name,event.email,event.cancelled_at,1);
  }
  // Use effective dates, not the continuous date range; approved rows must
  // also have their corresponding active reservation.
  const absences=sqlite.prepare(`SELECT r.id,r.user_id,r.name_snapshot,r.email_snapshot,r.type,
    r.updated_at,d.request_id AS reserved
    FROM absence_request_days day
    JOIN absence_requests r ON r.id=day.request_id
    LEFT JOIN absence_day_reservations d ON d.request_id=r.id AND d.user_id=r.user_id AND d.date=day.date
    WHERE day.date=? AND r.status='approved' ORDER BY r.id`).all(date);
  for(const absence of absences){
    const row=get(absence.user_id);
    identity(row,absence.name_snapshot,absence.email_snapshot,absence.updated_at,2);
    if(!absence.reserved){row.issues.push('missing_absence_reservation');continue;}
    if(row.absence){row.issues.push('multiple_approved_absences');continue;}
    row.absence={id:absence.id,type:absence.type};
  }
  for(const row of rows.values()){
    if(row.checkOut&&!row.checkIn)row.issues.push('checkout_without_valid_checkin');
    if(row.absence){
      if(row.activeRecordCount){
        row.issues.push('attendance_absence_conflict');
        row.status=null;
      }else row.status=statusForAbsence[row.absence.type];
    }
    if(row.issues.includes('missing_absence_reservation')||row.issues.includes('multiple_approved_absences'))
      row.status=null;
    // Never expose sensitive reasons, photo keys, QR payloads or attachment data.
  }
  return [...rows.values()].sort((a,b)=>compareText(a.name??'',b.name??'')||compareText(a.userId,b.userId));
}
