# P3.1 — Daily evidence query engine

Daily recap is keyed by immutable user_id plus stored office calendar date. Evidence includes active attendance records (even rejected for detail), cancelled attendance metadata, and approved absence effective dates. No current roster is invented for historical dates. Historical eligibility and schedule are P3.2.

Status codes: present, late, leave, sick, or null (display dash; not a new attendance status). Only valid pending/approved check-in records count as presence; pending review is provisional. Checkout alone does not confer presence. Rejected or cancelled events do not contribute to clock times. Missing checkout does not change presence. Pending/rejected/cancelled absence does not contribute status. Approved absence uses effective dates and requires matching reservation. Conflicting approved absence and active attendance (even rejected) or missing reservation yields null plus issue codes rather than silently double-counting.

Evidence identity uses most recent event snapshot, stable user ID and deterministic ordering; historical roster identity precedence is P3.2. The query returns event IDs, UTC timestamps, review, safe absence ID/type and cancellation counts; no selfie paths, QR values, reasons, credentials or attachment keys. No pagination or arbitrary truncation at this layer. Caller should wrap combined reads in a snapshot transaction; P3.3 will expose admin-only filtering and pagination. P3.4 will expose authorized detail. No API route/UI/schema changes yet.

Run all tests on disposable fixtures; no production data changes.
