import { officeDate, parseCalendarDate } from './absence-policy.mjs';
import { historicalDailyRecap } from './historical-daily-recap.mjs';

const DAY=86_400_000;
const order=(a,b)=>a<b?-1:a>b?1:0;
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function one(params,key){
 const values=params.getAll(key);
 if(values.length>1)fail('Parameter '+key+' tidak boleh berulang.');
 return values[0]??null;
}
function positive(raw,fallback,max){
 if(raw===null)return fallback;
 if(!/^\d+$/.test(raw))fail('Parameter halaman tidak valid.');
 const n=Number(raw);
 if(!Number.isSafeInteger(n)||n<1||n>max)fail('Parameter halaman tidak valid.');
 return n;
}
function periodDates(period,chosen,today){
 if(period==='month'){
  const month=chosen??today.slice(0,7),dates=monthDates(month);
  return {period,month,date:null,dates};
 }
 if(period!=='day'&&period!=='week')fail('Periode tidak valid.');
 const date=chosen??today;
 parseCalendarDate(date);
 if(date<'1900-01-01'||date>'9998-12-31')fail('Tanggal tidak didukung.');
 if(period==='day')return {period,month:null,date,dates:[date]};
 const utc=Date.parse(date+'T00:00:00Z');
 const start=utc-((new Date(utc).getUTCDay()+6)%7)*DAY;
 const dates=Array.from({length:7},(_,i)=>new Date(start+i*DAY).toISOString().slice(0,10));
 if(dates[0]<'1900-01-01'||dates.at(-1)>'9998-12-31')fail('Minggu tidak didukung.');
 return {period,month:null,date,dates};
}
function monthDates(month){
 if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||
  month<'1900-01'||month>'9998-12')fail('Bulan rekap tidak valid.');
 const start=Date.parse(month+'-01T00:00:00Z');
 const year=Number(month.slice(0,4)),m=Number(month.slice(5));
 const end=Date.UTC(year,m,1);
 return Array.from({length:Math.round((end-start)/DAY)},(_,i)=>new Date(start+i*DAY).toISOString().slice(0,10));
}

/**
 * Member-centric monthly counts. Read-only; caller holds the same SQLite
 * snapshot for authentication, roster, historical schedules and evidence.
 * "Tidak hadir" is counted only for completed, fully-covered working dates
 * on which the member is eligible and no valid evidence or inconsistency exists.
 */
export function memberPeriodRecap(sqlite,selection={},now=new Date()){
 const current=sqlite.prepare('SELECT timezone FROM config WHERE id=1').get();
 if(!current)fail('Jadwal kantor belum tersedia.',409);
 const today=officeDate(now,current.timezone);
 const {period,month,date,dates}=periodDates(selection.period??'month',selection.period==='day'||selection.period==='week'?selection.date:selection.month,today);
 const members=sqlite.prepare(`SELECT user_id,name,email FROM members
  WHERE role='employee' AND active=1 ORDER BY name COLLATE NOCASE,user_id`).all();
 const rows=new Map(members.map(member=>[member.user_id,{
  userId:member.user_id,name:member.name,email:member.email,
  present:0,late:0,absent:0,leave:0,sick:0,pending:0,days:[],
 }]));
 const pendingDays=new Set(sqlite.prepare(`SELECT r.user_id,day.date
  FROM absence_request_days day JOIN absence_requests r ON r.id=day.request_id
  WHERE day.date>=? AND day.date<=? AND r.status='pending'`)
  .all(dates[0],dates.at(-1)).map(r=>JSON.stringify([r.user_id,r.date])));
 let completedDays=0,verifiedWorkdays=0,unverifiedDates=0;
 for(const date of dates){
  if(date>today){for(const member of rows.values())member.days.push({date,state:'future',late:false,hasDetail:false,checkIn:null,checkOut:null});continue;}
  const {context,rows:daily}=historicalDailyRecap(sqlite,date,now);
  const finished=date<today;
  if(finished)completedDays++;
  if(finished&&context.coverage!=='complete')unverifiedDates++;
  if(finished&&context.coverage==='complete'&&context.workday===true)verifiedWorkdays++;
  const byId=new Map(daily.map(day=>[day.userId,day]));
  for(const member of rows.values()){
   const day=byId.get(member.userId);
   const hasDetail=!!day;
   let state='not-applicable',late=false;
   const pendingRequest=pendingDays.has(JSON.stringify([member.userId,date]));
   // Trusted recorded evidence survives partial migration-day coverage;
   // missing attendance never becomes absent without full coverage.
   if(day?.eligible===true&&day.status&&day.issues.length===0&&!day.provisional){
    if(day.status==='present'||day.status==='late'){state='present';late=day.status==='late';}
    else if(day.status==='leave'||day.status==='sick')state=day.status;
   }else if(context.coverage!=='complete'||context.workday===null)state='unknown';
   else if(context.workday===false)state='off';
   else if(!day||day.eligible!==true)state='not-applicable';
   else if(day.issues.length||day.provisional||(pendingRequest&&!day.status))state='pending';
   else if(day.status==='present'||day.status==='late'){state='present';late=day.status==='late';}
   else if(day.status==='leave'||day.status==='sick')state=day.status;
   else if(date===today)state='ongoing';
   else if(finished)state='absent';
   // Only expose clock instants and their historical zone, never record IDs or file keys.
   const safeTime=event=>event?{time:event.time,timezone:event.timezone??null}:null;
   member.days.push({date,state,late,hasDetail,
    checkIn:safeTime(day?.checkIn),checkOut:safeTime(day?.checkOut)});
   if(state==='present'){member.present++;if(late)member.late++;}
   else if(state==='absent')member.absent++;
   else if(state==='leave')member.leave++;
   else if(state==='sick')member.sick++;
   else if(state==='pending')member.pending++;
  }
 }
 return {period,month,date,startDate:dates[0],endDate:dates.at(-1),today,completedDays,verifiedWorkdays,unverifiedDates,
  rows:[...rows.values()].sort((a,b)=>order(a.name.toLocaleLowerCase('id'),b.name.toLocaleLowerCase('id'))||order(a.userId,b.userId))};
}

export function memberMonthlyRecap(sqlite,month,now=new Date()){return memberPeriodRecap(sqlite,{period:'month',month},now);}

export function handleMemberRecap(sqlite,actorId,method,params,authenticate,clock=()=>new Date()){
 if(method!=='GET')fail('Metode tidak didukung.',405);
 sqlite.exec('BEGIN');
 try{
  const actor=authenticate();
  if(!actor||actor.user_id!==actorId||actor.active!==1)fail('Sesi telah berakhir. Silakan masuk kembali.',401);
  if(actor.role!=='admin')fail('Hanya admin yang dapat melihat rekap absensi.',403);
  for(const key of params.keys())if(!['action','period','month','date','q','page','pageSize'].includes(key))fail('Parameter rekap tidak dikenal.');
  const action=one(params,'action');
  if(action!==null&&action!=='member-recap')fail('Tindakan tidak sesuai.');
  const now=clock();
  if(!Number.isFinite(now.valueOf()))fail('Waktu server tidak valid.',500);
  const config=sqlite.prepare('SELECT timezone FROM config WHERE id=1').get();
  if(!config)fail('Jadwal kantor belum tersedia.',409);
  const period=one(params,'period')??'month',month=one(params,'month'),date=one(params,'date');
  if((period==='month'&&date!==null)||(period!=='month'&&month!==null))fail('Filter periode tidak sesuai.');
  periodDates(period,period==='month'?month:date,officeDate(now,config.timezone));
  const raw=one(params,'q')??'';
  if(raw.length>100||/[\x00-\x1f\x7f]/.test(raw))fail('Pencarian tidak valid.');
  const q=raw.trim(),needle=q.normalize('NFKC').toLowerCase();
  const pageSize=positive(one(params,'pageSize'),10,50);
  if(![10,20,50].includes(pageSize))fail('Ukuran halaman tidak valid.');
  const requestedPage=positive(one(params,'page'),1,1000000);
  const recap=memberPeriodRecap(sqlite,{period,month,date},now);
  const rows=needle?recap.rows.filter(row=>
   (row.name+' '+row.email).normalize('NFKC').toLowerCase().includes(needle)):recap.rows;
  const total=rows.length,totalPages=Math.max(1,Math.ceil(total/pageSize));
  const page=Math.min(requestedPage,totalPages);
  const result={...recap,q,rows:rows.slice((page-1)*pageSize,page*pageSize),page,pageSize,total,totalPages};
  sqlite.exec('COMMIT');return result;
 }catch(error){sqlite.exec('ROLLBACK');throw error;}
}
