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

Provisional development policy: 3-day lookback, 31-calendar-day range, 5–500 character reason. These are centralized server-side defaults pending final review. Attachment uploads are not supported yet; providing attachment is rejected rather than silently ignored.

Safety prerequisite: P2.2 also wires the final attendance insert to BEGIN IMMEDIATE and checks approved absence while holding the write lock. The existing attendance endpoint checks earlier too. This prevents approval/attendance insert races via these API paths; broader attendance integration, independent-connection concurrency tests and attachment storage remain P2.3–P2.5. Do not deploy this incomplete feature to production.
