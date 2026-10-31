// Authorization and the last-admin guard are evaluated in the same write.
export const SET_MEMBER_ROLE_SQL = `
UPDATE members SET role = ?
WHERE email = ? AND active = 1
  AND EXISTS (SELECT 1 FROM members AS actor WHERE actor.email = ? AND actor.role = 'admin' AND actor.active = 1)
  AND (role <> 'admin' OR ? = 'admin' OR (SELECT COUNT(*) FROM members WHERE role = 'admin' AND active = 1) > 1)
RETURNING email, role
`;

// Remove account access together; historical records and photos remain untouched.
export function deleteEmployee(sqlite, actorId, memberId) {
  function fail(message, status) {
    throw Object.assign(new Error(message), { status });
  }

  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const actor = sqlite
      .prepare("SELECT user_id FROM members WHERE user_id=? AND role='admin' AND active=1")
      .get(actorId);
    if (!actor) fail('Hanya admin yang dapat menghapus anggota.', 403);
    const member = sqlite.prepare('SELECT role FROM members WHERE user_id=?').get(memberId);
    if (!member) fail('Anggota tidak ditemukan. Muat ulang daftar anggota.', 404);
    if (member.role !== 'employee')
      fail('Akun admin tidak dapat dihapus. Ubah menjadi anggota terlebih dahulu.', 409);

    sqlite.prepare('DELETE FROM sessions WHERE user_id=?').run(memberId);
    sqlite.prepare('DELETE FROM challenges WHERE user_id=?').run(memberId);
    sqlite.prepare("DELETE FROM members WHERE user_id=? AND role='employee'").run(memberId);
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}
