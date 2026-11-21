const DAY = 86_400_000;
function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}
export function parseCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('Tanggal tidak valid.');
  const timestamp = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    invalid('Tanggal tidak valid.');
  }
  return timestamp;
}
export function officeDate(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Historical, current and future days are eligible for submission.
 * maxRangeDays is a bounded technical safety guard, not an entitlement.
 */
export function effectiveAbsenceDays({ startDate, endDate, workDays, maxRangeDays }) {
  const start = parseCalendarDate(startDate);
  const end = parseCalendarDate(endDate);
  if (!Number.isSafeInteger(maxRangeDays) || maxRangeDays < 1 || maxRangeDays > 366) {
    throw new Error('Invalid absence policy configuration.');
  }
  if (!Array.isArray(workDays) || !workDays.length ||
      workDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error('Invalid work schedule configuration.');
  }
  if (start > end) invalid('Tanggal selesai harus sama atau setelah tanggal mulai.');
  if ((end - start) / DAY + 1 > maxRangeDays) invalid('Durasi pengajuan melebihi batas.');
  const result = [];
  for (let date = start; date <= end; date += DAY) {
    const day = new Date(date);
    if (workDays.includes(day.getUTCDay())) result.push(day.toISOString().slice(0, 10));
  }
  if (!result.length) invalid('Pengajuan harus mencakup hari kerja.');
  return result;
}

export function nextAbsenceStatus(status, action, { role, isOwner = false, active = false }) {
  if (!active || !['admin','employee'].includes(role)) {
    throw Object.assign(new Error('Akses tidak diizinkan.'), { status: 403 });
  }
  const admin = role === 'admin';
  if (action === 'approve' || action === 'reject') {
    if (!admin) throw Object.assign(new Error('Hanya admin yang dapat meninjau pengajuan.'), { status: 403 });
    if (status === 'pending') return action === 'approve' ? 'approved' : 'rejected';
  } else if (action === 'cancel') {
    if (!admin && (!isOwner || status === 'approved')) {
      throw Object.assign(new Error('Pembatalan tidak diizinkan.'), { status: 403 });
    }
    if (status === 'pending' || (admin && status === 'approved')) return 'cancelled';
  }
  throw Object.assign(new Error('Status pengajuan sudah berubah atau tindakan tidak valid.'), { status: 409 });
}
