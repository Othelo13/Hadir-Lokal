# P2.5 — API and concurrency testing

Seven new concurrency cases use independent Node processes, separate SQLite connections, a shared disposable WAL database and an IPC start barrier. The parent holds a write lock until both workers have signalled their attempt. Assertions verify committed rows, reservations, history, challenges, foreign keys and absence/attendance mutual exclusion. Either serial order is valid where appropriate. No fixed winning worker is assumed.

One end-to-end HTTP test starts the real local server on an available loopback port, logs in with synthetic accounts, submits a synthetic PDF, checks attachment access, and sends a generated JPEG containing a valid office QR. It exercises approved-absence blocking, cancellation, check-in/out, photo access, ordered attendance cancellation, and retake authorization. It does not use a physical camera or real employee data. Tests create temporary databases and remove them after completion.

Run npm run test:security, npm run build, type check, and check:local on the isolated test data. No production deployment or schema changes. Remaining release work includes manual camera/browser smoke tests, photo orphan reconciliation, malware scanning and retention policy for attachments, and production backup rehearsal.
