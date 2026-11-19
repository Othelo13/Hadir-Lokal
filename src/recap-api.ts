import type { DailyRecapQuery, DailyRecapResponse, DailyRecapDetail } from './recap-types';

export class RecapApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RecapApiError';
    this.status = status;
  }
}

async function read<T>(params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/app?' + params.toString(), {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : 'Gagal memuat rekap absensi.';
    throw new RecapApiError(message, response.status);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new RecapApiError('Respons rekap tidak valid.', response.status);
  // The typed response contract is verified by the backend integration tests.
  return body as T;
}

export function getDailyRecap(query: DailyRecapQuery = {}, signal?: AbortSignal) {
  const params = new URLSearchParams({ action: 'daily-recap' });
  if (query.date !== undefined) params.set('date', query.date);
  if (query.q !== undefined) params.set('q', query.q.trim());
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  return read<DailyRecapResponse>(params, signal);
}

export function getDailyRecapDetail(date: string, userId: string, signal?: AbortSignal) {
  return read<DailyRecapDetail>(new URLSearchParams({
    action: 'daily-recap-detail', date, userId,
  }), signal);
}
