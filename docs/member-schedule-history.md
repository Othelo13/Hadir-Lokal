# P1.3 — Member and schedule history

Migration 002 requires migration 001. The migration takes an atomic baseline of current members and office settings, then SQLite triggers capture subsequent creates, changes and deletes in the same transaction as the source write.

- Stable user_id links membership events to existing attendance and absence records. Deleted accounts retain history; passwords and session tokens are never copied.
- Schedule snapshots capture workdays, start/end times, office timezone and late policy. Existing attendance dates and late classifications are not recalculated.
- History is append-only; no-op edits and password resets do not produce membership events.
- Coverage starts at the migration instant (UTC). Earlier membership and schedule information is unknown; do not manufacture join dates or historical absences. Existing records and cancellations remain evidence of attendance on their actual dates.
- Events retain millisecond timestamps and sequence IDs to resolve ties. Lookup helpers return a known/unknown distinction and null for absent/deleted state. P3 must define daily eligibility at local-day boundaries and use attendance/approved-absence evidence where present; exact intraday changes are retained, not retroactively applied to previous days.
- Absence effective dates remain submission snapshots. Historical schedule changes must not rewrite those days.
- Migration 002 and 001 are intentionally not wired into startup yet; test them in isolated databases. Startup integration, private attachment storage and two-way attendance conflict enforcement remain P2 work.
- No production data or existing legacy rows are modified by this increment.
