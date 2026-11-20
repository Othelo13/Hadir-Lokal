import { formatRecapTime, recapNote, recapStatusLabel } from './recap-presentation.ts';
import type { DailyRecapRow, DailyRecapResponse, RecapStatus } from './recap-types';

export interface DailyTableRow {
  userId: string;
  name: string;
  email: string;
  checkIn: string;
  checkOut: string;
  status: RecapStatus;
  statusLabel: string;
  note: string;
}

export function recapTableRow(row: DailyRecapRow): DailyTableRow {
  return {
    userId: row.userId,
    name: row.name || row.email || 'Anggota tanpa nama',
    email: row.email || '—',
    checkIn: formatRecapTime(row.checkIn),
    checkOut: formatRecapTime(row.checkOut),
    status: row.status,
    statusLabel: recapStatusLabel(row.status),
    note: recapNote(row),
  };
}

export function recapPageInfo(response: DailyRecapResponse) {
  const from = response.total === 0 ? 0 : (response.page - 1) * response.pageSize + 1;
  return {
    from,
    to: Math.min(response.page * response.pageSize, response.total),
    total: response.total,
    page: response.page,
    totalPages: response.totalPages,
  };
}
