import { describe, expect, it } from 'vitest';

import {
  clearScheduleShareSearch,
  readScheduleShareSearch,
  writeScheduleShareSearch,
} from '@/utils/scheduleShareUrl.js';

describe('scheduleShareUrl', () => {
  it('reads agent, status, q, and isNew from the search string', () => {
    expect(readScheduleShareSearch('?agent=alpha&status=paused&q=digest&isNew=true&theme=dark')).toEqual({
      agent: 'alpha',
      status: 'paused',
      q: 'digest',
      isNew: true,
    });
    expect(readScheduleShareSearch('?status=nope&agent=&isNew=1')).toEqual({
      agent: null,
      status: null,
      q: null,
      isNew: false,
    });
  });

  it('writes and clears schedule-owned keys without touching host keys', () => {
    const params = new URLSearchParams('theme=dark&agent=old&q=x&isNew=true');
    writeScheduleShareSearch(params, { agent: 'alpha', status: 'active', q: null, isNew: null });
    expect(params.toString()).toBe('theme=dark&agent=alpha&status=active');

    writeScheduleShareSearch(params, { isNew: true });
    expect(params.get('isNew')).toBe('true');

    clearScheduleShareSearch(params);
    expect(params.toString()).toBe('theme=dark');
  });
});
