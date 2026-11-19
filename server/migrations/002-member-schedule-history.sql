-- History begins at migration time, never at an invented historical join date.
CREATE TABLE IF NOT EXISTS member_history (
 event_id INTEGER PRIMARY KEY,
 user_id TEXT NOT NULL,
 name TEXT NOT NULL,
 email TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','employee')),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 event_type TEXT NOT NULL CHECK(event_type IN ('baseline','created','updated','deleted')),
 recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS member_history_lookup ON member_history(user_id,recorded_at,event_id);

CREATE TABLE IF NOT EXISTS schedule_history (
 event_id INTEGER PRIMARY KEY,
 config_id INTEGER NOT NULL,
 days TEXT NOT NULL,
 start TEXT NOT NULL,
 end TEXT NOT NULL,
 timezone TEXT NOT NULL,
 allow_late INTEGER NOT NULL CHECK(allow_late IN (0,1)),
 event_type TEXT NOT NULL CHECK(event_type IN ('baseline','created','updated','deleted')),
 recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS schedule_history_lookup ON schedule_history(config_id,recorded_at,event_id);

CREATE TRIGGER IF NOT EXISTS member_history_insert AFTER INSERT ON members
BEGIN
 INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
 VALUES(NEW.user_id,NEW.name,NEW.email,NEW.role,NEW.active,'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS member_history_update AFTER UPDATE OF name,email,role,active ON members
WHEN OLD.name IS NOT NEW.name OR OLD.email IS NOT NEW.email OR OLD.role IS NOT NEW.role OR OLD.active IS NOT NEW.active
BEGIN
 INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
 VALUES(NEW.user_id,NEW.name,NEW.email,NEW.role,NEW.active,'updated',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS member_history_delete AFTER DELETE ON members
BEGIN
 INSERT INTO member_history(user_id,name,email,role,active,event_type,recorded_at)
 VALUES(OLD.user_id,OLD.name,OLD.email,OLD.role,OLD.active,'deleted',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS member_identity_immutable BEFORE UPDATE OF user_id ON members
WHEN OLD.user_id IS NOT NEW.user_id
BEGIN SELECT RAISE(ABORT,'Member identity is immutable'); END;

CREATE TRIGGER IF NOT EXISTS schedule_history_insert AFTER INSERT ON config
WHEN NEW.id=1
BEGIN
 INSERT INTO schedule_history(config_id,days,start,end,timezone,allow_late,event_type,recorded_at)
 VALUES(NEW.id,NEW.days,NEW.start,NEW.end,NEW.timezone,NEW.allow_late,'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS schedule_history_update AFTER UPDATE OF days,start,end,timezone,allow_late ON config
WHEN NEW.id=1 AND (OLD.days IS NOT NEW.days OR OLD.start IS NOT NEW.start OR OLD.end IS NOT NEW.end OR OLD.timezone IS NOT NEW.timezone OR OLD.allow_late IS NOT NEW.allow_late)
BEGIN
 INSERT INTO schedule_history(config_id,days,start,end,timezone,allow_late,event_type,recorded_at)
 VALUES(NEW.id,NEW.days,NEW.start,NEW.end,NEW.timezone,NEW.allow_late,'updated',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS schedule_history_delete AFTER DELETE ON config
WHEN OLD.id=1
BEGIN
 INSERT INTO schedule_history(config_id,days,start,end,timezone,allow_late,event_type,recorded_at)
 VALUES(OLD.id,OLD.days,OLD.start,OLD.end,OLD.timezone,OLD.allow_late,'deleted',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS schedule_identity_immutable BEFORE UPDATE OF id ON config
WHEN OLD.id IS NOT NEW.id
BEGIN SELECT RAISE(ABORT,'Schedule identity is immutable'); END;

CREATE TRIGGER IF NOT EXISTS member_history_no_update BEFORE UPDATE ON member_history
BEGIN SELECT RAISE(ABORT,'Member history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS member_history_no_delete BEFORE DELETE ON member_history
BEGIN SELECT RAISE(ABORT,'Member history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS schedule_history_no_update BEFORE UPDATE ON schedule_history
BEGIN SELECT RAISE(ABORT,'Schedule history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS schedule_history_no_delete BEFORE DELETE ON schedule_history
BEGIN SELECT RAISE(ABORT,'Schedule history is append-only'); END;
