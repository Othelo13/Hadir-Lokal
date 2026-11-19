# P3.3 — Daily recap API

GET /api/app?action=daily-recap is authenticated admin-only and read-only. Live session and role are checked again inside a single SQLite read transaction covering current office date, historical schedule, member roster, evidence, search and pagination. Cache-Control: no-store. Rate limit: 120 per active authenticated account per 5 minutes (existing in-memory limiter).

Parameters: date (YYYY-MM-DD, defaults to today's office date; supported years 1900–9998), q (optional literal name/email search, trimmed, Unicode NFKC, case-insensitive, max 100 characters, no controls), page (positive integer, max 1,000,000; default 1), pageSize (10/20/50; default 10). Duplicate and unknown parameters rejected. Out-of-range pages clamp to last page; empty result has page=1,totalPages=1.

Response: {date,q,context,rows,page,pageSize,total,totalPages}. Context and row fields follow historical-daily-recap.md. Filtering happens before pagination; total is the filtered row count, not the number of events. No legacy 2,000-record limit. No raw reasons, photos, QR values, attachment blobs/keys or credentials. No status filter or export endpoint yet. Display null status as dash, not an absence status; check-in/out timestamps retain UTC and historical timezone or null. Detail is P3.4, including authorized sensitive information. No new migration, no UI change.

The engine loads a selected day into memory before filtering and pagination; for very large rosters/schedule histories, profile performance before release. Tests include 2,051 synthetic evidence rows to verify no silent legacy truncation.
