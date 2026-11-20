import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Download, FileText, RefreshCw, X } from 'lucide-react';
import { getDailyRecapDetail } from './recap-api';
import { recapWrappedTabTarget } from './recap-accessibility';
import { canAuthorizeRecapRetake, canCancelRecapRecord, canReviewRecapRecord, submitRecapAction, validCancellationReason } from './recap-actions';
import type { RecapReview } from './recap-actions';
import { coverageMessage } from './recap-presentation';
import { recapAbsenceLabel, recapAttachmentHref, recapAttendanceKind, recapCancellationSummary, recapDetailSummary, recapInstantLabel, recapPhotoHref, recapReviewLabel } from './recap-detail-model';
import type { DailyRecapDetail } from './recap-types';

type Confirmation =
  | { type: 'review'; id: string; review: RecapReview; label: string }
  | { type: 'cancel'; id: string; label: string }
  | { type: 'retake'; id: string; label: string };

interface Props {
  date: string;
  userId: string;
  officeToday: string;
  onClose: () => void;
  onChanged: () => void;
}

export default function DailyRecapDetail({ date, userId, officeToday, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<DailyRecapDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelReasonInput = useRef<HTMLTextAreaElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const latestClose = useRef(onClose);
  const latestBusy = useRef(busy);
  const latestConfirmation = useRef(confirmation);
  latestClose.current = onClose;
  latestBusy.current = busy;
  latestConfirmation.current = confirmation;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (latestBusy.current) return;
        event.preventDefault();
        if (latestConfirmation.current) {
          setConfirmation(null);
          setCancelReason('');
          setActionError('');
          closeButton.current?.focus();
        } else latestClose.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0 && !element.closest('[hidden],[inert]'));
      if (!elements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active = elements.indexOf(document.activeElement as HTMLElement);
      const next = recapWrappedTabTarget(active, elements.length, event.shiftKey);
      if (next !== null) {
        event.preventDefault();
        elements[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      // Return keyboard users to the member button they originally opened.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (!confirmation) return;
    if (confirmation.type === 'cancel') cancelReasonInput.current?.focus();
    else confirmButton.current?.focus();
  }, [confirmation]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setDetail(null);
    setLoading(true);
    setError('');
    setPhotoId(null);
    setPhotoError(false);
    getDailyRecapDetail(date, userId, controller.signal).then((value) => {
      if (active) setDetail(value);
    }).catch((cause: unknown) => {
      if (!active || (cause instanceof Error && cause.name === 'AbortError')) return;
      setError(cause instanceof Error ? cause.message : 'Gagal membuka detail absensi.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [date, userId, revision]);

  function chooseAction(value: Confirmation) {
    if (busy) return;
    setConfirmation(value);
    setCancelReason('');
    setActionError('');
    setActionNotice('');
  }

  async function confirmAction() {
    if (!confirmation || busy) return;
    setActionError('');
    setActionNotice('');
    setBusy(true);
    try {
      const result = await submitRecapAction(
        confirmation.type === 'cancel'
          ? { type: 'cancel', id: confirmation.id, reason: cancelReason }
          : confirmation.type === 'retake'
            ? { type: 'retake', id: confirmation.id }
            : { type: 'review', id: confirmation.id, review: confirmation.review },
      );
      setActionNotice(result.warning || (
        confirmation.type === 'review' ? 'Status selfie berhasil diperbarui.' :
          confirmation.type === 'retake' ? 'Izin absensi ulang berhasil diberikan.' :
            'Absensi dibatalkan. Foto dihapus jika pembersihan berhasil.'
      ));
      setConfirmation(null);
      setCancelReason('');
      setPhotoId(null);
      setPhotoError(false);
      setRevision((value) => value + 1);
      closeButton.current?.focus();
      onChanged();
    } catch (cause: unknown) {
      setActionError(cause instanceof Error ? cause.message : 'Tindakan gagal. Silakan coba kembali.');
    } finally {
      setBusy(false);
    }
  }

  const summary = detail ? recapDetailSummary(detail) : null;
  const photoRecord = detail?.records.find((record) => record.id === photoId);

  return (
    <div
      className="overlay daily-recap-overlay"
      onMouseDown={(event) => { if (!busy && !confirmation && event.target === event.currentTarget) onClose(); }}
    >
      <section ref={dialogRef} tabIndex={-1} className="modal daily-recap-modal" role="dialog" aria-modal="true" aria-labelledby="recap-detail-heading">
        <div className="modal-title daily-recap-detail-header">
          <div>
            <small>DETAIL REKAP HARIAN</small>
            <h2 id="recap-detail-heading">{summary?.name ?? 'Memuat detail absensi…'}</h2>
            {summary && <p>{summary.email}</p>}
          </div>
          <button ref={closeButton} type="button" className="icon-button" aria-label="Tutup detail absensi" disabled={busy} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {actionNotice && <div className="daily-recap-action-success" role="status">{actionNotice}</div>}
        {loading && <p className="daily-recap-state" role="status">Memuat detail absensi…</p>}
        {error && (
          <div className="daily-recap-error" role="alert">
            <span>{error}</span>
            <button type="button" className="button" onClick={() => setRevision((value) => value + 1)}>
              <RefreshCw size={15} aria-hidden="true" /> Coba lagi
            </button>
          </div>
        )}
        {!loading && !error && detail && summary && (
          <div className="daily-recap-detail-body">
            <div className="daily-recap-detail-meta">
              <span><CalendarDays size={15} aria-hidden="true" /> {summary.date}</span>
              <span className={'badge daily-recap-status ' + (detail.summary.status ?? 'none')}>{summary.status}</span>
              {summary.note !== '—' && <span className="daily-recap-detail-note">{summary.note}</span>}
            </div>
            {coverageMessage(detail.context) && (
              <p className="daily-recap-message">{coverageMessage(detail.context)}</p>
            )}
            {confirmation && (
              <section className="daily-recap-confirm" aria-label="Konfirmasi tindakan admin">
                <h3>{confirmation.label}</h3>
                <p>{confirmation.type === 'cancel'
                  ? 'Foto selfie akan dihapus setelah pembatalan tercatat. Riwayat pembatalan tetap disimpan.'
                  : confirmation.type === 'retake'
                    ? 'Anggota akan diizinkan melakukan absensi ulang pada tanggal kantor yang sama.'
                    : 'Status review selfie akan diperbarui dan dapat mengubah hasil rekap.'}</p>
                {confirmation.type === 'cancel' && (
                  <label>Alasan pembatalan (wajib, 5–500 karakter)
                    <textarea ref={cancelReasonInput} value={cancelReason} minLength={5} maxLength={500}
                      onChange={(event) => setCancelReason(event.target.value)}
                      placeholder="Jelaskan alasan pembatalan absensi…" />
                  </label>
                )}
                {actionError && <p role="alert" className="daily-recap-action-error">{actionError}</p>}
                <div className="daily-recap-action-buttons">
                  <button type="button" className="button" disabled={busy} onClick={() => { setConfirmation(null); setCancelReason(''); setActionError(''); }}>Kembali</button>
                  <button ref={confirmButton} type="button" className={confirmation.type === 'cancel' ? 'button danger' : 'button primary'}
                    disabled={busy || (confirmation.type === 'cancel' && !validCancellationReason(cancelReason))}
                    onClick={confirmAction}>{busy ? 'Menyimpan…' : 'Konfirmasi tindakan'}</button>
                </div>
              </section>
            )}
            <div className="daily-recap-detail-stats">
              <div><small>Absen masuk</small><strong>{summary.checkIn}</strong></div>
              <div><small>Absen pulang</small><strong>{summary.checkOut}</strong></div>
            </div>
            <section className="daily-recap-detail-section" aria-label="Catatan selfie">
              <h3>Catatan selfie</h3>
              <p>Termasuk catatan yang masih menunggu review atau sudah ditolak.</p>
              {detail.records.length === 0 && <p className="daily-recap-muted">Tidak ada catatan selfie aktif untuk tanggal ini.</p>}
              {detail.records.map((record) => (
                <div className="daily-recap-detail-item" key={record.id}>
                  <div className="daily-recap-detail-item-header">
                    <strong>{recapAttendanceKind(record.kind)}</strong>
                    <span className="badge">{recapReviewLabel(record.review)}</span>
                  </div>
                  <small>{recapInstantLabel(record.time, record.timezone)}</small>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => { setPhotoId(record.id === photoId ? null : record.id); setPhotoError(false); }}
                  >
                    {photoId === record.id ? 'Tutup foto selfie' : 'Lihat foto selfie'}
                  </button>
                  <div className="daily-recap-admin-actions">
                    {canReviewRecapRecord(record, 'approved') && <button type="button" className="button" disabled={busy}
                      onClick={() => chooseAction({ type: 'review', id: record.id, review: 'approved', label: 'Setujui ' + recapAttendanceKind(record.kind) })}>Setujui selfie</button>}
                    {canReviewRecapRecord(record, 'rejected') && <button type="button" className="button" disabled={busy}
                      onClick={() => chooseAction({ type: 'review', id: record.id, review: 'rejected', label: 'Tolak ' + recapAttendanceKind(record.kind) })}>Tolak selfie</button>}
                    {canCancelRecapRecord(detail, record) ? <button type="button" className="button danger" disabled={busy}
                      onClick={() => chooseAction({ type: 'cancel', id: record.id, label: 'Batalkan ' + recapAttendanceKind(record.kind) })}>Batalkan absensi</button>
                      : <small>Batalkan absensi pulang terlebih dahulu.</small>}
                  </div>
                </div>
              ))}
              {photoRecord && (
                <div className="daily-recap-photo-preview">
                  <strong>Foto: {recapAttendanceKind(photoRecord.kind)}</strong>
                  {photoError ? (
                    <p role="alert">Foto tidak tersedia atau akses ditolak.</p>
                  ) : (
                    <img
                      src={recapPhotoHref(photoRecord)}
                      alt={'Bukti selfie ' + recapAttendanceKind(photoRecord.kind).toLowerCase()}
                      onError={() => setPhotoError(true)}
                    />
                  )}
                </div>
              )}
            </section>
            <section className="daily-recap-detail-section" aria-label="Riwayat pembatalan">
              <h3>Riwayat pembatalan absensi</h3>
              {detail.cancellations.length === 0 && <p className="daily-recap-muted">Tidak ada pembatalan untuk tanggal ini.</p>}
              {detail.cancellations.map((cancel) => {
                const item = recapCancellationSummary(cancel);
                return (
                  <div className="daily-recap-detail-item" key={cancel.id}>
                    <div className="daily-recap-detail-item-header">
                      <strong>{item.kind}</strong>
                      <span className="badge danger">Dibatalkan</span>
                    </div>
                    <small>Catatan asli: {item.time}</small>
                    <small>Oleh {item.cancelledBy} · {recapInstantLabel(item.cancelledAt, detail.context.timezone)}</small>
                    <p><strong>Alasan:</strong> {item.reason}</p>
                    <small>Otorisasi ulang: {item.retakeAuthorized ? 'Diberikan' : 'Belum diberikan'}</small>
                    {canAuthorizeRecapRetake(detail, cancel, officeToday) && <button type="button" className="button" disabled={busy}
                      onClick={() => chooseAction({type:'retake',id:cancel.id,label:'Izinkan absen ulang ' + item.kind})}>Izinkan absen ulang</button>}
                  </div>
                );
              })}
            </section>
            <section className="daily-recap-detail-section" aria-label="Pengajuan izin dan sakit">
              <h3>Pengajuan izin / sakit</h3>
              {detail.absences.length === 0 && <p className="daily-recap-muted">Tidak ada pengajuan pada tanggal ini.</p>}
              {detail.absences.map((request) => (
                <div className="daily-recap-detail-item" key={request.id}>
                  <div className="daily-recap-detail-item-header">
                    <strong>{request.type === 'sick' ? 'Sakit' : 'Izin'}</strong>
                    <span className="badge">{recapAbsenceLabel(request.status)}</span>
                  </div>
                  <small>Periode: {request.start_date} – {request.end_date}</small>
                  <p><strong>Alasan:</strong> {request.reason}</p>
                  {request.review_reason && <p><strong>Alasan review:</strong> {request.review_reason}</p>}
                  {request.cancel_reason && <p><strong>Alasan pembatalan:</strong> {request.cancel_reason}</p>}
                  {request.attachment && (
                    <a className="text-button" href={recapAttachmentHref(request)} download>
                      <Download size={15} aria-hidden="true" />
                      Unduh {request.attachment.original_name}
                    </a>
                  )}
                  {request.history.length > 0 && (
                    <div className="daily-recap-audit">
                      <h4>Riwayat persetujuan</h4>
                      <ul>
                        {request.history.map((event, index) => (
                          <li key={index}>
                            {recapAbsenceLabel(event.to_status)} — {recapInstantLabel(event.created_at, request.office_timezone)}
                            {event.reason && <span> · {event.reason}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </section>
            {detail.summary.issues.length > 0 && (
              <p className="daily-recap-detail-warning" role="status">
                Ada {detail.summary.issues.length} anomali data. Periksa catatan absensi, pengajuan, dan riwayat pembatalan sebelum mengambil keputusan.
              </p>
            )}
            <small className="daily-recap-detail-privacy"><FileText size={14} aria-hidden="true" /> Detail khusus admin. Foto dan lampiran dimuat melalui endpoint privat.</small>
          </div>
        )}
      </section>
    </div>
  );
}
