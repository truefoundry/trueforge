import {
  clearScheduleShareSearch,
  readScheduleShareSearch,
  writeOpenSchedulesForAgentSearch,
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

  it('writeOpenSchedulesForAgentSearch clears library share keys and sets agent filter', () => {
    window.history.replaceState(null, '', '/library/old?agentId=old&tab=overview&theme=dark');
    writeOpenSchedulesForAgentSearch({ agentId: 'agt_1', isNew: true });
    const url = new URL(window.location.href);
    expect(url.searchParams.get('agent')).toBe('agt_1');
    expect(url.searchParams.get('isNew')).toBe('true');
    expect(url.searchParams.get('agentId')).toBeNull();
    expect(url.searchParams.get('tab')).toBeNull();
    expect(url.searchParams.get('theme')).toBe('dark');
  });
});
