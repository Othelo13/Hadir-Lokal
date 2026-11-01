/**
 * Divide already-filtered records into pages without modifying their order
 * or the original collection (which is still used for Excel export).
 */
export function paginate<T>(records: readonly T[], requestedPage: number, requestedPageSize: number) {
  const pageSize = [10, 20, 50].includes(requestedPageSize) ? requestedPageSize : 10;
  const total = records.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safeRequestedPage = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  const page = Math.max(1, Math.min(safeRequestedPage, totalPages));
  const offset = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    total,
    totalPages,
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(offset + pageSize, total),
    rows: records.slice(offset, offset + pageSize),
  };
}
