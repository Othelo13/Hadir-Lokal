import { officeDate,parseCalendarDate } from './absence-policy.mjs';
import { historicalDailyRecap } from './historical-daily-recap.mjs';

function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function single(params,key){
  const values=params.getAll(key);
  if(values.length>1)fail('Parameter '+key+' tidak boleh berulang.');
  return values[0]??null;
}
function integer(raw,fallback,max){
  if(raw===null)return fallback;
  if(!/^\d+$/.test(raw))fail('Parameter halaman tidak valid.');
  const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<1||n>max)fail('Parameter halaman tidak valid.');
  return n;
}
function normalize(value){return value.normalize('NFKC').toLowerCase();}

/** Read snapshot includes live authentication, office date, historical rows and pagination.
 * authenticate must re-read the session on this same connection.
 */
export function handleDailyRecap(sqlite,actorId,method,params,authenticate,clock=()=>new Date()){
  if(method!=='GET')fail('Metode tidak didukung.',405);
  sqlite.exec('BEGIN');
  try{
    const actor=authenticate();
    if(!actor||actor.user_id!==actorId||actor.active!==1)fail('Sesi telah berakhir. Silakan masuk kembali.',401);
    if(actor.role!=='admin')fail('Hanya admin yang dapat melihat rekap absensi.',403);
    for(const key of params.keys())if(!['action','date','q','page','pageSize'].includes(key))fail('Parameter rekap tidak dikenal.');
    const action=single(params,'action');
    if(action!==null&&action!=='daily-recap')fail('Tindakan tidak sesuai.');
    const now=clock();
    const config=sqlite.prepare('SELECT timezone FROM config WHERE id=1').get();
    const requestedDate=single(params,'date');
    if(requestedDate===null&&!config)fail('Jadwal kantor belum tersedia.',409);
    const date=requestedDate??officeDate(now,config.timezone);
    parseCalendarDate(date);
    // Restrict to modern calendar dates with a representable next-day boundary.
    if(date<'1900-01-01'||date>'9998-12-31')fail('Tanggal rekap di luar rentang yang didukung.');
    const raw=single(params,'q')??'';
    if(raw.length>100||/[\x00-\x1f\x7f]/.test(raw))fail('Pencarian tidak valid.');
    const q=raw.trim(),needle=normalize(q);
    const pageSize=integer(single(params,'pageSize'),10,50);
    if(![10,20,50].includes(pageSize))fail('Ukuran halaman tidak valid.');
    const requestedPage=integer(single(params,'page'),1,1000000);
    const {context,rows}=historicalDailyRecap(sqlite,date,now);
    const filtered=needle?rows.filter(row=>normalize(row.name??'').includes(needle)||normalize(row.email??'').includes(needle)):rows;
    const total=filtered.length,totalPages=Math.max(1,Math.ceil(total/pageSize));
    const page=Math.min(requestedPage,totalPages);
    const result={date,q,context,rows:filtered.slice((page-1)*pageSize,page*pageSize),page,pageSize,total,totalPages};
    sqlite.exec('COMMIT');
    return result;
  }catch(error){
    sqlite.exec('ROLLBACK');
    throw error;
  }
}
