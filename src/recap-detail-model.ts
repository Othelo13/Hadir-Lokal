import { formatRecapTime, recapStatusLabel, recapNote } from './recap-presentation.ts';
import type { ActiveAttendance, CancelledAttendance, RecapAbsence, DailyRecapDetail } from './recap-types';

export function recapReviewLabel(review: string): string {
  switch (review) {
    case 'pending': return 'Menunggu tinjauan';
    case 'approved': return 'Disetujui';
    case 'rejected': return 'Ditolak';
    default: return 'Status review tidak dikenal';
  }
}

export function recapAbsenceLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Menunggu persetujuan';
    case 'approved': return 'Disetujui';
    case 'rejected': return 'Ditolak';
    case 'cancelled': return 'Dibatalkan';
    default: return 'Status pengajuan tidak dikenal';
  }
}

export function recapAttendanceKind(kind: string): string {
  if (kind === 'in') return 'Absen masuk';
  if (kind === 'out') return 'Absen pulang';
  return 'Jenis absensi tidak dikenal';
}

export function recapInstantLabel(instant: string | null, timezone: string | null): string {
  if (!instant) return '—';
  const date = new Date(instant);
  if (!Number.isFinite(date.valueOf())) return '—';
  try {
    const label = new Intl.DateTimeFormat('id-ID', {
      timeZone: timezone ?? 'UTC', year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(date);
    return timezone ? label + ' (' + timezone + ')' : label + ' UTC';
  } catch {
    return '—';
  }
}

// Build same-origin URL from immutable server IDs; never use storage keys.
export function recapPhotoHref(record: Pick<ActiveAttendance, 'id'>): string {
  return '/api/app?action=photo&id=' + encodeURIComponent(record.id);
}

export function recapAttachmentHref(request: Pick<RecapAbsence, 'id'>): string {
  return '/api/app?action=absence-attachment&id=' + encodeURIComponent(request.id);
}

export function recapDetailSummary(detail: DailyRecapDetail) {
  const row = detail.summary;
  return {
    name: row.name || row.email || 'Anggota tanpa nama',
    email: row.email || '—',
    date: detail.date,
    status: recapStatusLabel(row.status),
    note: recapNote(row),
    checkIn: formatRecapTime(row.checkIn),
    checkOut: formatRecapTime(row.checkOut),
  };
}

export function recapCancellationSummary(cancel: CancelledAttendance) {
  return {
    kind: recapAttendanceKind(cancel.kind),
    time: recapInstantLabel(cancel.time, cancel.timezone),
    reason: cancel.reason,
    cancelledBy: cancel.cancelled_by,
    cancelledAt: cancel.cancelled_at,
    retakeAuthorized: Boolean(cancel.retry_authorized_at),
  };
}
