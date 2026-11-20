import { useEffect, useState } from 'react';
import DailyRecapDetail from './DailyRecapDetail';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { getDailyRecap } from './recap-api';
import { buildRecapQuery } from './recap-query';
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
  selectedDate: string;
  serverDate: string;
  setSelectedDate: (nextDate: string) => void;
  searchText: string;
  setSearchText: (nextText: string) => void;
  resetFilters: () => void;
  openDetail: (date: string, userId: string) => void;
}

export function DailyRecapTableView({
  recap, loading, error, refresh, page, pageSize, setPage, setPageSize,
  selectedDate, serverDate, setSelectedDate, searchText, setSearchText, resetFilters, openDetail,
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
            {recap?.date ?? (selectedDate || serverDate || 'Tanggal kantor')}
          </span>
          <button type="button" className="button" onClick={refresh} disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" /> Perbarui
          </button>
        </div>
      </div>
      <div className="daily-recap-filters">
        <label className="daily-recap-filter-date">
          <span>Tanggal rekap</span>
          <input
            type="date"
            aria-label="Tanggal rekap"
            min="1900-01-01"
            max="9998-12-31"
            value={selectedDate || serverDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </label>
        <label className="daily-recap-filter-search">
          <span>Cari anggota</span>
          <span className="daily-recap-search-field">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Cari nama atau email anggota"
              placeholder="Cari nama atau email…"
              maxLength={100}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </span>
        </label>
        <button type="button" className="button daily-recap-reset" onClick={resetFilters}>
          Reset filter
        </button>
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
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.userId}>
                    <td>
                      <div className="person">
                        <span className="avatar" aria-hidden="true">{row.name.slice(0, 2).toUpperCase()}</span>
                        <span>
                          <button type="button" className="daily-recap-member-button" onClick={() => openDetail(recap.date, row.userId)}>{row.name}</button>
                          <small>{row.email}</small>
                        </span>
                      </div>
                    </td>
                    <td className="time">{row.checkIn}</td>
                    <td className="time">{row.checkOut}</td>
                    <td><span className={'badge daily-recap-status ' + (row.status ?? 'none')}>{row.statusLabel}</span></td>
                    <td>{row.note}</td>
                    <td><button type="button" className="daily-recap-view-button" aria-label={'Lihat detail ' + row.name} onClick={() => openDetail(recap.date, row.userId)}>Lihat detail</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <div className="empty">
              <CalendarDays size={30} aria-hidden="true" />
              <h3>Tidak ada data rekap</h3>
              <p>Tidak ditemukan anggota atau bukti absensi untuk tanggal dan pencarian ini.</p>
            </div>
          )}
          <div className="daily-recap-footer">
            <span>Menampilkan {info?.from ?? 0}–{info?.to ?? 0} dari {info?.total ?? 0} anggota</span>
            <div className="daily-recap-pages">
              <label>
                Baris
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value) as PageSize)}
                  aria-label="Jumlah anggota per halaman"
                >
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

export default function DailyRecapTable({ officeToday }: { officeToday: string }) {
  const [recap, setRecap] = useState<DailyRecapResponse | null>(null);
  const [serverDate, setServerDate] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<{date: string; userId: string} | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const searching = searchText.trim() !== debouncedSearch;

  useEffect(() => {
    if (searching) {
      setRecap(null);
      setError('');
      setLoading(true);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    setRecap(null);
    const params = buildRecapQuery({ selectedDate, search: debouncedSearch, page, pageSize });
    getDailyRecap(params, controller.signal).then((result) => {
      if (!active) return;
      setServerDate(result.date);
      setRecap(result);
      if (result.page !== page) setPage(result.page);
    }).catch((cause: unknown) => {
      if (!active || (cause instanceof Error && cause.name === 'AbortError')) return;
      setError(cause instanceof Error ? cause.message : 'Gagal memuat rekap absensi.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [selectedDate, debouncedSearch, page, pageSize, revision, searching]);

  return <>
    <DailyRecapTableView
    recap={searching ? null : recap}
    loading={loading || searching}
    error={searching ? '' : error}
    refresh={() => { setSelected(null); setRevision((value) => value + 1); }}
    page={page}
    pageSize={pageSize}
    setPage={(value) => { setSelected(null); setPage(value); }}
    setPageSize={(value) => { setSelected(null); setPage(1); setPageSize(value); }}
    selectedDate={selectedDate}
    serverDate={serverDate}
    setSelectedDate={(value) => { setSelected(null); setSelectedDate(value); setPage(1); }}
    searchText={searchText}
    setSearchText={(value) => { setSelected(null); setSearchText(value); setPage(1); }}
    resetFilters={() => {
      setSelected(null);
      setSelectedDate('');
      setSearchText('');
      setDebouncedSearch('');
      setPage(1);
      setRevision((value) => value + 1);
    }}
    openDetail={(date, userId) => setSelected({date, userId})}
    />
    {selected && <DailyRecapDetail key={selected.date + ':' + selected.userId} date={selected.date} userId={selected.userId} officeToday={officeToday} onChanged={() => setRevision((value) => value + 1)} onClose={() => setSelected(null)} />}
  </>;
}
