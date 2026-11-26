import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, FilePlus2, Paperclip, RefreshCw, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import './absence-requests.css';

type Kind = 'leave' | 'sick';
type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';
interface Row {
  id: string; user_id: string; name_snapshot: string; email_snapshot: string;
  type: Kind; start_date: string; end_date: string; status: Status;
  created_at: string; effective_day_count: number; has_attachment: number;
}
interface ListResult { rows: Row[]; page: number; pageSize: number; total: number; totalPages: number }
interface DetailResult {
  request: Row & { reason: string; review_reason: string | null; cancel_reason: string | null };
  days: string[];
  history: { from_status: Status | null; to_status: Status; actor_user_id: string; reason: string | null; created_at: string }[];
  attachment: { original_name: string; mime_type: string; file_size: number } | null;
}
const statusLabels: Record<Status,string> = {
  pending: 'Menunggu persetujuan', approved: 'Disetujui', rejected: 'Ditolak', cancelled: 'Dibatalkan'
};
const kindLabels: Record<Kind,string> = { leave: 'Izin', sick: 'Sakit' };
function errorText(value: unknown, fallback: string) {
  return value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : fallback;
}
async function request<T>(action: string, options: { method?: 'POST'; body?: Record<string,unknown>; params?: Record<string,string>; signal?: AbortSignal } = {}): Promise<T> {
  const params = new URLSearchParams({ action, ...options.params });
  const response = await fetch('/api/app?' + params, {
    method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(options.method ? { 'Content-Type': 'application/json' } : {}) },
    body: options.method ? JSON.stringify({ action, ...options.body }) : undefined,
    signal: options.signal
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorText(payload,'Permintaan gagal. Silakan coba lagi.'));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Respons server tidak valid.');
  return payload as T;
}
const displayDate = (value: string) => {
  const [year,month,day] = value.split('-');
  return year && month && day ? day+'/'+month+'/'+year : value;
};
async function encodeAttachment(file: File) {
  if (file.size > 5*1024*1024) throw new Error('Ukuran lampiran maksimal 5 MiB.');
  const extension = file.name.toLowerCase().split('.').at(-1);
  const mimeType = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' :
    extension === 'png' ? 'image/png' : extension === 'pdf' ? 'application/pdf' : null;
  if (!mimeType) throw new Error('Lampiran harus JPG, PNG, atau PDF.');
  const base64 = await new Promise<string>((resolve,reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca lampiran.'));
    reader.onload = () => {
      const raw = reader.result;
      if (typeof raw !== 'string' || !raw.includes(',')) { reject(new Error('Lampiran tidak valid.')); return; }
      resolve(raw.split(',')[1]);
    };
    reader.readAsDataURL(file);
  });
  return { name: file.name, mimeType, base64 };
}
export default function AbsenceRequests({admin}:{admin:boolean}) {
  const [rows,setRows] = useState<Row[]>([]);
  const [page,setPage] = useState(1);
  const [totalPages,setTotalPages] = useState(1);
  const [status,setStatus] = useState('');
  const [revision,setRevision] = useState(0);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');
  const [formOpen,setFormOpen] = useState(false);
  const [kind,setKind] = useState<Kind>('leave');
  const [startDate,setStartDate] = useState('');
  const [endDate,setEndDate] = useState('');
  const [reason,setReason] = useState('');
  const [file,setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selected,setSelected] = useState<string | null>(null);
  const [detail,setDetail] = useState<DetailResult | null>(null);
  const [detailError,setDetailError] = useState('');
  const [reviewReason,setReviewReason] = useState('');
  const [detailRevision,setDetailRevision] = useState(0);
  const detailDialogRef = useRef<HTMLElement>(null);
  const detailCloseRef = useRef<HTMLButtonElement>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Keep keyboard navigation inside the modal and restore focus to the row when closing.
  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    const opener = detailOpenerRef.current;
    document.body.style.overflow = 'hidden';
    detailCloseRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (busyRef.current) return;
        event.preventDefault();
        setSelected(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = detailDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(element => element.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (current === first || !dialog.contains(current))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (current === last || !dialog.contains(current))) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [selected]);

  const refresh = useCallback(() => setRevision(value=>value+1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request<ListResult>('absence-list',{params: { page: String(page), pageSize:'10', ...(status ? {status} : {}) },signal:controller.signal})
      .then(result=>{if (!controller.signal.aborted) {setRows(result.rows);setTotalPages(result.totalPages);if (result.page!==page) setPage(result.page);}})
      .catch(err=>{if(!controller.signal.aborted) setError(err instanceof Error?err.message:'Gagal memuat pengajuan.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[page,status,revision]);
  useEffect(()=>{
    if(!selected){setDetail(null);setDetailError('');return;}
    const controller = new AbortController();
    setDetail(null);
    setDetailError('');
    request<DetailResult>('absence-detail',{params:{id:selected},signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted)setDetail(value);})
      .catch(err=>{if(!controller.signal.aborted)setDetailError(err instanceof Error?err.message:'Gagal memuat rincian.');});
    return ()=>controller.abort();
  },[selected,detailRevision]);
  function toggleDetail(id: string, opener: HTMLElement) {
    detailOpenerRef.current = opener;
    setSelected(current=>current===id?null:id);
    setReviewReason('');
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!startDate || !endDate || startDate > endDate) {setError('Periksa tanggal mulai dan selesai.');return;}
    if (reason.trim().length < 5 || reason.trim().length > 500) {setError('Alasan harus terdiri dari 5–500 karakter.');return;}
    setBusy(true);
    try {
      const attachment = file ? await encodeAttachment(file) : undefined;
      await request('absence-submit',{method:'POST',body:{type:kind,startDate,endDate,reason:reason.trim(),...(attachment?{attachment}:{})}});
      setFormOpen(false);setStartDate('');setEndDate('');setReason('');setFile(null);
      if(fileInputRef.current) fileInputRef.current.value = '';
      setSuccess('Pengajuan berhasil dikirim dan menunggu persetujuan admin.');
      setStatus('');setPage(1);refresh();
    }catch(err){setError(err instanceof Error?err.message:'Gagal mengirim pengajuan.');}
    finally {setBusy(false);}
  }
  async function transition(action:'approve'|'reject'|'cancel') {
    if(!selected||!detail)return;
    const text = reviewReason.trim();
    if ((action==='reject'||(admin&&action==='cancel'))&&(text.length<5||text.length>500)){
      setDetailError('Alasan tindakan admin harus terdiri dari 5–500 karakter.');return;
    }
    if(action==='approve' && !window.confirm('Setujui pengajuan ini?'))return;
    if(action==='cancel' && !window.confirm('Batalkan pengajuan ini?'))return;
    setBusy(true);setDetailError('');setError('');setSuccess('');
    try{
      await request('absence-'+action,{method:'POST',body:{id:selected,...(text?{reason:text}:{})}});
      setSuccess(action==='approve'?'Pengajuan disetujui.':action==='reject'?'Pengajuan ditolak.':'Pengajuan dibatalkan.');
      setReviewReason('');setDetailRevision(v=>v+1);refresh();
    }catch(err){setDetailError(err instanceof Error?err.message:'Gagal memperbarui status.');}
    finally {setBusy(false);}
  }
  async function downloadAttachment() {
    if(!selected)return;
    setBusy(true);setDetailError('');
    try {
      const response = await fetch('/api/app?'+new URLSearchParams({action:'absence-attachment',id:selected}),{
        credentials:'same-origin',cache:'no-store'
      });
      if(!response.ok){const data:unknown=await response.json().catch(()=>null);throw new Error(errorText(data,'Gagal mengunduh lampiran.'));}
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href=url;link.download=detail?.attachment?.original_name||'lampiran';
      document.body.appendChild(link);link.click();link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(err){setDetailError(err instanceof Error?err.message:'Gagal mengunduh lampiran.');}
    finally{setBusy(false);}
  }
  return <>
  <section className="panel absence-page">
    <div className="absence-page-toolbar">
      <div><h2>{admin?'Daftar pengajuan anggota':formOpen?'Pengajuan & riwayat':'Riwayat pengajuan'}</h2><p>{admin?'Tinjau izin dan sakit yang diajukan anggota.':'Pantau izin dan sakit yang sudah kamu ajukan.'}</p></div>
      <div className="absence-page-controls">
        <label>Status
          <select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);setSelected(null);}} aria-label="Filter status pengajuan">
            <option value="">Semua status</option>
            {Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="button" onClick={refresh} disabled={loading||busy}><RefreshCw size={15}/> Segarkan</button>
        {!admin&&<button type="button" className="button primary" onClick={()=>{setFormOpen(v=>!v);setError('');}}><FilePlus2 size={15}/> {formOpen?'Tutup formulir':'Ajukan izin/sakit'}</button>}
      </div>
    </div>
    {success&&<p className="absence-feedback" role="status">{success}</p>}
    {error&&<p className="absence-error" role="alert">{error}</p>}
    {!admin&&formOpen&&<form className="absence-form" onSubmit={submit}>
      <div className="absence-form-heading"><h3>Pengajuan baru</h3><p>Isi informasi izin atau sakit yang ingin diajukan.</p></div>
      <label>Jenis pengajuan<select value={kind} onChange={e=>setKind(e.target.value as Kind)} required><option value="leave">Izin</option><option value="sick">Sakit</option></select></label>
      <div className="absence-date-grid">
        <label>Tanggal mulai<input type="date" required value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
        <label>Tanggal selesai<input type="date" required min={startDate||undefined} value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
      </div>
      <label>Alasan<textarea rows={3} required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Tuliskan alasan pengajuan..."/></label>
      <div className="absence-file-field">
        <span className="absence-file-caption" id="absence-file-caption">Lampiran pendukung (opsional)</span>
        <div className="absence-file-picker">
          <input ref={fileInputRef} id="absence-file-input" className="absence-file-input"
            type="file" accept=".jpg,.jpeg,.png,.pdf" aria-labelledby="absence-file-caption"
            onChange={e=>setFile(e.target.files?.[0]??null)}/>
          <label className="absence-file-button" htmlFor="absence-file-input"><Paperclip size={15}/> Pilih file</label>
          <span className="absence-file-name" title={file?.name??'Belum ada file dipilih'}>
            {file?.name??'Belum ada file dipilih'}
          </span>
          {file&&<button type="button" className="absence-file-remove"
            aria-label="Hapus lampiran" disabled={busy}
            onClick={()=>{setFile(null);if(fileInputRef.current)fileInputRef.current.value='';}}><X size={16}/></button>}
        </div>
      </div>
      <p className="absence-helper">Kamu dapat mengajukan izin atau sakit untuk tanggal sebelumnya maupun mendatang. Lampiran JPG, PNG, atau PDF bersifat opsional, maksimal 5 MB.</p>
      <div className="absence-actions"><button className="button primary" type="submit" disabled={busy}>{busy?'Mengirim…':'Kirim pengajuan'}</button><button type="button" className="button" disabled={busy} onClick={()=>setFormOpen(false)}>Batal</button></div>
    </form>}
    {!admin&&formOpen&&<div className="absence-history-heading">
      <h3>Riwayat pengajuan</h3>
      <p>Daftar pengajuan dan status persetujuanmu.</p>
    </div>}
    <p className="absence-table-hint">Geser tabel untuk melihat kolom lainnya. Ketuk baris untuk melihat detail pengajuan.</p>
    <div className="table-wrap"><table className="absence-table">
      <thead><tr>{admin&&<th>Anggota</th>}<th>Jenis</th><th>Periode</th><th>Hari kerja</th><th>Status</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.id} role="button" tabIndex={0}
        className={selected===row.id?'absence-row-selected':undefined}
        aria-label={`Buka detail pengajuan ${kindLabels[row.type]} ${admin?'oleh '+row.name_snapshot+' ':''}tanggal ${displayDate(row.start_date)} sampai ${displayDate(row.end_date)}, ${statusLabels[row.status]}`}
        aria-expanded={selected===row.id}
        aria-controls={selected===row.id?'absence-request-detail':undefined}
        onClick={event=>toggleDetail(row.id,event.currentTarget)}
        onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDetail(row.id,event.currentTarget);}}}>
        {admin&&<td><strong>{row.name_snapshot}</strong><small>{row.email_snapshot}</small></td>}
        <td>{kindLabels[row.type]}</td><td>{displayDate(row.start_date)} – {displayDate(row.end_date)}</td>
        <td>{row.effective_day_count}</td><td><span className={'badge absence-status-'+row.status}>{statusLabels[row.status]}</span></td>
      </tr>)}</tbody>
    </table></div>
    {!loading&&!rows.length&&<div className="empty"><CalendarDays size={28}/><h3>Belum ada pengajuan</h3><p>Pengajuan yang sesuai filter akan ditampilkan di sini.</p></div>}
    {loading&&<p className="absence-loading" role="status">Memuat pengajuan…</p>}
    <div className="absence-pagination">
      <span>Halaman {page} dari {totalPages}</span>
      <div><button type="button" className="button" disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)} aria-label="Halaman sebelumnya"><ChevronLeft size={16}/></button>
      <button type="button" className="button" disabled={loading||page>=totalPages} onClick={()=>setPage(p=>p+1)} aria-label="Halaman berikutnya"><ChevronRight size={16}/></button></div>
    </div>
  </section>
  {selected&&createPortal(
    <div className="overlay absence-modal-overlay"
      onMouseDown={event=>{if(event.currentTarget===event.target&&!busyRef.current)setSelected(null);}}>
      <section id="absence-request-detail" ref={detailDialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="absence-detail-heading"
        className="modal absence-detail absence-modal-card">
        <div className="absence-detail-head"><h2 id="absence-detail-heading">Detail pengajuan</h2>
          <button type="button" ref={detailCloseRef} className="icon-button" aria-label="Tutup detail"
            disabled={busy} onClick={()=>setSelected(null)}><X size={20}/></button>
        </div>
      {detailError&&<p role="alert" className="absence-error">{detailError}</p>}
      {!detail&&!detailError&&<p>Memuat rincian…</p>}
      {detail&&<>
        <div className="absence-detail-grid">
          <div><small>Jenis</small><strong>{kindLabels[detail.request.type]}</strong></div>
          <div><small>Status</small><strong>{statusLabels[detail.request.status]}</strong></div>
          <div><small>Periode</small><strong>{displayDate(detail.request.start_date)} – {displayDate(detail.request.end_date)}</strong></div>
          <div><small>Hari kerja efektif</small><strong>{detail.days.length} hari</strong></div>
        </div>
        <div className="absence-detail-text"><strong>Alasan pengajuan</strong><p>{detail.request.reason}</p></div>
        {detail.request.review_reason&&<div className="absence-detail-text"><strong>Catatan admin</strong><p>{detail.request.review_reason}</p></div>}
        {detail.request.cancel_reason&&<div className="absence-detail-text"><strong>Alasan pembatalan</strong><p>{detail.request.cancel_reason}</p></div>}
        {detail.attachment&&<div className="absence-attachment"><span>Lampiran: {detail.attachment.original_name}</span><button className="button" type="button" disabled={busy} onClick={downloadAttachment}><Download size={15}/> Unduh</button></div>}
        <p className="absence-helper">Tanggal efektif: {detail.days.map(displayDate).join(', ')}</p>
        {detail.history.length>0&&<div className="absence-detail-text"><strong>Riwayat status</strong><ul>{detail.history.map((event,index)=><li key={index}>{statusLabels[event.to_status]}{event.reason?' — '+event.reason:''}</li>)}</ul></div>}
        {admin&&detail.request.status==='pending'&&<div className="absence-review">
          <label>Alasan penolakan (wajib jika menolak)<textarea rows={2} value={reviewReason} onChange={e=>setReviewReason(e.target.value)} maxLength={500} placeholder="Alasan keputusan admin..."/></label>
          <div className="absence-actions"><button type="button" className="button primary" disabled={busy} onClick={()=>transition('approve')}>Setujui</button><button type="button" className="button" disabled={busy} onClick={()=>transition('reject')}>Tolak</button></div>
        </div>}
        {admin&&detail.request.status==='approved'&&<div className="absence-review">
          <label>Alasan pembatalan (wajib)<textarea rows={2} maxLength={500} value={reviewReason} onChange={e=>setReviewReason(e.target.value)} placeholder="Alasan pembatalan..."/></label>
          <button type="button" className="button" disabled={busy} onClick={()=>transition('cancel')}>Batalkan persetujuan</button>
        </div>}
        {!admin&&detail.request.status==='pending'&&<div className="absence-actions"><button type="button" className="button" disabled={busy} onClick={()=>transition('cancel')}>Batalkan pengajuan</button></div>}
      </>}
      </section>
    </div>,document.body)}
  </>;
}
