CREATE TABLE IF NOT EXISTS members (
 email TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','employee')), active INTEGER NOT NULL DEFAULT 1,
 password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY,days TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,timezone TEXT NOT NULL,allow_late INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS codes (id TEXT PRIMARY KEY,label TEXT NOT NULL,active INTEGER NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,date TEXT NOT NULL,kind TEXT NOT NULL,time TEXT NOT NULL,status TEXT NOT NULL,photo TEXT NOT NULL,qr TEXT NOT NULL,review TEXT NOT NULL DEFAULT 'pending');
CREATE UNIQUE INDEX IF NOT EXISTS one_attendance ON records(user_id,date,kind);
-- Metadata penghapusan catatan absensi; foto dan catatan asli dihapus.
CREATE TABLE IF NOT EXISTS record_deletions (
 record_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 date TEXT NOT NULL,
 kind TEXT NOT NULL,
 deleted_by TEXT NOT NULL,
 deleted_at TEXT NOT NULL
);
-- Catatan yang dibatalkan tetap terlihat untuk audit, tanpa menyimpan foto selfie.
-- photo_cleanup_key hanya disimpan sementara sampai file fisik berhasil dibersihkan.
CREATE TABLE IF NOT EXISTS attendance_cancellations (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 email TEXT NOT NULL,
 name TEXT NOT NULL,
 date TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('in','out')),
 time TEXT NOT NULL,
 reason TEXT NOT NULL,
 cancelled_by TEXT NOT NULL,
 cancelled_at TEXT NOT NULL,
 retry_authorized_at TEXT,
 retry_authorized_by TEXT,
 photo_cleanup_key TEXT
);
CREATE INDEX IF NOT EXISTS cancellation_member_date
 ON attendance_cancellations(user_id,date,kind,cancelled_at DESC);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES members(user_id),expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
