# Detail Rekap Anggota: history-style per-day attendance table

The member detail now shows a four-column per-date table: Tanggal, Waktu absen masuk, Waktu absen keluar, Status. This follows the existing compact Riwayat & ekspor typography, dividers and 11px cell scale, with horizontal scrolling inside the modal on narrow screens.

Admin-only member-recap returns strictly sanitized clock metadata {time,timezone} for each check-in/out, deriving timezone from the effective historical schedule. It does not return record IDs, photo storage keys, QR payloads, medical reasons or attachment data. The shared formatRecapTime helper renders the local clock and explicitly identifies UTC when history is unavailable; missing or future evidence displays —. Status is derived from the SAME historical daily classification already used for counts: late shows Terlambat, without changing its inclusion in Hadir. Pending still remains pending.

On rows with a daily detail, click or Enter/Space opens the authorized per-day modal. Non-interactive rows remain plain table rows. There is no extra action column. The main recap filters and backend absence rules remain unchanged. This is a feature-branch change only; no production deployment or database migration.


## Recorded dates only (follow-up evaluation)
The detail table lists only dates that have stored member data: attendance records (including pending/rejected), attendance-cancellation audit entries, or absence requests (including pending/rejected/cancelled). Roster-generated placeholders, automatic absences, uncovered history, and ordinary future calendar dates are omitted. The backend still evaluates all eligible dates for the numeric totals and keeps the historical absence logic unchanged. A saved future absence request may be shown as a future date without being counted as presence or absence. The existing detail endpoint may be unavailable for dates with requests but without historical daily roster/evidence, so such rows are noninteractive. An empty table displays an explicit no-records message. No database writes or migrations.
