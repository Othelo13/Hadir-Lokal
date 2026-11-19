# P2.1 — Startup migration integration

`server/storage.mjs` now initializes the baseline schema, applies migration 001, then 002 before HTTP startup. Both migrations are additive and have their own atomic transaction and migration marker. A failure aborts startup; a successfully committed earlier migration is not undone, and a restart resumes from its marker. There is no automatic down migration or destructive repair.

## Local testing
- Stop the old development server before switching branches.
- Back up the local data directory with the server stopped. Use a separate, private data directory outside the repository for the upgrade rehearsal (set absolute HADIR_DATA_DIR). Do not copy production credentials or data into a shared test environment.
- Run the tests, type check and build, then start the dev server. Verify both migration markers, the history baseline, existing attendance/photos and login. Restart and verify markers/baseline are unchanged.
- check:local checks existing attendance integrity and fingerprints, not every new absence-domain invariant. The additional tests use disposable on-disk databases and independent Node processes.
- Keep the original local database untouched. Do not deploy or run migrations on production until the entire release has been reviewed, backed up and rehearsed. Restoring from a consistent backup is an operator decision, not an automatic rollback.
- P2.2/P2.3/P2.4 are still pending: no new API or UI for absence requests, no attachment upload, no attendance integration.

The baseline captures membership and schedules only from migration time. Existing legacy attendance data remains unchanged; earlier membership is unknown.
