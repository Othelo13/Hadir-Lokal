# P2.3 — Private absence attachment storage

One optional attachment per request. Submit JSON to POST /api/app?action=absence-submit, with action=absence-submit and attachment={name,mimeType,base64} (standard padded base64, no data URL). Omit attachment if none. Maximum binary size 5 MiB; only JPEG, PNG, PDF. The explicit query action enables a bounded 7.1 MB JSON request; all other routes retain the 2.6 MB cap. Both HTTP ingress and API enforce the limits.

Migration 003 adds absence_attachment_blobs. Metadata and BLOB are inserted in the same transaction as request, dates, reservations and audit; no filesystem paths or orphan files. Existing rows and markers remain unchanged. The private database grows with attachments and backups must be protected accordingly.

GET /api/app?action=absence-attachment&id=<request UUID> returns the binary only to active authenticated owner/admin. Uses forced download, fixed safe filename, no-store and nosniff; checks SHA-256 and size. Detail returns original_name/mime_type/file_size; list contains only has_attachment. No storage keys in responses. Files are retained after reject/cancel for audit; retention policy, storage budget and backup access must be reviewed before production.

Validation: extension/MIME match, canonical base64, bounded JPEG decode, PNG signature/chunk framing/dimension checks, PDF header and EOF checks. This is not full PNG/PDF parsing or antivirus scanning; files remain untrusted and are not rendered inline. No claim of malware-free content. Future production review should address malware scanning, ingress-wide limits and sensitive medical attachment retention. No public URLs or client filesystem paths.

Migration applies automatically on the isolated local test database on startup. Do not deploy this feature to production yet.
