# P2.2 — Absence API

Existing /api/app authentication, same-origin POST protection, no-store JSON and per-user rate limiting apply.

| Method | action | inputs |
| --- | --- | --- |
| GET | absence-list | page (1+), pageSize (10/20/50), optional status and type |
| GET | absence-detail | id |
| POST | absence-submit | type: leave/sick, startDate, endDate, reason |
| POST | absence-approve | id, optional reason |
| POST | absence-reject | id, required reason |
| POST | absence-cancel | id, reason required for admin |

POST JSON contains action; submit returns 201, other successes 200. List returns rows/page/pageSize/total/totalPages. Detail returns request/days/history. Employee scope comes exclusively from authenticated identity; no client-supplied user ID, role or status is trusted. List does not expose reasons; detail is owner/admin-only. No attachment content or storage key is returned.

Past, present and future dates may be submitted without a three-day lookback. The previous 31-calendar-day business restriction is removed. A technical maximum of 366 calendar days per request prevents unbounded per-day database writes. Longer spans can be split into separate requests. At least one scheduled working day must be included, and the end date may not precede the start date. Reason remains required (5–500 characters). One optional JPEG, PNG or PDF attachment of at most 5 MiB is supported; see docs/absence-attachments.md. Admin approval remains subject to current attendance and overlapping-request checks.

Safety prerequisite: P2.2 also wires the final attendance insert to BEGIN IMMEDIATE and checks approved absence while holding the write lock. The existing attendance endpoint checks earlier too. This prevents approval/attendance insert races via these API paths; broader attendance integration, independent-connection concurrency tests and attachment storage remain P2.3–P2.5. Do not deploy this incomplete feature to production.
