# Recap table UI simplification — remove review count

The member recap table and the member period detail total cards show only four attendance count categories: Hadir, Tidak hadir, Izin, and Sakit. The 'Perlu tinjauan' count is not shown as a fifth column/card. The underlying member-recap endpoint still computes pending/provisional days as unresolved, and day details can still show that a date is pending. It must not reinterpret pending selfie reviews, pending sickness/leave approvals or conflicting evidence as final approved absences or confirmed absence.

The existing admin review workflow, backend authorization, audit and conservative absence rules stay unchanged. Removing a UI column does not disable approval requirements. Desktop summary grid uses four columns; mobile breakpoints remain unchanged.

No database migration or production change. Verify locally and in CI before visual sign-off.
