export type RecapStatus = 'present' | 'late' | 'leave' | 'sick' | null;
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type AbsenceStatus = ReviewStatus | 'cancelled';
export type PageSize = 10 | 20 | 50;
export type Coverage = 'complete' | 'partial' | 'unknown' | 'future';

export interface RecapSchedule {
  days: number[];
  start: string;
  end: string;
  timezone: string;
  allowLate: boolean;
}
export interface RecapContext {
  date: string;
  coverageStart: string | null;
  coverage: Coverage;
  asOf: string | null;
  timezone: string | null;
  schedule: RecapSchedule | null;
  workday: boolean | null;
  rosterKnown: boolean;
  timezoneChanged: boolean;
}
export interface RecapEvent {
  id: string;
  time: string;
  review: 'pending' | 'approved';
  timezone: string | null;
}
export interface DailyRecapRow {
  userId: string;
  date: string;
  name: string | null;
  email: string | null;
  checkIn: RecapEvent | null;
  checkOut: RecapEvent | null;
  status: RecapStatus;
  absence: { id: string; type: 'leave' | 'sick' } | null;
  provisional: boolean;
  hasEvidence: boolean;
  issues: string[];
  cancellationCount: number;
  activeRecordCount: number;
  eligible: boolean | null;
  identitySource: 'history' | 'evidence';
}
export interface DailyRecapQuery {
  date?: string;
  q?: string;
  page?: number;
  pageSize?: PageSize;
}
export interface DailyRecapResponse {
  date: string;
  q: string;
  context: RecapContext;
  rows: DailyRecapRow[];
  page: number;
  pageSize: PageSize;
  total: number;
  totalPages: number;
}
interface AttendanceIdentity {
  id: string;
  user_id: string;
  name: string;
  email: string;
  date: string;
  kind: string;
  time: string;
  timezone: string | null;
}
export interface ActiveAttendance extends AttendanceIdentity {
  status: string;
  review: string;
  photoUrl: string;
}
export interface CancelledAttendance extends AttendanceIdentity {
  reason: string;
  cancelled_by: string;
  cancelled_at: string;
  retry_authorized_at: string | null;
  retry_authorized_by: string | null;
  photoUrl: null;
}
export interface AbsenceAudit {
  from_status: AbsenceStatus | null;
  to_status: AbsenceStatus;
  actor_user_id: string;
  reason: string | null;
  created_at: string;
}
export interface RecapAbsence {
  id: string;
  type: 'leave' | 'sick';
  start_date: string;
  end_date: string;
  reason: string;
  status: AbsenceStatus;
  office_timezone: string;
  created_at: string;
  updated_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  reserved: boolean;
  history: AbsenceAudit[];
  attachment: {
    original_name: string;
    mime_type: string;
    file_size: number;
    downloadUrl: string;
  } | null;
}
export interface DailyRecapDetail {
  date: string;
  userId: string;
  context: RecapContext;
  summary: DailyRecapRow;
  records: ActiveAttendance[];
  cancellations: CancelledAttendance[];
  absences: RecapAbsence[];
}
