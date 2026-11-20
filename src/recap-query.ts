import type { DailyRecapQuery, PageSize } from './recap-types';

export interface RecapFilterState {
  selectedDate: string;
  search: string;
  page: number;
  pageSize: PageSize;
}

/**
 * An empty date delegates "today" to the server's office timezone.
 * Search is performed by the API against the full selected day, not current rows.
 */
export function buildRecapQuery(state: RecapFilterState): DailyRecapQuery {
  const date = state.selectedDate.trim();
  const q = state.search.trim();
  return {
    ...(date ? { date } : {}),
    ...(q ? { q } : {}),
    page: state.page,
    pageSize: state.pageSize,
  };
}
