# P1.1 — Absence schema foundation

Baseline: ae869b9. This increment is isolated on feature/absence-domain.

- Add five absence tables, indexes, foreign keys, and append-only history triggers.
- Explicit transaction-based migration; existing attendance, cancellations, members and photos are not rewritten.
- Date policy takes explicit lookback and duration configuration. Tests use proposed 3/31-day limits, not production defaults.
- Pure status transition helper checks roles and ownership; it is not a substitute for transactional API authorization.
- Migration is intentionally not wired into application startup in this increment. Tests execute it only on isolated in-memory SQLite databases.
- Next: transactional submission/review/cancellation services; member/schedule history from the migration date; attendance conflict checks, API authorization and storage integration. No production rollout until complete.
