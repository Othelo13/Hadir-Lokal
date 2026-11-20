import { useEffect, useRef, useState } from 'react';
import './member-recap-period.css';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Search, Users, X } from 'lucide-react';
import { getMemberRecap } from './member-recap-api';
import DailyRecapDetail from './DailyRecapDetail';
import type { MemberRecapDay, MemberRecapPeriod, MemberRecapResponse, MemberRecapRow } from './member-recap-types';

const labels: Record<MemberRecapDay['state'],string> = {
 present:'Hadir',absent:'Tidak hadir',leave:'Izin',sick:'Sakit',pending:'Perlu tinjauan',
 ongoing:'Sedang berjalan',off:'Libur',future:'Belum berlangsung',unknown:'Riwayat belum lengkap',
 'not-applicable':'Belum menjadi anggota pada hari tersebut',
};
function periodDescription(value: MemberRecapResponse) {
 return value.startDate===value.endDate?value.startDate:value.startDate+' – '+value.endDate;
}

function MemberPeriodDetail({member,recap,officeToday,onClose,onChanged}:{
 member:MemberRecapRow;recap:MemberRecapResponse;officeToday:string;onClose:()=>void;onChanged:()=>void;
}) {
 const [selectedDay,setSelectedDay]=useState<string|null>(null);
 const selectedDayRef=useRef<string|null>(null);
 selectedDayRef.current=selectedDay;
 const closeRef=useRef<HTMLButtonElement>(null);
 const dialogRef=useRef<HTMLElement>(null);
 useEffect(()=>{
  const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  closeRef.current?.focus();
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){if(selectedDayRef.current)return;event.preventDefault();onClose();}
   if(selectedDayRef.current||event.key!=='Tab')return;
   const nodes=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')??[])
    .filter(node=>node.getClientRects().length>0);
   if(!nodes.length){event.preventDefault();dialogRef.current?.focus();return;}
   const index=nodes.indexOf(document.activeElement as HTMLElement);
   if(event.shiftKey&&(index<=0)){event.preventDefault();nodes.at(-1)?.focus();}
   else if(!event.shiftKey&&(index===nodes.length-1||index===-1)){event.preventDefault();nodes[0]?.focus();}
  };
  window.addEventListener('keydown',onKey);
  return ()=>{window.removeEventListener('keydown',onKey);document.body.style.overflow=overflow;if(opener?.isConnected)opener.focus();};
 },[onClose]);
 return <>
  <div className="overlay daily-recap-overlay" onMouseDown={e=>{if(!selectedDayRef.current&&e.currentTarget===e.target)onClose();}}>
   <section ref={dialogRef} tabIndex={-1} className="modal daily-recap-modal member-recap-modal"
    role="dialog" aria-modal="true" aria-labelledby="member-recap-detail-heading">
    <div className="modal-title daily-recap-detail-header">
     <div><small>DETAIL REKAP ANGGOTA</small>
      <h2 id="member-recap-detail-heading">{member.name}</h2>
      <p>{member.email}</p><p>{periodDescription(recap)}</p>
     </div>
     <button type="button" ref={closeRef} className="icon-button" onClick={onClose} aria-label="Tutup detail rekap"><X size={20}/></button>
    </div>
    <div className="member-recap-totals">
     {([['Hadir',member.present],['Tidak hadir',member.absent],['Izin',member.leave],
      ['Sakit',member.sick]] as const).map(([label,total])=>
      <div key={label}><small>{label}</small><strong>{total}</strong></div>)}
    </div>
    <section className="daily-recap-detail-section">
     <h3>Rincian per tanggal</h3>
     <p>Tekan tanggal yang memiliki rincian untuk melihat bukti absensi atau melakukan tindakan admin.</p>
     <div className="member-recap-day-list">
      {member.days.map(day=><div className="member-recap-day" key={day.date}>
       <span>{day.date}</span><span>{labels[day.state]}{day.late?' (terlambat)':''}</span>
       {day.hasDetail?<button type="button" className="daily-recap-view-button"
        onClick={()=>setSelectedDay(day.date)}>Lihat detail</button>:<span>—</span>}
      </div>)}
     </div>
    </section>
   </section>
  </div>
  {selectedDay&&<DailyRecapDetail
   key={selectedDay+member.userId}
   date={selectedDay} userId={member.userId} officeToday={officeToday}
   onClose={()=>setSelectedDay(null)} onChanged={()=>{onChanged();setSelectedDay(null);onClose();}}
  />}
 </>;
}

export default function MemberRecapTable({officeToday}:{officeToday:string}) {
 const [period,setPeriod]=useState<MemberRecapPeriod>('month');
 const [month,setMonth]=useState(officeToday.slice(0,7));
 const [date,setDate]=useState(officeToday);
 const [search,setSearch]=useState('');
 const [query,setQuery]=useState('');
 const [page,setPage]=useState(1);
 const [pageSize,setPageSize]=useState<10|20|50>(10);
 const [revision,setRevision]=useState(0);
 const [recap,setRecap]=useState<MemberRecapResponse|null>(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const [selected,setSelected]=useState<string|null>(null);
 useEffect(()=>{
  const timer=setTimeout(()=>setQuery(search.trim()),300);
  return ()=>clearTimeout(timer);
 },[search]);
 const typing=search.trim()!==query;
 useEffect(()=>{
  if(typing){setRecap(null);setLoading(true);setError('');return;}
  const controller=new AbortController();let active=true;
  setRecap(null);setLoading(true);setError('');
  getMemberRecap({period,...(period==='month'?{month}:{date}),q:query,page,pageSize},controller.signal)
   .then(result=>{if(!active)return;setRecap(result);if(result.page!==page)setPage(result.page);})
   .catch((cause:unknown)=>{
    if(!active||(cause instanceof Error&&cause.name==='AbortError'))return;
    setError(cause instanceof Error?cause.message:'Gagal memuat rekap anggota.');
   }).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;controller.abort();};
 },[period,month,date,query,page,pageSize,revision,typing]);
 const start=recap&&recap.total?(recap.page-1)*recap.pageSize+1:0;
 const end=recap?Math.min(recap.page*recap.pageSize,recap.total):0;
 const selectedMember=selected?recap?.rows.find(row=>row.userId===selected):null;
 function changePeriod(value:MemberRecapPeriod){setSelected(null);setPeriod(value);setPage(1);}
 return <>
 <section className="panel member-recap" aria-label="Rekap absensi per anggota">
  <div className="daily-recap-head">
   <h2>Rekap kehadiran anggota</h2>
   <button type="button" className="button" disabled={loading||typing} onClick={()=>setRevision(x=>x+1)}>
    <RefreshCw size={15} aria-hidden="true"/> Perbarui
   </button>
  </div>
  <div className="daily-recap-filters">
   <label className="daily-recap-filter-date">Periode rekap
    <select value={period} aria-label="Pilih periode rekap" onChange={e=>changePeriod(e.target.value as MemberRecapPeriod)}>
     <option value="day">Harian</option><option value="week">Mingguan</option><option value="month">Bulanan</option>
    </select>
   </label>
   <label className="daily-recap-filter-date">{period==='month'?'Bulan rekap':period==='week'?'Pilih tanggal dalam minggu':'Tanggal rekap'}
    <input type={period==='month'?'month':'date'} aria-label={period==='month'?'Bulan rekap':'Tanggal rekap'}
     value={period==='month'?month:date} min={period==='month'?'1900-01':'1900-01-01'}
     max={period==='month'?'9998-12':'9998-12-31'}
     onChange={e=>{setSelected(null);if(period==='month')setMonth(e.target.value);else setDate(e.target.value);setPage(1);}}/>
   </label>
   <label className="daily-recap-filter-search">Cari anggota
    <span className="daily-recap-search-field"><Search size={16} aria-hidden="true"/>
     <input type="search" value={search} placeholder="Cari nama atau email…" maxLength={100}
      onChange={e=>{setSelected(null);setSearch(e.target.value);setPage(1);}}/>
    </span>
   </label>
   <button type="button" className="button daily-recap-reset" onClick={()=>{
    setSelected(null);setPeriod('month');setMonth(officeToday.slice(0,7));setDate(officeToday);
    setSearch('');setQuery('');setPage(1);setRevision(x=>x+1);
   }}>Reset filter</button>
  </div>
  {error&&<div role="alert" className="daily-recap-error">{error}
   <button type="button" className="button" onClick={()=>setRevision(x=>x+1)}>Coba lagi</button>
  </div>}
  {(loading||typing)&&<p role="status" className="daily-recap-state">Memuat rekap anggota…</p>}
  {!loading&&!typing&&!error&&recap&&<>
   <div className="member-recap-period-caption"><CalendarDays size={15} aria-hidden="true"/>
    Periode: {periodDescription(recap)}
   </div>
   {recap.unverifiedDates>0&&<p className="daily-recap-message" role="status">
    Ada {recap.unverifiedDates} tanggal dengan cakupan riwayat belum lengkap.
    Tanggal tersebut tidak otomatis dihitung sebagai tidak hadir.
   </p>}
   <div className="table-wrap member-recap-wrap">
    <table className="member-recap-table" aria-label="Jumlah hari kehadiran setiap anggota magang">
     <thead><tr>
      <th>Anggota</th><th>Hadir</th><th>Tidak hadir</th><th>Izin</th><th>Sakit</th>
     </tr></thead>
     <tbody>{recap.rows.map(row=><tr key={row.userId} role="button" tabIndex={0}
      aria-label={'Buka detail rekap '+row.name}
      onClick={()=>setSelected(row.userId)}
      onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelected(row.userId);}}}>
      <td><span className="member-cell-label">Anggota</span><div className="person">
       <span className="avatar" aria-hidden="true">{row.name.slice(0,2).toUpperCase()}</span>
       <span><strong>{row.name}</strong><small>{row.email}</small></span>
      </div></td>
      <td><span className="member-cell-label">Hadir</span><strong>{row.present}</strong>{row.late>0&&<small className="member-recap-muted">({row.late} terlambat)</small>}</td>
      <td><span className="member-cell-label">Tidak hadir</span><strong>{row.absent}</strong></td>
      <td><span className="member-cell-label">Izin</span><strong>{row.leave}</strong></td>
      <td><span className="member-cell-label">Sakit</span><strong>{row.sick}</strong></td>
     </tr>)}</tbody>
    </table>
   </div>
   {recap.rows.length===0&&<div className="empty">
    <Users size={30} aria-hidden="true"/><h3>Tidak ada anggota magang</h3>
    <p>Tambahkan akun anggota magang atau ubah pencarian.</p>
   </div>}
   <div className="daily-recap-footer">
    <span>Menampilkan {start}–{end} dari {recap.total} anggota</span>
    <div className="daily-recap-pages">
     <label>Baris <select value={pageSize} aria-label="Jumlah anggota per halaman"
      onChange={e=>{setSelected(null);setPageSize(Number(e.target.value) as 10|20|50);setPage(1);}}>
      <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
     </select></label>
     <nav aria-label="Navigasi halaman rekap anggota">
      <button type="button" aria-label="Halaman sebelumnya" disabled={page<=1}
       onClick={()=>{setSelected(null);setPage(p=>p-1);}}><ChevronLeft size={16}/></button>
      <span>Halaman {recap.page} dari {recap.totalPages}</span>
      <button type="button" aria-label="Halaman berikutnya" disabled={page>=recap.totalPages}
       onClick={()=>{setSelected(null);setPage(p=>p+1);}}><ChevronRight size={16}/></button>
     </nav>
    </div>
   </div>
   <p className="member-recap-footnote">
    Hadir mencakup tepat waktu dan terlambat. Tidak hadir hanya dihitung pada hari kerja yang sudah selesai dengan riwayat lengkap. Klik baris anggota untuk melihat rincian setiap tanggal.
   </p>
  </>}
 </section>
 {selectedMember&&recap&&<MemberPeriodDetail key={selectedMember.userId+recap.startDate}
  member={selectedMember} recap={recap} officeToday={officeToday}
  onClose={()=>setSelected(null)} onChanged={()=>setRevision(x=>x+1)}/>}
 </>;
}
