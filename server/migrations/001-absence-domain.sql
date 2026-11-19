-- Additive absence schema; no changes to existing attendance rows.
CREATE TABLE IF NOT EXISTS absence_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name_snapshot TEXT NOT NULL, email_snapshot TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('leave','sick')),
 start_date TEXT NOT NULL, end_date TEXT NOT NULL CHECK(end_date >= start_date),
 reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')),
 office_timezone TEXT NOT NULL, schedule_snapshot TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT,
 cancelled_by TEXT, cancelled_at TEXT, cancel_reason TEXT,
 UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS absence_request_days (
 request_id TEXT NOT NULL, date TEXT NOT NULL,
 PRIMARY KEY(request_id,date),
 FOREIGN KEY(request_id) REFERENCES absence_requests(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS absence_day_reservations (
 user_id TEXT NOT NULL, date TEXT NOT NULL, request_id TEXT NOT NULL,
 PRIMARY KEY(user_id,date),
 FOREIGN KEY(request_id,date) REFERENCES absence_request_days(request_id,date) ON DELETE RESTRICT,
 FOREIGN KEY(request_id,user_id) REFERENCES absence_requests(id,user_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS absence_attachments (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE REFERENCES absence_requests(id) ON DELETE RESTRICT,
 storage_key TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL,
 mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','application/pdf')),
 file_size INTEGER NOT NULL CHECK(file_size > 0),
 sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS absence_request_history (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES absence_requests(id) ON DELETE RESTRICT,
 from_status TEXT, to_status TEXT NOT NULL,
 actor_user_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL,
 CHECK (
 (from_status IS NULL AND to_status='pending') OR
 (from_status IS NOT NULL AND from_status='pending' AND to_status IN ('approved','rejected','cancelled')) OR
 (from_status IS NOT NULL AND from_status='approved' AND to_status='cancelled')
 )
);
CREATE TRIGGER IF NOT EXISTS absence_history_no_update
 BEFORE UPDATE ON absence_request_history BEGIN SELECT RAISE(ABORT,'Absence history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS absence_history_no_delete
 BEFORE DELETE ON absence_request_history BEGIN SELECT RAISE(ABORT,'Absence history is append-only'); END;
CREATE INDEX IF NOT EXISTS absence_requests_member_status ON absence_requests(user_id,status,start_date,end_date);
CREATE INDEX IF NOT EXISTS absence_requests_status_created ON absence_requests(status,created_at);
CREATE INDEX IF NOT EXISTS absence_request_days_date ON absence_request_days(date,request_id);
CREATE INDEX IF NOT EXISTS absence_request_history_request ON absence_request_history(request_id,created_at);
CREATE INDEX IF NOT EXISTS records_date_member_kind ON records(date,user_id,kind);
CREATE INDEX IF NOT EXISTS attendance_cancellations_date_member ON attendance_cancellations(date,user_id);
