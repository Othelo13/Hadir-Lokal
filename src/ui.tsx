import PasswordInput from './PasswordInput';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  LayoutDashboard,
  LogOut,
  Plus,
  QrCode,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
  X,
  CalendarDays,
  ScanFace,
  Menu,
  Search,
} from 'lucide-react';
const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const reviews: any = { pending: 'Menunggu tinjauan', approved: 'Disetujui', rejected: 'Ditolak' };
async function api(action: string, body: any = {}) {
  const r = await fetch('/api/app', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  const d: any = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.error), { status: r.status });
  return d;
}
export default function Dashboard() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [tab, setTab] = useState('overview'),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [query, setQuery] = useState(''),
    [date, setDate] = useState(''),
    [cancelTarget, setCancelTarget] = useState<any>(null),
    [cancelReason, setCancelReason] = useState(''),
    [photo, setPhoto] = useState<any>(null),
    [qr, setQr] = useState<any>(null),
    [camera, setCamera] = useState(''),
    [shot, setShot] = useState(''),
    [cameraError, setCameraError] = useState(''),
    [challenge, setChallenge] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [ready, setReady] = useState(false),
    [resetMember, setResetMember] = useState<any>(null),
    [resetError, setResetError] = useState(''),
    [settingsFeedback, setSettingsFeedback] = useState<{ error: boolean; message: string } | null>(
      null,
    );
  useEffect(() => {
    if (!mobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobile(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobile]);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    cameraSession = useRef(0),
    activeIdentity = useRef<any>(null);
  function announceSession() {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('hadir-session');
      channel.postMessage({ type: 'changed' });
      channel.close();
    }
  }
  async function load() {
    try {
      const r = await fetch('/api/app', { cache: 'no-store' });
      const d: any = await r.json();
      if (r.status === 401 || d.login) {
        const hadIdentity = !!activeIdentity.current;
        activeIdentity.current = null;
        closeCamera();
        setPhoto(null);
        setQr(null);
        setData({ login: true });
        setTab('overview');
        setSettingsFeedback(null);
        if (hadIdentity)
          setNotice('Sesi masuk telah berakhir atau keluar pada tab lain. Silakan masuk kembali.');
        return;
      }
      if (!r.ok) throw new Error(d.error);
      const previous = activeIdentity.current;
      if (d.me) {
        activeIdentity.current = d.me;
        if (previous && (previous.user_id !== d.me.user_id || previous.role !== d.me.role)) {
          closeCamera();
          setPhoto(null);
          setQr(null);
          setMobile(false);
          setTab('overview');
          setSettingsFeedback(null);
          setNotice(
            `Akun aktif sekarang: ${d.me.name} (${d.me.role === 'admin' ? 'Admin' : 'Anggota magang'}). Tab dalam satu browser memakai sesi yang sama. Gunakan browser lain atau jendela samaran untuk akun berbeda.`,
          );
          window.scrollTo(0, 0);
        }
      }
      setData(d);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('hadir-session') : null;
    if (channel) channel.onmessage = () => load();
    return () => {
      window.removeEventListener('focus', onFocus);
      channel?.close();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  async function act(action: string, body: any = {}, message = 'Perubahan disimpan.') {
    setBusy(true);
    setNotice('');
    try {
      const d = await api(action, body);
      if (['login', 'setup', 'member-role', 'password-update', 'profile-update'].includes(action))
        announceSession();
      await load();
      setNotice(message);
      return d;
    } catch (e: any) {
      if (e.status === 401 || e.status === 403) {
        await load();
        setNotice(
          e.status === 403
            ? 'Akun aktif tidak memiliki hak admin untuk tindakan ini. Jika menggunakan admin dan anggota bersamaan, gunakan browser berbeda atau jendela samaran.'
            : e.message,
        );
        window.scrollTo(0, 0);
      } else setNotice(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (data?.me?.role === 'admin') {
      closeCamera();
      if (tab === 'attendance') setTab('overview');
    }
  }, [data?.me?.role, tab]);
  function closeCamera() {
    cameraSession.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera('');
    setShot('');
    setReady(false);
    setCameraError('');
    setConfirmed(false);
  }
  async function openCamera(kind: string) {
    if (data?.me?.role !== 'employee') return;
    const session = ++cameraSession.current;
    setCamera(kind);
    setShot('');
    setCameraError('');
    setReady(false);
    setConfirmed(false);
    try {
      const c = await api('challenge');
      setChallenge(c.id);
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Kamera membutuhkan browser modern dan koneksi HTTPS.');
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      if (session !== cameraSession.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
        setReady(true);
      }
    } catch (e: any) {
      setCameraError(
        e.name === 'NotAllowedError'
          ? 'Izin kamera ditolak. Izinkan kamera di pengaturan browser lalu coba lagi.'
          : e.message,
      );
    }
  }
  function capture() {
    if (!video.current?.videoWidth) return;
    const v = video.current,
      c = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    setShot(c.toDataURL('image/jpeg', 0.88));
    stream.current?.getTracks().forEach((t) => t.stop());
    setReady(false);
  }
  async function submit() {
    if (data?.me?.role !== 'employee') return;
    setBusy(true);
    setCameraError('');
    try {
      await api('attendance', { kind: camera, photo: shot, challenge });
      closeCamera();
      await load();
      setNotice('Absensi berhasil dicatat. Foto menunggu tinjauan admin.');
    } catch (e: any) {
      setCameraError(e.message);
      try {
        const c = await api('challenge');
        setChallenge(c.id);
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  async function showQr(code: any) {
    setBusy(true);
    try {
      const d = await api('qr-image', { id: code.id });
      setQr({ ...code, svg: d.svg });
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  function exportCsv() {
    const all = filtered;
    const escape = (s: any) =>
      '"' +
      String(s ?? '')
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const csv =
      '\ufeff' +
      [
        ['Nama', 'Email', 'Tanggal', 'Jenis', 'Jam', 'Status', 'Tinjauan'],
        ...all.map((r: any) => [
          r.name,
          r.email,
          r.date,
          r.kind === 'in' ? 'Masuk' : 'Pulang',
          fmtTime(r.time),
          r.cancelled ? 'Dibatalkan' : r.status === 'late' ? 'Terlambat' : 'Tepat waktu',
          r.cancelled ? 'Dibatalkan: ' + r.reason : reviews[r.review],
        ]),
      ]
        .map((row) => row.map(escape).join(';'))
        .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'laporan-absensi.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  function fmtTime(t: string) {
    return new Date(t).toLocaleTimeString('id-ID', {
      timeZone: data?.settings?.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (!data)
    return (
      <div className="welcome">
        <div className="brand">
          <span>h.</span>hadir
        </div>
        <h1>Memuat aplikasi…</h1>
        {error && (
          <>
            <p role="alert">{error}</p>
            <button className="button" onClick={load}>
              Coba lagi
            </button>
          </>
        )}
      </div>
    );
  if (data.login || data.setup)
    return (
      <div className="welcome">
        <div className="brand">
          <span>h.</span>hadir
        </div>
        <h1>{data.setup ? 'Buat akun admin pertama.' : 'Selamat datang kembali.'}</h1>
        <p>
          {data.setup
            ? 'Daftarkan akun admin untuk mulai mengelola absensi. Kamu menentukan email dan kata sandinya sendiri.'
            : 'Masuk menggunakan email dan kata sandi yang terdaftar.'}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (data.setup && f.get('password') !== f.get('confirm')) {
              setNotice('Konfirmasi kata sandi tidak sama.');
              return;
            }
            const d = await act(
              data.setup ? 'setup' : 'login',
              {
                email: f.get('email'),
                password: f.get('password'),
                name: f.get('name'),
                timezone: f.get('timezone'),
              },
              '',
            );
            if (d) {
              setNotice('');
              history.replaceState(null, '', '/');
            }
          }}
        >
          {data.setup && (
            <label>
              Nama lengkap
              <input name="name" required maxLength={80} autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input name="email" type="email" required autoComplete="username" />
          </label>
          <label>
            Kata sandi
            <PasswordInput
              name="password"
              minLength={8}
              maxLength={128}
              required
              autoComplete={data.setup ? 'new-password' : 'current-password'}
            />
          </label>
          {data.setup && (
            <>
              <label>
                Ulangi kata sandi
                <PasswordInput
                  name="confirm"
                  minLength={8}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                />
              </label>
              <label>
                Zona waktu kantor
                <select name="timezone" defaultValue="Asia/Singapore">
                  <option value="Asia/Jakarta">WIB (UTC+7)</option>
                  <option value="Asia/Makassar">WITA (UTC+8)</option>
                  <option value="Asia/Jayapura">WIT (UTC+9)</option>
                  <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                </select>
              </label>
            </>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? 'Memproses…' : data.setup ? 'Buat akun admin' : 'Masuk'}
            <ArrowUpRight size={18} />
          </button>
        </form>
        {notice && <p role="alert">{notice}</p>}
        <small>
          {data.setup
            ? 'Jadwal awal Senin–Sabtu, 09.00–17.00. Kata sandi minimal 8 karakter.'
            : 'Lupa kata sandi? Minta admin mengatur ulang melalui menu anggota.'}
        </small>
      </div>
    );
  const admin = data.me.role === 'admin',
    s = data.settings;
  const adminCount = data.members.filter((m: any) => m.role === 'admin' && m.active).length;
  const todayRows = data.records.filter((r: any) => r.date === data.today.date && !r.cancelled);
  const cancelledToday = data.records.filter(
    (r: any) => r.cancelled && r.user_id === data.me.user_id && r.date === data.today.date,
  );
  const own = todayRows.filter((r: any) => r.user_id === data.me.user_id),
    entered = own.find((r: any) => r.kind === 'in'),
    exited = own.find((r: any) => r.kind === 'out');
  const latestCancellation = (kind: 'in' | 'out') =>
    cancelledToday
      .filter((r: any) => r.kind === kind)
      .sort((a: any, b: any) => b.cancelled_at.localeCompare(a.cancelled_at))[0];
  const cancelledIn = latestCancellation('in');
  const cancelledOut = latestCancellation('out');
  const awaitingIn = !entered && !!cancelledIn && !cancelledIn.retry_authorized_at;
  const awaitingOut = !exited && !!cancelledOut && !cancelledOut.retry_authorized_at;
  const retakeInAllowed = !entered && !!cancelledIn && !!cancelledIn.retry_authorized_at;
  const retakeOutAllowed = !exited && !!cancelledOut && !!cancelledOut.retry_authorized_at;
  const employees = data.members.filter((m: any) => m.role === 'employee' && m.active);
  const present = new Set(
    todayRows
      .filter(
        (r: any) =>
          r.kind === 'in' &&
          r.review !== 'rejected' &&
          employees.some((m: any) => m.user_id === r.user_id),
      )
      .map((r: any) => r.user_id),
  ).size;
  const late = todayRows.filter(
    (r: any) =>
      r.kind === 'in' &&
      r.status === 'late' &&
      r.review !== 'rejected' &&
      employees.some((m: any) => m.user_id === r.user_id),
  ).length;
  const filtered = data.records.filter(
    (r: any) =>
      (!date || r.date === date) &&
      `${r.name} ${r.email}`.toLowerCase().includes(query.toLowerCase()),
  );
  const nav: any[] = [
    ['overview', 'Ringkasan', LayoutDashboard],
    ...(!admin ? [['attendance', 'Absensi saya', ScanFace]] : []),
    ['history', admin ? 'Rekap absensi' : 'Riwayat absensi', CalendarDays],
    ['account', 'Akun saya', ShieldCheck],
    ...(admin
      ? [
          ['members', 'Anggota magang', Users],
          ['qr', 'QR kantor', QrCode],
          ['settings', 'Pengaturan', Settings2],
        ]
      : []),
  ];
  const titles: any = {
    overview: 'Ringkasan',
    attendance: 'Absensi saya',
    history: admin ? 'Rekap absensi' : 'Riwayat absensi',
    members: 'Anggota magang',
    qr: 'QR kantor',
    settings: 'Pengaturan',
    account: 'Akun saya',
  };
  const todayLabel = new Date(data.today.date + 'T12:00:00').toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  async function cancelAttendance() {
    if (!cancelTarget || cancelReason.trim().length < 5) return;
    const result = await act('cancel-attendance',
      { id: cancelTarget.id, reason: cancelReason.trim() },
      'Absensi dibatalkan dan foto selfie dihapus.');
    if (result?.warning) setNotice(result.warning);
    if (result) { setCancelTarget(null); setCancelReason(''); setPhoto(null); }
  }
  async function authorizeRetake(record: any) {
    if (!confirm(`Izinkan ${record.name} melakukan absen ulang pada ${record.date}?`)) return;
    await act('authorize-retake', { id: record.id }, 'Izin absensi ulang diberikan.');
  }
  function retakeAction(record: any) {
    const sameAttendance = (r: any) =>
      r.user_id === record.user_id && r.date === record.date && r.kind === record.kind;
    if (data.records.some((r: any) => !r.cancelled && sameAttendance(r)))
      return <span className="badge green">Absensi ulang tercatat</span>;
    if (record.retry_authorized_at)
      return <span className="badge green">Izin ulang diberikan</span>;
    if (record.date !== data.today.date)
      return <span className="badge">Tanggal sudah lewat</span>;
    if (
      data.records.some(
        (r: any) => r.cancelled && sameAttendance(r) && r.cancelled_at > record.cancelled_at,
      )
    )
      return <span className="badge">Pembatalan sebelumnya</span>;
    return (
      <button type="button" className="text-button" disabled={busy}
        onClick={() => authorizeRetake(record)}>
        Izinkan absen ulang
      </button>
    );
  }
  const table = (rows: any[]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ANGGOTA</th>
            <th>TANGGAL</th>
            <th>ABSENSI</th>
            <th>WAKTU</th>
            <th>STATUS</th>
            <th>BUKTI SELFIE</th>
            {admin && <th>TINDAKAN</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <div className="person">
                  <span className="avatar">{r.name.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <strong>{r.name}</strong>
                    <small>{r.email}</small>
                  </div>
                </div>
              </td>
              <td>{r.date.split('-').reverse().join('/')}</td>
              <td>
                <span className={'kind ' + r.kind}>{r.kind === 'in' ? '↘ Masuk' : '↗ Pulang'}</span>
              </td>
              <td className="time">{fmtTime(r.time)}</td>
              <td>
                <span className={'badge ' + (r.cancelled ? 'danger' : r.status === 'late' ? 'amber' : 'green')}>
                  {r.cancelled ? 'Dibatalkan' : r.status === 'late' ? 'Terlambat' : 'Tepat waktu'}
                </span>
              </td>
              <td>
                {r.cancelled ? (
                  <span><span className="badge danger">Foto dihapus</span>
                    <small>Alasan: {r.reason}</small>
                  </span>
                ) : (
                  <button className="text-button" onClick={() => setPhoto(r)}>
                    <Camera size={15} /> {reviews[r.review]}
                  </button>
                )}
              </td>
              {admin && (
                <td>
                  {r.cancelled ? (
                    retakeAction(r)
                  ) : (
                    <button className="text-button danger" disabled={busy}
                      aria-label={`Batalkan absensi ${r.name} tanggal ${r.date}`}
                      onClick={() => { setCancelTarget(r); setCancelReason(''); }}>
                      <X size={15} /> Batalkan
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="empty">
          <CalendarDays size={30} />
          <h3>Belum ada catatan absensi</h3>
          <p>Absensi yang berhasil dikirim akan muncul di sini.</p>
        </div>
      )}
    </div>
  );
  return (
    <div className="app">
      {mobile && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Tutup menu navigasi"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={mobile ? 'sidebar show' : 'sidebar'} id="sidebar-navigation">
        <a className="brand" href="/" aria-label="Hadir beranda">
          <span>h.</span>hadir<span className="brand-dot">®</span>
        </a>
        <button
          type="button"
          className="sidebar-close"
          aria-label="Tutup menu"
          onClick={() => setMobile(false)}
        >
          <X size={20} />
        </button>
        <nav>
          {nav.map(([id, label, Icon]: any) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              onClick={() => {
                setTab(id);
                setMobile(false);
              }}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="profile">
          <div className="profile-user">
            <span className="avatar">{data.me.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{data.me.name}</strong>
              <small>{admin ? 'Administrator' : 'Karyawan magang'}</small>
            </div>
          </div>
          <button
            className="logout-button"
            aria-label="Keluar"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api('logout');
                announceSession();
                activeIdentity.current = null;
                closeCamera();
                setPhoto(null);
                setQr(null);
                setMobile(false);
                setData({ login: true });
                setTab('overview');
                setNotice('');
              } catch (error: any) {
                setNotice(error.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <LogOut size={17} />
            <span>Keluar</span>
          </button>
        </div>
      </aside>
      <main>
        <div className="content">
          <button
            type="button"
            className="icon-button mobile-menu"
            aria-label={mobile ? 'Tutup menu' : 'Buka menu'}
            aria-expanded={mobile}
            aria-controls="sidebar-navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <div className="page-heading">
            <div>
              <h1>
                {tab === 'overview'
                  ? `Selamat datang, ${data.me.name.split(' ')[0]}.`
                  : titles[tab]}
              </h1>
              <p>
                {tab === 'overview'
                  ? 'Hari yang baik dimulai dengan hadir. Pantau kehadiran tim di sini.'
                  : tab === 'attendance'
                    ? 'Ambil selfie bersama QR kantor untuk mencatat kehadiranmu.'
                    : tab === 'qr'
                      ? 'Buat, cetak, dan kelola QR yang ditempel di kantor.'
                      : tab === 'members'
                        ? 'Kelola akses karyawan magang dalam satu tempat.'
                        : tab === 'settings'
                          ? 'Atur jadwal kerja yang sesuai dengan kebutuhan tim.'
                          : tab === 'account'
                            ? 'Kelola nama, email login, dan kata sandi akunmu.'
                            : 'Lihat catatan kehadiran dan periksa bukti selfie.'}
              </p>
            </div>
            <div className="date-chip">
              <CalendarDays size={16} />
              {todayLabel}
            </div>
          </div>
          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button aria-label="Tutup pemberitahuan" onClick={() => setNotice('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          {tab === 'overview' && (
            <>
              <div className="hero">
                <div>
                  <div className="hero-label">
                    <span /> KEHADIRAN HARI INI
                  </div>
                  <h2>
                    {admin ? (
                      <>
                        Pantau kehadiran.
                        <br />
                        <em>Kelola tim magang.</em>
                      </>
                    ) : (
                      <>
                        Hadir dengan bukti.
                        <br />
                        <em>Mulai dengan selfie.</em>
                      </>
                    )}
                  </h2>
                  <p>
                    {admin ? (
                      <>
                        Lihat rekap kehadiran anggota magang.
                        <br />
                        Periksa bukti selfie dan status absensi.
                      </>
                    ) : (
                      <>
                        Wajah dan QR kantor dalam satu foto.
                        <br />
                        Cepat dicatat, mudah ditinjau.
                      </>
                    )}
                  </p>
                  <button
                    className="button cream"
                    onClick={() => setTab(admin ? 'history' : 'attendance')}
                  >
                    {admin ? 'Buka rekap absensi' : 'Buka absensi saya'} <ArrowUpRight size={18} />
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="scan-corner tl" />
                  <div className="scan-corner tr" />
                  <div className="scan-corner bl" />
                  <div className="scan-corner br" />
                  <div className="portrait">
                    <div className="head" />
                    <div className="torso" />
                  </div>
                  <div className="art-qr">
                    <QrCode size={92} strokeWidth={1.5} />
                  </div>
                  <div className="art-pill">
                    <CheckCircle2 size={16} /> {admin ? 'Pantau kehadiran tim' : 'Siap untuk hadir'}
                  </div>
                </div>
              </div>
              <div className="stats">
                {(admin
                  ? [
                      [Users, 'Anggota aktif', employees.length, 'Karyawan magang'],
                      [CheckCircle2, 'Sudah hadir', present, 'Absen masuk hari ini'],
                      [Clock3, 'Terlambat', late, `Batas masuk ${s.start}`],
                      [
                        CalendarDays,
                        'Belum hadir',
                        Math.max(0, employees.length - present),
                        'Belum absen masuk',
                      ],
                    ]
                  : [
                      [
                        CheckCircle2,
                        'Absen masuk',
                        entered ? fmtTime(entered.time) : '—',
                        entered ? 'Sudah tercatat' : 'Belum absen',
                      ],
                      [
                        Clock3,
                        'Absen pulang',
                        exited ? fmtTime(exited.time) : '—',
                        exited ? 'Sudah tercatat' : `Mulai ${s.end}`,
                      ],
                      [CalendarDays, 'Hari kerja', s.days.length, 'Hari setiap minggu'],
                      [Camera, 'Catatan saya', data.records.filter((r: any) => !r.cancelled).length, 'Total absensi aktif'],
                    ]
                ).map(([Icon, label, value, desc]: any, i) => (
                  <div className="stat" key={label}>
                    <div className="stat-top">
                      <span>{label}</span>
                      <Icon size={18} />
                    </div>
                    <div className="stat-number">
                      {value}
                      <span className={'stat-marker m' + i} />
                    </div>
                    <small>{desc}</small>
                  </div>
                ))}
              </div>
              <div className="section-heading">
                <div>
                  <h2>Aktivitas terbaru</h2>
                  <p>Catatan kehadiran yang baru masuk.</p>
                </div>
                <button className="text-button" onClick={() => setTab('history')}>
                  Lihat semua <ArrowUpRight size={16} />
                </button>
              </div>
              <section className="panel">{table(data.records.slice(0, 5))}</section>
              <div className="schedule-strip">
                <Clock3 size={20} />
                <div>
                  <strong>Jadwal kerja tim</strong>
                  <span>
                    {s.days.map((d: number) => days[d]).join(', ')} · {s.start}–{s.end} ·{' '}
                    {s.timezone}
                  </span>
                </div>
                {admin && (
                  <button className="text-button" onClick={() => setTab('settings')}>
                    Atur jadwal <ChevronRight size={16} />
                  </button>
                )}
              </div>
            </>
          )}
          {!admin && tab === 'overview' && (awaitingIn || awaitingOut || retakeInAllowed || retakeOutAllowed) && (
            <div className="notice" role="status">
              <div>
                {awaitingIn || awaitingOut ? (
                  <>
                    <strong>Absensi hari ini dibatalkan oleh admin.</strong>
                    <p>Periksa alasannya pada Riwayat absensi. Menunggu izin admin untuk
                      mengulang absen {awaitingIn && awaitingOut ? 'masuk dan pulang' : awaitingIn ? 'masuk' : 'pulang'}.</p>
                  </>
                ) : (
                  <>
                    <strong>Izin absensi ulang sudah diberikan.</strong>
                    <p>Silakan buka Absensi saya untuk mengulang absensi sesuai jadwal.
                      Riwayat pembatalan sebelumnya tetap tersimpan.</p>
                  </>
                )}
              </div>
            </div>
          )}
          {!admin && tab === 'attendance' && (
            <div className="two-columns">
              <section className="panel padded">
                <span className="section-kicker">CATAT KEHADIRANMU</span>
                <h2>Siapkan senyum dan QR.</h2>
                <p>
                  Gunakan kamera perangkatmu. Wajah dan QR yang ditempel di kantor harus terlihat
                  dalam satu foto.
                </p>
                <div className="attendance-row">
                  <span className="round-icon">
                    <ArrowUpRight />
                  </span>
                  <div>
                    <strong>Absen masuk</strong>
                    <small>
                      {entered
                        ? `Tercatat ${fmtTime(entered.time)}`
                         : awaitingIn
                           ? 'Menunggu izin absen ulang dari admin'
                           : retakeInAllowed
                             ? 'Izin ulang diberikan · siap mengambil selfie'
                             : `Batas masuk pukul ${s.start}`}
                    </small>
                  </div>
                  <button
                    disabled={
                      busy ||
                      !!entered ||
                      awaitingIn ||
                      !s.days.includes(data.today.day) ||
                      (!s.allow_late && data.today.clock > s.start)
                    }
                    className="button primary"
                    onClick={() => openCamera('in')}
                  >
                    {entered ? (
                      <>
                        <Check size={16} /> Tercatat
                      </>
                    ) : (
                      <>
                        <Camera size={16} /> Selfie masuk
                      </>
                    )}
                  </button>
                </div>
                <div className="attendance-row">
                  <span className="round-icon">
                    <LogOut />
                  </span>
                  <div>
                    <strong>Absen pulang</strong>
                    <small>
                      {exited
                         ? `Tercatat ${fmtTime(exited.time)}`
                         : awaitingOut
                           ? 'Menunggu izin absen ulang dari admin'
                           : retakeOutAllowed
                             ? 'Izin ulang diberikan · siap mengambil selfie'
                             : `Dibuka pukul ${s.end}`}
                    </small>
                  </div>
                  <button
                    disabled={
                      busy ||
                      !!exited ||
                      awaitingOut ||
                      !entered ||
                      data.today.clock < s.end ||
                      !s.days.includes(data.today.day)
                    }
                    className="button"
                    onClick={() => openCamera('out')}
                  >
                    {exited ? (
                      <>
                        <Check size={16} /> Tercatat
                      </>
                    ) : (
                      <>
                        <Camera size={16} /> Selfie pulang
                      </>
                    )}
                  </button>
                </div>
                {!s.days.includes(data.today.day) && (
                  <div className="notice">Hari ini bukan hari kerja.</div>
                )}
                {!entered && !s.allow_late && data.today.clock > s.start && (
                  <div className="notice">
                    Absen masuk sudah ditutup pukul {s.start}. Hubungi admin.
                  </div>
                )}
                <small>
                  Waktu kantor: {data.today.clock} · {s.timezone}.{' '}
                  <button className="text-button" onClick={load}>
                    Perbarui waktu
                  </button>
                </small>
              </section>
              <section className="panel padded instructions">
                <ScanFace size={38} />
                <h3>Agar foto mudah diperiksa</h3>
                <ol>
                  <li>Berdiri di samping QR cetak yang aktif.</li>
                  <li>Pastikan wajah terlihat jelas dan tidak tertutup.</li>
                  <li>Posisikan QR cukup dekat, terang, dan tidak terpotong.</li>
                  <li>Periksa hasil foto, lalu kirim absensi.</li>
                </ol>
                <p>
                  QR diperiksa otomatis. Admin meninjau wajah dari foto.{' '}
                  {s.allow_late
                    ? 'Masuk setelah ' + s.start + ' ditandai terlambat.'
                    : 'Absen masuk ditutup setelah ' + s.start + '.'}
                </p>
              </section>
            </div>
          )}
          {tab === 'history' && (
            <>
              <section className="panel">
                <div className="toolbar">
                  <div className="search">
                    <Search size={17} />
                    <input
                      aria-label="Cari nama atau email"
                      placeholder="Cari nama atau email…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <label className="inline-label">
                    <input
                      type="date"
                      aria-label="Filter tanggal"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <button
                    className="button"
                    onClick={() => {
                      setDate('');
                      setQuery('');
                    }}
                  >
                    Reset
                  </button>
                  <button className="button primary" onClick={exportCsv}>
                    <Download size={16} /> Ekspor CSV
                  </button>
                </div>
                {table(filtered)}
                <div className="table-footer">
                  {filtered.length} catatan ditampilkan · CSV dapat dibuka di Excel. Maksimal{' '}
                  {admin ? '2.000' : '1.000'} catatan terbaru.
                </div>
              </section>
            </>
          )}
          {admin && tab === 'members' && (
            <div className="two-columns">
              <section className="panel">
                <div className="panel-title">
                  <h2>Daftar anggota</h2>
                  <span className="badge green">
                    {adminCount} admin · {employees.length} magang aktif
                  </span>
                </div>
                {data.members.map((m: any) => (
                  <div className="member-row" key={m.email}>
                    <div className="person">
                      <span className="avatar">{m.name.slice(0, 2).toUpperCase()}</span>
                      <div>
                        <strong>{m.name}</strong>
                        <small>{m.email}</small>
                      </div>
                    </div>
                    <div className="member-controls">
                      <span className={'badge ' + (m.role === 'admin' ? 'green' : '')}>
                        {m.role === 'admin' ? 'Admin' : m.active ? 'Anggota' : 'Nonaktif'}
                      </span>
                      {!!m.active && (
                        <button
                          className="text-button"
                          disabled={busy || (m.role === 'admin' && adminCount <= 1)}
                          title={
                            m.role === 'admin' && adminCount <= 1
                              ? 'Minimal satu admin aktif harus tetap ada.'
                              : undefined
                          }
                          onClick={async () => {
                            const role = m.role === 'admin' ? 'employee' : 'admin';
                            const message =
                              role === 'admin'
                                ? `Jadikan ${m.name} sebagai admin? Admin dapat mengelola anggota, QR, jadwal, dan melihat seluruh foto absensi.`
                                : `Ubah ${m.name} menjadi anggota biasa? Hak pengelolaan aplikasi akan dicabut.`;
                            if (!confirm(message)) return;
                            const result = await act(
                              'member-role',
                              { email: m.email, role },
                              role === 'admin'
                                ? 'Admin baru berhasil ditambahkan.'
                                : 'Peran berhasil diubah menjadi anggota.',
                            );
                            if (result && m.email === data.me.email && role === 'employee')
                              setTab('overview');
                          }}
                        >
                          {m.role === 'admin' ? 'Ubah ke anggota' : 'Jadikan admin'}
                        </button>
                      )}
                      <button
                        disabled={busy}
                        className="text-button"
                        onClick={() => {
                          setResetError('');
                          setNotice('');
                          if (m.email === data.me.email) setTab('account');
                          else setResetMember(m);
                        }}
                      >
                        Atur kata sandi
                      </button>
                      {m.role !== 'admin' && (
                        <button
                          disabled={busy}
                          className="text-button danger"
                          onClick={() => {
                            if (
                              confirm(
                                `Hapus anggota ${m.name} (${m.email})? Akun akan dihapus dan tidak dapat masuk lagi. Riwayat absensi dan foto tetap tersimpan. Tindakan ini tidak dapat dibatalkan.`,
                              )
                            ) {
                              act(
                                'delete-member',
                                { id: m.user_id },
                                'Anggota berhasil dihapus. Riwayat absensi dan foto tetap tersimpan.',
                              );
                            }
                          }}
                        >
                          Hapus anggota
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </section>
              <section className="panel padded">
                <div className="admin-policy">
                  <ShieldCheck size={19} />
                  <div>
                    <strong>Minimal satu admin aktif</strong>
                    <p>
                      Hanya admin yang dapat mengangkat admin lain. Daftarkan anggota, lalu pilih
                      “Jadikan admin”. Admin terakhir tidak dapat diubah menjadi anggota.
                    </p>
                  </div>
                </div>
                <span className="section-kicker">ANGGOTA BARU</span>
                <h2>Tambahkan karyawan magang</h2>
                <p>
                  Buat akun dengan email dan kata sandi untuk anggota. Anggota dapat masuk dari
                  browser pada komputer ini dan melihat absensinya sendiri.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      f = new FormData(form);
                    const d = await act(
                      'member',
                      { name: f.get('name'), email: f.get('email'), password: f.get('password') },
                      'Anggota berhasil didaftarkan.',
                    );
                    if (d) form.reset();
                  }}
                >
                  <label>
                    Nama lengkap
                    <input name="name" maxLength={80} required placeholder="Nama karyawan magang" />
                  </label>
                  <label>
                    Email akun
                    <input name="email" type="email" required placeholder="nama@contoh.com" />
                  </label>
                  <label>
                    Kata sandi awal
                    <PasswordInput
                      name="password"
                      required
                      minLength={8}
                      maxLength={128}
                      autoComplete="new-password"
                    />
                  </label>
                  <button disabled={busy} className="button primary">
                    <Plus size={17} /> Tambahkan anggota
                  </button>
                </form>
              </section>
            </div>
          )}
          {admin && tab === 'qr' && (
            <>
              <div className="two-columns">
                <section className="panel padded">
                  <span className="section-kicker">QR UNTUK KANTOR</span>
                  <h2>Satu QR, untuk satu lokasi.</h2>
                  <p>
                    Hanya admin yang dapat membuat dan mencetak QR. Tempelkan pada tempat terang
                    agar mudah terlihat dalam selfie.
                  </p>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      await act(
                        'create-qr',
                        { label: f.get('label') },
                        'QR baru berhasil dibuat. Buka QR untuk mencetaknya.',
                      );
                    }}
                  >
                    <label>
                      Nama lokasi
                      <input
                        name="label"
                        required
                        maxLength={80}
                        placeholder="Contoh: Kantor utama"
                      />
                    </label>
                    <button disabled={busy} className="button primary">
                      <Plus size={17} /> Buat QR baru
                    </button>
                  </form>
                  <div className="hint">
                    Menghapus QR akan menghilangkannya dari daftar. Cetakan lama tidak dapat
                    digunakan lagi; catatan absensi sebelumnya tetap tersimpan.
                  </div>
                </section>
                <div className="qr-list">
                  {data.codes.length ? (
                    data.codes.map((c: any) => (
                      <section className="panel qr-card" key={c.id}>
                        <QrCode size={48} />
                        <div>
                          <h3>{c.label}</h3>
                          <span className="badge green">Aktif</span>
                          <small>Dibuat {new Date(c.created).toLocaleDateString('id-ID')}</small>
                        </div>
                        {!!c.active && (
                          <div className="qr-actions">
                            <button disabled={busy} className="button" onClick={() => showQr(c)}>
                              Lihat & cetak <ArrowUpRight size={15} />
                            </button>
                            <button
                              disabled={busy}
                              className="text-button danger"
                              onClick={() => {
                                if (
                                  confirm(
                                    'Hapus QR ini? QR akan dihapus dari daftar dan cetakannya tidak bisa digunakan lagi. Catatan absensi lama tetap tersimpan.',
                                  )
                                )
                                  act('delete-qr', { id: c.id }, 'QR berhasil dihapus.');
                              }}
                            >
                              Hapus QR
                            </button>
                          </div>
                        )}
                      </section>
                    ))
                  ) : (
                    <section className="panel empty">
                      <QrCode size={40} />
                      <h3>Belum ada QR kantor</h3>
                      <p>Buat QR pertama untuk memulai absensi.</p>
                    </section>
                  )}
                </div>
              </div>
            </>
          )}
          {admin && tab === 'settings' && (
            <section className="panel padded settings-panel">
              <span className="section-kicker">ATURAN KEHADIRAN</span>
              <h2>Jadwal kerja tim</h2>
              <p>
                Perubahan berlaku untuk absensi berikutnya. Catatan lama tetap menggunakan status
                saat dicatat.
              </p>
              <form
                key={JSON.stringify(s)}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  setSettingsFeedback(null);
                  try {
                    await api('settings', {
                      days: f.getAll('days').map(Number),
                      start: f.get('start'),
                      end: f.get('end'),
                      timezone: f.get('timezone'),
                      allow_late: f.has('allow_late'),
                    });
                    await load();
                    setSettingsFeedback({ error: false, message: 'Pengaturan berhasil disimpan.' });
                  } catch (error: any) {
                    if (error.status === 401 || error.status === 403) {
                      await load();
                      setNotice(
                        'Penyimpanan ditolak karena akun aktif bukan admin atau sesi telah berakhir. Gunakan browser berbeda atau jendela samaran untuk akun anggota.',
                      );
                      window.scrollTo(0, 0);
                    } else setSettingsFeedback({ error: true, message: error.message });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>Hari kerja</label>
                <div className="day-picker">
                  {days.map((d, i) => (
                    <label key={d}>
                      <input
                        type="checkbox"
                        name="days"
                        value={i}
                        defaultChecked={s.days.includes(i)}
                      />
                      <span>{d}</span>
                    </label>
                  ))}
                </div>
                <div className="form-grid">
                  <label>
                    Batas jam masuk
                    <input type="time" required name="start" defaultValue={s.start} />
                  </label>
                  <label>
                    Jam pulang
                    <input type="time" required name="end" defaultValue={s.end} />
                  </label>
                </div>
                <label>
                  Zona waktu kantor
                  <select name="timezone" defaultValue={s.timezone}>
                    <option value="Asia/Jakarta">WIB · Asia/Jakarta (UTC+7)</option>
                    <option value="Asia/Makassar">WITA · Asia/Makassar (UTC+8)</option>
                    <option value="Asia/Jayapura">WIT · Asia/Jayapura (UTC+9)</option>
                    <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                  </select>
                </label>
                <label className="check-label">
                  <input type="checkbox" name="allow_late" defaultChecked={!!s.allow_late} />
                  Izinkan absen setelah batas masuk dan tandai sebagai terlambat.
                </label>
                <div className="hint">
                  Jika opsi ini dimatikan, absen masuk ditutup setelah batas jam. Absen pulang
                  tersedia mulai jam pulang yang ditentukan.
                </div>
                <button type="submit" disabled={busy} className="button primary">
                  <Check size={17} />
                  {busy ? 'Menyimpan…' : 'Simpan pengaturan'}
                </button>
                {settingsFeedback && (
                  <div
                    className={
                      'notice settings-feedback' + (settingsFeedback.error ? ' settings-error' : '')
                    }
                    role={settingsFeedback.error ? 'alert' : 'status'}
                  >
                    {settingsFeedback.message}
                  </div>
                )}
              </form>
            </section>
          )}
          {tab === 'account' && (
            <div className="account-sections">
              <section className="panel padded settings-panel">
                <span className="section-kicker">PROFIL SAYA</span>
                <h2>Ubah nama dan email</h2>
                <p>Email digunakan untuk masuk. Gunakan email baru setelah menyimpan perubahan.</p>
                <form
                  key={JSON.stringify([data.me.user_id, data.me.name, data.me.email])}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const f = new FormData(form);
                    const emailChanged =
                      String(f.get('email')).trim().toLowerCase() !== data.me.email;
                    const result = await act(
                      'profile-update',
                      { name: f.get('name'), email: f.get('email'), current: f.get('current') },
                      emailChanged
                        ? 'Nama dan email berhasil disimpan. Gunakan email baru untuk login berikutnya. Sesi pada browser lain telah dikeluarkan.'
                        : 'Profil berhasil disimpan.',
                    );
                    if (result) form.reset();
                  }}
                >
                  <label>
                    Nama lengkap
                    <input
                      name="name"
                      required
                      maxLength={80}
                      autoComplete="name"
                      defaultValue={data.me.name}
                    />
                  </label>
                  <label>
                    Email
                    <input
                      name="email"
                      type="email"
                      required
                      maxLength={254}
                      autoComplete="username"
                      defaultValue={data.me.email}
                    />
                  </label>
                  <label>
                    Kata sandi sekarang
                    <PasswordInput
                      name="current"
                      required
                      maxLength={128}
                      autoComplete="current-password"
                    />
                  </label>
                  <small>Masukkan kata sandi saat ini untuk mengonfirmasi perubahan profil.</small>
                  <button className="button primary" disabled={busy}>
                    Simpan profil
                  </button>
                </form>
              </section>
              <section className="panel padded settings-panel">
                <span className="section-kicker">AKUN SAYA</span>
                <h2>Ubah kata sandi</h2>
                <p>
                  {data.me.name} · {data.me.email}
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      f = new FormData(form);
                    if (f.get('password') !== f.get('confirm')) {
                      setNotice('Konfirmasi kata sandi tidak sama.');
                      return;
                    }
                    const result = await act(
                      'password-update',
                      { current: f.get('current'), password: f.get('password') },
                      'Kata sandi berhasil diperbarui. Sesi pada browser lain telah dikeluarkan.',
                    );
                    if (result) form.reset();
                  }}
                >
                  <label>
                    Kata sandi sekarang
                    <PasswordInput name="current" required autoComplete="current-password" />
                  </label>
                  <label>
                    Kata sandi baru
                    <PasswordInput
                      name="password"
                      minLength={8}
                      maxLength={128}
                      required
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    Ulangi kata sandi baru
                    <PasswordInput
                      name="confirm"
                      minLength={8}
                      maxLength={128}
                      required
                      autoComplete="new-password"
                    />
                  </label>
                  <button className="button primary" disabled={busy}>
                    Simpan kata sandi
                  </button>
                </form>
              </section>
            </div>
          )}
          <footer>
            <span>
              hadir<span className="footer-dot">.</span>{' '}
              <span className="footer-caption">Setiap kehadiran berarti.</span>
            </span>
          </footer>
        </div>
      </main>
      {resetMember && (
        <div className="overlay">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Atur kata sandi">
            <div className="modal-title">
              <h2>Atur kata sandi</h2>
              <button
                className="icon-button"
                aria-label="Tutup"
                onClick={() => setResetMember(null)}
              >
                <X />
              </button>
            </div>
            <p>
              {resetMember.name} · {resetMember.email}
            </p>
            <div role="alert">{resetError && <p className="danger">{resetError}</p>}</div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (f.get('password') !== f.get('confirm')) {
                  setResetError('Konfirmasi kata sandi tidak sama.');
                  return;
                }
                setBusy(true);
                setResetError('');
                try {
                  await api('password-reset', {
                    email: resetMember.email,
                    password: f.get('password'),
                  });
                  setResetMember(null);
                  setNotice('Kata sandi berhasil diatur ulang.');
                  await load();
                } catch (error: any) {
                  setResetError(error.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Kata sandi baru
                <PasswordInput
                  name="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Ulangi kata sandi
                <PasswordInput
                  name="confirm"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <button disabled={busy} className="button primary">
                Simpan kata sandi
              </button>
            </form>
          </section>
        </div>
      )}
      {!admin && camera && (
        <div className="overlay">
          <section
            className="modal camera-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Kamera absensi"
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">SELFIE + QR</span>
                <h2>Absen {camera === 'in' ? 'masuk' : 'pulang'}</h2>
              </div>
              <button
                disabled={busy}
                className="icon-button"
                aria-label="Tutup kamera"
                onClick={closeCamera}
              >
                <X />
              </button>
            </div>
            <p>Pastikan wajah dan QR kantor terlihat jelas dalam satu foto.</p>
            <div className="camera-view">
              {shot ? (
                <img src={shot} alt="Hasil selfie bersama QR" />
              ) : (
                <video ref={video} playsInline muted />
              )}
              {!ready && !shot && <span>Menyiapkan kamera…</span>}
            </div>
            {cameraError && (
              <div className="notice" role="alert">
                {cameraError}
              </div>
            )}
            {shot ? (
              <>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  Wajah saya dan QR terlihat jelas dalam foto ini.
                </label>
                <div className="modal-actions">
                  <button disabled={busy} className="button" onClick={() => openCamera(camera)}>
                    <RefreshCw size={16} /> Ambil ulang
                  </button>
                  <button disabled={busy || !confirmed} className="button primary" onClick={submit}>
                    {busy ? 'Mengirim…' : 'Kirim absensi'}
                    <Check size={16} />
                  </button>
                </div>
              </>
            ) : (
              <button className="button primary full" disabled={!ready} onClick={capture}>
                <Camera size={17} /> Ambil selfie
              </button>
            )}
          </section>
        </div>
      )}
      {cancelTarget && admin && (
        <div className="overlay">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Batalkan absensi">
            <div className="modal-title"><h2>Batalkan Absensi</h2>
              <button className="icon-button" disabled={busy} aria-label="Tutup"
                onClick={() => setCancelTarget(null)}><X /></button></div>
            <p>Batalkan absen {cancelTarget.kind === 'in' ? 'masuk' : 'pulang'} milik
              {' '}{cancelTarget.name} tanggal {cancelTarget.date}? Foto selfie akan dihapus.
              Metadata dan alasan pembatalan akan disimpan.</p>
            <label>Alasan pembatalan (wajib)
              <textarea rows={4} minLength={5} maxLength={500} required value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Tuliskan alasan pembatalan…" />
            </label>
            <div className="modal-actions">
              <button className="button" disabled={busy} onClick={() => setCancelTarget(null)}>Kembali</button>
              <button className="button danger" disabled={busy || cancelReason.trim().length < 5}
                onClick={cancelAttendance}>Konfirmasi pembatalan</button>
            </div>
          </section>
        </div>
      )}
      {photo && (
        <div className="overlay">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Bukti absensi">
            <div className="modal-title">
              <h2>Bukti kehadiran</h2>
              <button
                className="icon-button"
                aria-label="Tutup foto"
                onClick={() => setPhoto(null)}
              >
                <X />
              </button>
            </div>
            <img
              className="proof"
              src={'/api/app?action=photo&id=' + photo.id}
              alt={'Selfie absensi ' + photo.name}
            />
            <h3>{photo.name}</h3>
            <p>
              {photo.date} · {fmtTime(photo.time)} · {photo.kind === 'in' ? 'Masuk' : 'Pulang'}
            </p>
            <span className="badge">{reviews[photo.review]}</span>
            {admin && (
              <>
                <p>Periksa apakah wajah anggota dan QR terlihat jelas dalam foto yang sama.</p>
                <div className="modal-actions">
                  <button
                    disabled={busy}
                    className="button danger"
                    onClick={async () => {
                      const d = await act(
                        'review',
                        { id: photo.id, review: 'rejected' },
                        'Foto ditolak. Catatan tetap tersimpan untuk audit.',
                      );
                      if (d) setPhoto(null);
                    }}
                  >
                    Tolak foto
                  </button>
                  <button
                    disabled={busy}
                    className="button primary"
                    onClick={async () => {
                      const d = await act(
                        'review',
                        { id: photo.id, review: 'approved' },
                        'Foto disetujui.',
                      );
                      if (d) setPhoto(null);
                    }}
                  >
                    <Check size={16} /> Setujui foto
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {qr && (
        <div className="overlay print-overlay">
          <section
            className="modal print-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="QR cetak"
          >
            <div className="modal-title no-print">
              <h2>QR siap dicetak</h2>
              <button className="icon-button" aria-label="Tutup QR" onClick={() => setQr(null)}>
                <X />
              </button>
            </div>
            <div className="print-brand">hadir.</div>
            <h2>{qr.label}</h2>
            <p>SELFIE BERSAMA QR INI</p>
            <div className="print-qr" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <p>
              Pastikan wajah dan seluruh QR terlihat jelas
              <br />
              dalam satu foto saat melakukan absensi.
            </p>
            <div className="modal-actions no-print">
              <button className="button primary" onClick={() => window.print()}>
                <Download size={17} /> Cetak QR
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
