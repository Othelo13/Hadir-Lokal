import { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { getDailyRecap } from './recap-api';
import { coverageMessage } from './recap-presentation';
import { recapPageInfo, recapTableRow } from './recap-view-model';
import type { DailyRecapResponse, PageSize } from './recap-types';

interface RecapTableViewProps {
  recap: DailyRecapResponse | null;
  loading: boolean;
  error: string;
  refresh: () => void;
  page: number;
  pageSize: PageSize;
  setPage: (nextPage: number) => void;
  setPageSize: (nextSize: PageSize) => void;
}

export function DailyRecapTableView({
  recap, loading, error, refresh, page, pageSize, setPage, setPageSize,
}: RecapTableViewProps) {
  const rows = recap?.rows.map(recapTableRow) ?? [];
  const info = recap ? recapPageInfo(recap) : null;
  const message = recap ? coverageMessage(recap.context) : null;

  return (
    <section className="panel daily-recap" aria-label="Tabel rekap absensi harian">
      <div className="daily-recap-head">
        <div>
          <h2>Rekap kehadiran</h2>
          <p>Satu anggota per tanggal, sesuai bukti absensi dan riwayat kantor.</p>
        </div>
        <div className="daily-recap-head-actions">
          <span className="daily-recap-date">
            <CalendarDays size={15} aria-hidden="true" />
            {recap?.date ?? 'Tanggal kantor'}
          </span>
          <button type="button" className="button" onClick={refresh} disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" /> Perbarui
          </button>
        </div>
      </div>
      {message && <p className="daily-recap-message" role="status">{message}</p>}
      {error && (
        <div className="daily-recap-error" role="alert">
          <span>{error}</span>
          <button type="button" className="button" onClick={refresh}>Coba lagi</button>
        </div>
      )}
      {loading && <p className="daily-recap-state" role="status">Memuat rekap absensi…</p>}
      {!loading && !error && recap && (
        <>
          <div className="table-wrap">
            <table className="daily-recap-table">
              <thead>
                <tr>
                  <th scope="col">Anggota</th>
                  <th scope="col">Masuk</th>
                  <th scope="col">Pulang</th>
                  <th scope="col">Status</th>
                  <th scope="col">Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.userId}>
                    <td>
                      <div className="person">
                        <span className="avatar" aria-hidden="true">{row.name.slice(0, 2).toUpperCase()}</span>
                        <span>
                          <strong>{row.name}</strong>
                          <small>{row.email}</small>
                        </span>
                      </div>
                    </td>
                    <td className="time">{row.checkIn}</td>
                    <td className="time">{row.checkOut}</td>
                    <td><span className={'badge daily-recap-status ' + (row.status ?? 'none')}>{row.statusLabel}</span></td>
                    <td>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <div className="empty">
              <CalendarDays size={30} aria-hidden="true" />
              <h3>Tidak ada data rekap</h3>
              <p>Tidak ditemukan anggota atau bukti absensi untuk tanggal ini.</p>
            </div>
          )}
          <div className="daily-recap-footer">
            <span>Menampilkan {info?.from ?? 0}–{info?.to ?? 0} dari {info?.total ?? 0} anggota</span>
            <div className="daily-recap-pages">
              <label>
                Baris
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as PageSize)} aria-label="Jumlah anggota per halaman">
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <nav aria-label="Navigasi halaman rekap harian">
                <button type="button" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16}/></button>
                <span>Halaman {info?.page ?? 1} dari {info?.totalPages ?? 1}</span>
                <button type="button" aria-label="Halaman berikutnya" disabled={!info || page >= info.totalPages} onClick={() => setPage(page + 1)}><ChevronRight size={16}/></button>
              </nav>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default function DailyRecapTable() {
  const [recap, setRecap] = useState<DailyRecapResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    setRecap(null);
    getDailyRecap({ page, pageSize }, controller.signal).then((result) => {
      if (!active) return;
      setRecap(result);
      if (result.page !== page) setPage(result.page);
    }).catch((cause: unknown) => {
      if (!active || (cause instanceof Error && cause.name === 'AbortError')) return;
      setError(cause instanceof Error ? cause.message : 'Gagal memuat rekap absensi.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [page, pageSize, revision]);

  return <DailyRecapTableView
    recap={recap}
    loading={loading}
    error={error}
    refresh={() => setRevision((value) => value + 1)}
    page={page}
    pageSize={pageSize}
    setPage={setPage}
    setPageSize={(value) => { setPage(1); setPageSize(value); }}
  />;
}
