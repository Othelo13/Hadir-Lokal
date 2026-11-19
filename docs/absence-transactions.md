# P1.2 — Transactional absence domain

Implemented in `server/absence-service.mjs`:
- Synchronous BEGIN IMMEDIATE for submission and transitions. Actor role/active state and request ownership are read within the transaction.
- Pending and approved reserve effective workdays; reject/cancel release reservations without removing the historical dates. Approval checks current employee eligibility and every effective date against active attendance (including rejected selfies).
- Status, reservation changes and append-only audit commit together. Failures roll back all writes.
- `assertAttendanceAllowed` is a guard intended for the future attendance transaction; it does not yet change the current attendance API.
- Proposed 3/31 day and 5–500 character limits are explicit test configuration, not configured production defaults.
- Still outstanding: P1.3 member/schedule period history; migration startup wiring; P2 authenticated API, attachment lifecycle, attendance insert integration and independent-connection concurrency tests. No changes to the live app or existing database.
