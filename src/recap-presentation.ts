import type { DailyRecapRow, RecapStatus, RecapContext } from './recap-types';

export function recapStatusLabel(status: RecapStatus): string {
  switch (status) {
    case 'present': return 'Hadir';
    case 'late': return 'Terlambat';
    case 'leave': return 'Izin';
    case 'sick': return 'Sakit';
    default: return '—';
  }
}

// Calendar-only dates must not shift with device timezone or locale.
export function formatRecapDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

// Never infer an unknown historic timezone from the device or current settings.
// Preserve the recorded time by displaying UTC explicitly when history is unavailable.
export function formatRecapTime(event: { time: string; timezone: string | null } | null): string {
  if (!event) return '—';
  const date = new Date(event.time);
  if (!Number.isFinite(date.valueOf())) return '—';
  try {
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: event.timezone ?? 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(date);
    return event.timezone === null ? clock + ' UTC' : clock;
  } catch {
    return '—';
  }
}

export function recapNote(row: DailyRecapRow): string {
  if (row.issues.length) return 'Perlu pemeriksaan';
  if (row.status === 'leave' || row.status === 'sick') return 'Disetujui';
  if (row.provisional) return 'Menunggu tinjauan';
  if (row.cancellationCount) return 'Ada riwayat pembatalan';
  return '—';
}

export function coverageMessage(context: RecapContext): string | null {
  if (context.coverage === 'unknown') return 'Riwayat anggota atau jadwal belum tersedia. Hanya bukti yang tersimpan ditampilkan.';
  if (context.coverage === 'partial') return 'Cakupan riwayat tanggal ini terbatas. Daftar anggota mungkin belum lengkap.';
  if (context.coverage === 'future') return 'Tanggal mendatang. Daftar anggota tidak diproyeksikan.';
  if (context.workday === false) return 'Bukan hari kerja berdasarkan jadwal historis. Bukti yang tersedia tetap ditampilkan.';
  return null;
}
