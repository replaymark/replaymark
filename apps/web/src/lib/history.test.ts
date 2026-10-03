import { describe, expect, it } from 'vitest';
import {
  applyStatusFilter,
  notificationsQueryParams,
  pageCount,
  parseHistorySearch,
} from './history.ts';

describe('parseHistorySearch', () => {
  it('keeps a valid status and page', () => {
    expect(parseHistorySearch({ status: 'failed', page: 3 })).toEqual({
      status: 'failed',
      page: 3,
    });
  });
  it('drops unknown status, page 1 and garbage pages', () => {
    expect(parseHistorySearch({ status: 'nope', page: 1 })).toEqual({});
    expect(parseHistorySearch({ page: '2.5' })).toEqual({});
    expect(parseHistorySearch({ page: -4 })).toEqual({});
  });
  it('accepts a numeric page string', () => {
    expect(parseHistorySearch({ page: '2' })).toEqual({ page: 2 });
  });
});

describe('notificationsQueryParams', () => {
  it('defaults to page 1 without status', () => {
    expect(notificationsQueryParams({})).toEqual({ page: '1', pageSize: '20' });
  });
  it('passes the status through', () => {
    expect(notificationsQueryParams({ status: 'sent', page: 2 })).toEqual({
      page: '2',
      pageSize: '20',
      status: 'sent',
    });
  });
});

describe('applyStatusFilter', () => {
  it('maps all to no filter and resets paging', () => {
    expect(applyStatusFilter('all')).toEqual({});
    expect(applyStatusFilter('failed')).toEqual({ status: 'failed' });
  });
});

describe('pageCount', () => {
  it('is at least one page', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(20)).toBe(1);
    expect(pageCount(21)).toBe(2);
  });
});
