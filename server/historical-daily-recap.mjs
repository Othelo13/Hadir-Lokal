import { parseCalendarDate,officeDate } from './absence-policy.mjs';
import { dailyEvidence } from './daily-recap.mjs';
import { historyCoverage,scheduleAt } from './member-schedule-history.mjs';

const DAY=86400000;
const compareText=(a,b)=>a<b?-1:a>b?1:0;
function dayBounds(date,zone){
  const utc=parseCalendarDate(date);
  const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,calendar:'iso8601',year:'numeric',month:'2-digit',day:'2-digit'});
  const localDate=instant=>{
    const p=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(x=>[x.type,x.value]));
    return p.year.padStart(4,'0')+'-'+p.month+'-'+p.day;
  };
  // Find local midnight without assuming the current UTC offset. All supported
  // office timezones have monotonic calendar dates around modern day boundaries.
  function boundary(target,approx){
    let lo=approx-2*DAY,hi=approx+2*DAY;
    while(lo<hi){
      const mid=Math.floor((lo+hi)/2);
      if(localDate(mid)<target)lo=mid+1;else hi=mid;
    }
    return lo;
  }
  const next=new Date(utc+DAY).toISOString().slice(0,10);
  return {start:boundary(date,utc),end:boundary(next,utc+DAY)};
}

/**
 * Resolve the last observed instant of the requested local day using the
 * effective timezone of each historical schedule interval, never today's
 * timezone for historical days. The caller supplies a server-side clock.
 */
export function recapDayContext(sqlite,date,now=new Date()){
  parseCalendarDate(date);
  if(!Number.isFinite(now.valueOf()))throw new Error('Invalid recap clock.');
  const coverageStart=historyCoverage(sqlite);
  const nowMs=now.valueOf(),nowISO=now.toISOString();
  const events=sqlite.prepare(`SELECT event_id,days,start,end,timezone,allow_late,event_type,recorded_at
    FROM schedule_history WHERE config_id=1 AND recorded_at<=?
    ORDER BY recorded_at,event_id`).all(nowISO);
  const last=events.at(-1);
  const currentDate=last?officeDate(now,last.timezone):null;
  const matches=[],bounds=new Map();
  for(let i=0;i<events.length;i++){
    const event=events[i];
    if(!coverageStart)break;
    if(!bounds.has(event.timezone))bounds.set(event.timezone,dayBounds(date,event.timezone));
    const day=bounds.get(event.timezone);
    const from=Math.max(Date.parse(event.recorded_at),Date.parse(coverageStart),day.start);
    const to=Math.min(i+1<events.length?Date.parse(events[i+1].recorded_at):nowMs+1,nowMs+1,day.end);
    if(from<to)matches.push({event,from,to,day});
  }
  const chosen=matches.at(-1);
  if(!chosen)return {date,coverageStart,coverage:currentDate&&date>currentDate?'future':'unknown',
    asOf:null,timezone:null,schedule:null,workday:null,rosterKnown:false,timezoneChanged:false};
  const timezoneChanged=new Set(matches.map(m=>m.event.timezone)).size>1;
  const partial=matches[0].from>matches[0].day.start||timezoneChanged||matches.some(m=>m.event.event_type==='deleted');
  const event=chosen.event;
  const schedule=event.event_type==='deleted'?null:{
    days:JSON.parse(event.days),start:event.start,end:event.end,timezone:event.timezone,allowLate:!!event.allow_late,
  };
  const weekday=new Date(parseCalendarDate(date)).getUTCDay();
  return {date,coverageStart,coverage:partial?'partial':'complete',
    asOf:new Date(chosen.to-1).toISOString(),timezone:event.timezone,schedule,
    workday:schedule?schedule.days.includes(weekday):null,rosterKnown:!!schedule,timezoneChanged};
}

function rosterAt(sqlite,asOf){
  return sqlite.prepare(`WITH ranked AS (
    SELECT user_id,name,email,role,active,event_type,
      ROW_NUMBER() OVER(PARTITION BY user_id ORDER BY recorded_at DESC,event_id DESC) AS rn
    FROM member_history WHERE recorded_at<=?
  ) SELECT user_id,name,email,role,active FROM ranked WHERE rn=1 AND event_type<>'deleted'`).all(asOf);
}

/** Read-only daily recap; caller must hold one read snapshot across all queries. */
export function historicalDailyRecap(sqlite,date,now=new Date()){
  const context=recapDayContext(sqlite,date,now);
  const rows=new Map(dailyEvidence(sqlite,date).map(row=>[row.userId,row]));
  const roster=context.rosterKnown?rosterAt(sqlite,context.asOf):[];
  const members=new Map(roster.map(member=>[member.user_id,member]));
  for(const member of roster){
    if(!context.workday||member.role!=='employee'||member.active!==1||rows.has(member.user_id))continue;
    rows.set(member.user_id,{
      userId:member.user_id,date,name:member.name,email:member.email,
      checkIn:null,checkOut:null,status:null,absence:null,provisional:false,hasEvidence:false,
      issues:[],cancellationCount:0,activeRecordCount:0,
    });
  }
  const zoneCache=new Map();
  function eventTimezone(time){
    const at=Date.parse(time);
    if(!Number.isFinite(at)||at>now.valueOf())return null;
    if(!zoneCache.has(time))zoneCache.set(time,scheduleAt(sqlite,new Date(at)).schedule?.timezone??null);
    return zoneCache.get(time);
  }
  for(const row of rows.values()){
    const member=members.get(row.userId);
    row.eligible=context.rosterKnown?!!(context.workday&&member&&member.role==='employee'&&member.active===1):null;
    row.identitySource=member?'history':'evidence';
    if(member){row.name=member.name;row.email=member.email;}
    // Stored local dates and classification remain authoritative. Timezone
    // metadata is only for presentation, and stays unknown before coverage.
    for(const event of [row.checkIn,row.checkOut])if(event)event.timezone=eventTimezone(event.time);
  }
  return {context,rows:[...rows.values()].sort((a,b)=>compareText(a.name??'',b.name??'')||compareText(a.userId,b.userId))};
}
