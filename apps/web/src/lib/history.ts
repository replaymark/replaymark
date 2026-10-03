import {
  type NotificationStatus,
  notificationStatusSchema,
} from '@shared/schemas.ts';

export const HISTORY_PAGE_SIZE = 20;
export const STATUS_FILTERS = ['all', 'pending', 'sent', 'failed'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface HistorySearch {
  status?: NotificationStatus;
  page?: number;
}

/** Router search params -> clean state; anything unknown is dropped. */
export function parseHistorySearch(
  raw: Record<string, unknown>,
): HistorySearch {
  const out: HistorySearch = {};
  const status = notificationStatusSchema.safeParse(raw.status);
  if (status.success) out.status = status.data;
  const page = Number(raw.page);
  if (Number.isInteger(page) && page > 1) out.page = page;
  return out;
}

/** Search state -> `GET /api/notifications` query (strings, as sent on the wire). */
export function notificationsQueryParams(search: {
  status?: NotificationStatus | NotificationStatus[];
  page?: number;
}): {
  page: string;
  pageSize: string;
  status?: string;
} {
  return {
    page: String(search.page ?? 1),
    pageSize: String(HISTORY_PAGE_SIZE),
    ...(search.status?.length
      ? { status: [search.status].flat().join(',') }
      : {}),
  };
}

/** Filter select value -> search state; changing the filter resets paging. */
export function applyStatusFilter(filter: StatusFilter): HistorySearch {
  return filter === 'all' ? {} : { status: filter };
}

export function pageCount(total: number, pageSize = HISTORY_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
