import type { ActiveAttendance, CancelledAttendance, DailyRecapDetail } from './recap-types';

export type RecapReview = 'approved' | 'rejected';
export type RecapWriteAction =
  | { type: 'review'; id: string; review: RecapReview }
  | { type: 'cancel'; id: string; reason: string }
  | { type: 'retake'; id: string };

export class RecapActionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RecapActionError';
    this.status = status;
  }
}

export function validCancellationReason(reason: string) {
  const length = reason.trim().length;
  return length >= 5 && length <= 500;
}

export function canCancelRecapRecord(detail: DailyRecapDetail, record: ActiveAttendance): boolean {
  // Checkout is a prerequisite to cancelling check-in. The backend enforces
  // this again atomically, including races with a newly inserted checkout.
  return record.kind === 'out' ||
    (record.kind === 'in' && !detail.records.some((r) => r.kind === 'out'));
}

export function canAuthorizeRecapRetake(
  detail: DailyRecapDetail,
  cancel: CancelledAttendance,
  officeToday: string,
): boolean {
  if (!officeToday || detail.date !== officeToday || cancel.date !== officeToday) return false;
  if (!['in', 'out'].includes(cancel.kind) || cancel.retry_authorized_at) return false;
  if (detail.records.some((r) => r.kind === cancel.kind)) return false;
  if (detail.absences.some((r) => r.status === 'approved' && r.reserved)) return false;
  // The most recent cancellation of the same kind determines retake eligibility.
  return detail.cancellations.find((r) => r.kind === cancel.kind)?.id === cancel.id;
}

export function canReviewRecapRecord(record: ActiveAttendance, review: RecapReview): boolean {
  return (record.kind === 'in' || record.kind === 'out') && record.review !== review;
}

export async function submitRecapAction(action: RecapWriteAction): Promise<{ ok: true; warning?: string }> {
  if (!action.id || typeof action.id !== 'string') throw new RecapActionError('Catatan absensi tidak valid.', 400);
  if (action.type === 'cancel' && !validCancellationReason(action.reason))
    throw new RecapActionError('Alasan pembatalan harus berisi 5–500 karakter.', 400);
  const body = action.type === 'review'
    ? { action: 'review', id: action.id, review: action.review }
    : action.type === 'cancel'
      ? { action: 'cancel-attendance', id: action.id, reason: action.reason.trim() }
      : { action: 'authorize-retake', id: action.id };
  const response = await fetch('/api/app', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error : 'Tindakan gagal. Silakan coba kembali.';
    throw new RecapActionError(error, response.status);
  }
  if (!payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true)
    throw new RecapActionError('Respons tindakan tidak valid. Perbarui data sebelum mencoba lagi.', response.status);
  return {
    ok: true,
    ...('warning' in payload && typeof payload.warning === 'string' ? { warning: payload.warning } : {}),
  };
}
