import { describe, expect, it } from 'vitest';

import {
  clearScheduleShareSearch,
  readScheduleShareSearch,
  writeScheduleShareSearch,
} from '@/utils/scheduleShareUrl.js';

describe('scheduleShareUrl', () => {
  it('reads agent, status, and q from the search string', () => {
    expect(readScheduleShareSearch('?agent=alpha&status=paused&q=digest&theme=dark')).toEqual({
      agent: 'alpha',
      status: 'paused',
      q: 'digest',
    });
    expect(readScheduleShareSearch('?status=nope&agent=')).toEqual({
      agent: null,
      status: null,
      q: null,
    });
  });

  it('writes and clears schedule-owned keys without touching host keys', () => {
    const params = new URLSearchParams('theme=dark&agent=old&q=x');
    writeScheduleShareSearch(params, { agent: 'alpha', status: 'active', q: null });
    expect(params.toString()).toBe('theme=dark&agent=alpha&status=active');

    clearScheduleShareSearch(params);
    expect(params.toString()).toBe('theme=dark');
  });
});
