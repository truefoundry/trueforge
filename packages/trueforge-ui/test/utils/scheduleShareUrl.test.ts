import {
  clearScheduleShareSearch,
  readScheduleShareSearch,
  writeOpenScheduleByIdSearch,
  writeOpenSchedulesForAgentSearch,
  writeScheduleShareSearch,
} from '@/utils/scheduleShareUrl.js';

describe('scheduleShareUrl', () => {
  it('reads agent, status, q, isNew, and scheduleId from the search string', () => {
    expect(readScheduleShareSearch('?agent=alpha&status=paused&q=digest&isNew=true&scheduleId=s1&theme=dark')).toEqual({
      agent: 'alpha',
      status: 'paused',
      q: 'digest',
      isNew: true,
      scheduleId: 's1',
    });
    expect(readScheduleShareSearch('?status=nope&agent=&isNew=1')).toEqual({
      agent: null,
      status: null,
      q: null,
      isNew: false,
      scheduleId: null,
    });
  });

  it('writes and clears schedule-owned keys without touching host keys', () => {
    const params = new URLSearchParams('theme=dark&agent=old&q=x&isNew=true&scheduleId=old');
    writeScheduleShareSearch(params, {
      agent: 'alpha',
      status: 'active',
      q: null,
      isNew: null,
      scheduleId: 's1',
    });
    expect(params.toString()).toBe('theme=dark&agent=alpha&scheduleId=s1&status=active');

    writeScheduleShareSearch(params, { isNew: true, scheduleId: null });
    expect(params.get('isNew')).toBe('true');
    expect(params.get('scheduleId')).toBeNull();

    clearScheduleShareSearch(params);
    expect(params.toString()).toBe('theme=dark');
  });

  it('writeOpenSchedulesForAgentSearch clears library share keys and sets agent filter', () => {
    window.history.replaceState(null, '', '/library/old?agentId=old&tab=overview&scheduleId=old&theme=dark');
    writeOpenSchedulesForAgentSearch({ agentId: 'agt_1', isNew: true });
    const url = new URL(window.location.href);
    expect(url.searchParams.get('agent')).toBe('agt_1');
    expect(url.searchParams.get('isNew')).toBe('true');
    expect(url.searchParams.get('scheduleId')).toBeNull();
    expect(url.searchParams.get('agentId')).toBeNull();
    expect(url.searchParams.get('tab')).toBeNull();
    expect(url.searchParams.get('theme')).toBe('dark');
  });

  it('writeOpenScheduleByIdSearch clears session keys and filters, then sets the schedule id and name', () => {
    window.history.replaceState(null, '', '/sessions?sessionId=sess_1&agent=old&status=paused&q=digest&theme=dark');
    writeOpenScheduleByIdSearch({ id: 'sched_1', name: 'daily-digest' });
    const url = new URL(window.location.href);
    expect(url.searchParams.get('scheduleId')).toBe('sched_1');
    expect(url.searchParams.get('q')).toBe('daily-digest');
    expect(url.searchParams.get('agent')).toBeNull();
    expect(url.searchParams.get('status')).toBeNull();
    expect(url.searchParams.get('sessionId')).toBeNull();
    expect(url.searchParams.get('theme')).toBe('dark');
  });
});
