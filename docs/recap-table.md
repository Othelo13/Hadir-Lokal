# P4.2 — Daily attendance table

Admin now has a dedicated Rekap absensi harian tab. The old Riwayat & ekspor tab remains available with current per-event photo review, cancellation and legacy Excel export; employee menus and attendance behavior remain intact. Admin overview CTA opens new recap.

The P4.2 table uses P4.1 GET API client for a full daily row per immutable userId, the server's office date, server-side pagination (10/20/50), safe generic notes and exact historical timezone or explicit UTC. It shows loading, empty, error/retry, refresh and coverage warnings. Use AbortController to discard stale requests after page change/unmount, clear sensitive rows during each reload, and key by current admin user ID. Date picker and search arrive in P4.3; row click/detail in P4.4, review/cancel/retake integration P4.5, responsive/browser validation P4.6, export replacement P6.

No new migrations, dependencies, server changes or production deployment. Five view-model tests.
