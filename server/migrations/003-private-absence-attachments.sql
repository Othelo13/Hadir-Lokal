-- Binary payloads remain inside the private SQLite database.
CREATE TABLE absence_attachment_blobs (
 attachment_id TEXT PRIMARY KEY NOT NULL REFERENCES absence_attachments(id) ON DELETE RESTRICT,
 content BLOB NOT NULL CHECK(typeof(content)='blob' AND length(content) BETWEEN 1 AND 5242880)
);
