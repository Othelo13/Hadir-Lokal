import { useEffect, useState } from 'react';
import { ChevronLeft,ChevronRight,RefreshCw,Search,Users } from 'lucide-react';
import { getMemberRecap } from './member-recap-api';
import type { MemberRecapResponse } from './member-recap-types';

export default function MemberRecapTable({officeToday,onHistory}:{
 officeToday:string;onHistory:()=>void;
}){
 const [month,setMonth]=useState(officeToday.slice(0,7));
 const [search,setSearch]=useState('');
 const [query,setQuery]=useState('');
 const [page,setPage]=useState(1);
 const [pageSize,setPageSize]=useState<10|20|50>(10);
 const [revision,setRevision]=useState(0);
 const [recap,setRecap]=useState<MemberRecapResponse|null>(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
  const handle=setTimeout(()=>setQuery(search.trim()),300);
  return ()=>clearTimeout(handle);
 },[search]);
 const typing=search.trim()!==query;
 useEffect(()=>{
  if(typing){setRecap(null);setLoading(true);setError('');return;}
  const controller=new AbortController();
  let active=true;
  setRecap(null);setLoading(true);setError('');
  getMemberRecap({month,q:query,page,pageSize},controller.signal).then(result=>{
   if(!active)return;
   setRecap(result);
   if(result.page!==page)setPage(result.page);
  }).catch((cause:unknown)=>{
   if(!active||(cause instanceof Error&&cause.name==='AbortError'))return;
   setError(cause instanceof Error?cause.message:'Gagal memuat rekap anggota.');
  }).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;controller.abort();};
 },[month,query,page,pageSize,revision,typing]);
 const start=recap&&recap.total?(recap.page-1)*recap.pageSize+1:0;
 const end=recap?Math.min(recap.page*recap.pageSize,recap.total):0;
 return <section className="panel member-recap" aria-label="Rekap absensi per anggota">
  <div className="daily-recap-head">
   <h2>Rekap kehadiran anggota</h2>
   <button type="button" className="button" disabled={loading||typing} onClick={()=>setRevision(x=>x+1)}>
    <RefreshCw size={15} aria-hidden="true"/> Perbarui
   </button>
  </div>
  <div className="daily-recap-filters">
   <label className="daily-recap-filter-date">Bulan rekap
    <input type="month" value={month} min="1900-01" max="9998-12"
     onChange={e=>{setMonth(e.target.value);setPage(1);}}/>
   </label>
   <label className="daily-recap-filter-search">Cari anggota
    <span className="daily-recap-search-field"><Search size={16} aria-hidden="true"/>
     <input type="search" value={search} placeholder="Cari nama atau email…" maxLength={100}
      onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
    </span>
   </label>
   <button type="button" className="button daily-recap-reset" onClick={()=>{
    setMonth(officeToday.slice(0,7));setSearch('');setQuery('');setPage(1);setRevision(x=>x+1);
   }}>Reset filter</button>
  </div>
  {error&&<div role="alert" className="daily-recap-error">{error}
   <button type="button" className="button" onClick={()=>setRevision(x=>x+1)}>Coba lagi</button>
  </div>}
  {(loading||typing)&&<p role="status" className="daily-recap-state">Memuat rekap anggota…</p>}
  {!loading&&!typing&&!error&&recap&&<>
   {recap.unverifiedDates>0&&<p className="daily-recap-message" role="status">
    Ada {recap.unverifiedDates} tanggal dengan cakupan riwayat belum lengkap.
    Tanggal tersebut tidak otomatis dihitung sebagai tidak hadir.
   </p>}
   <div className="table-wrap member-recap-wrap">
    <table className="member-recap-table" aria-label="Jumlah hari kehadiran setiap anggota magang">
     <thead><tr>
      <th>Anggota</th><th>Hadir</th><th>Tidak hadir</th><th>Izin</th><th>Sakit</th><th>Perlu tinjauan</th><th>Riwayat</th>
     </tr></thead>
     <tbody>{recap.rows.map(row=><tr key={row.userId}>
      <td><span className="member-cell-label">Anggota</span><div className="person">
       <span className="avatar" aria-hidden="true">{row.name.slice(0,2).toUpperCase()}</span>
       <span><strong>{row.name}</strong><small>{row.email}</small></span>
      </div></td>
      <td><span className="member-cell-label">Hadir</span><strong>{row.present}</strong>{row.late>0&&<small className="member-recap-muted">({row.late} terlambat)</small>}</td>
      <td><span className="member-cell-label">Tidak hadir</span><strong>{row.absent}</strong></td>
      <td><span className="member-cell-label">Izin</span><strong>{row.leave}</strong></td>
      <td><span className="member-cell-label">Sakit</span><strong>{row.sick}</strong></td>
      <td><span className="member-cell-label">Perlu tinjauan</span><strong>{row.pending}</strong></td>
      <td><span className="member-cell-label">Riwayat</span><button type="button" className="daily-recap-view-button"
       onClick={onHistory}>Buka riwayat</button></td>
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
      onChange={e=>{setPageSize(Number(e.target.value) as 10|20|50);setPage(1);}}>
      <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
     </select></label>
     <nav aria-label="Navigasi halaman rekap anggota">
      <button type="button" aria-label="Halaman sebelumnya" disabled={page<=1}
       onClick={()=>setPage(p=>p-1)}><ChevronLeft size={16}/></button>
      <span>Halaman {recap.page} dari {recap.totalPages}</span>
      <button type="button" aria-label="Halaman berikutnya" disabled={page>=recap.totalPages}
       onClick={()=>setPage(p=>p+1)}><ChevronRight size={16}/></button>
     </nav>
    </div>
   </div>
   <p className="member-recap-footnote">
    Hadir mencakup tepat waktu dan terlambat. Tidak hadir dihitung hanya pada hari kerja yang sudah selesai dengan riwayat lengkap; hari ini dan tanggal tanpa cakupan tidak dihitung.
   </p>
  </>}
 </section>;
}
