// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AnalyticsProvider, useTrackAnalytics } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { withSessionProps } from '@/analytics/sessionProps.js';

describe('AnalyticsProvider', () => {
  it('no-ops when no provider is mounted', () => {
    const { result } = renderHook(() => useTrackAnalytics());
    expect(() => result.current(AnalyticsEvents.Message.SENT)).not.toThrow();
  });

  it('forwards event name and props to the host track sink', () => {
    const track = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AnalyticsProvider track={track}>{children}</AnalyticsProvider>
    );

    const { result } = renderHook(() => useTrackAnalytics(), { wrapper });
    result.current(AnalyticsEvents.Message.SENT, { has_text: true });

    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Message.SENT, { has_text: true });
  });

  it('does not throw when the host track sink throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const track = vi.fn(() => {
      throw new Error('sink down');
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AnalyticsProvider track={track}>{children}</AnalyticsProvider>
    );

    const { result } = renderHook(() => useTrackAnalytics(), { wrapper });

    expect(() => result.current(AnalyticsEvents.Message.SENT)).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('withSessionProps', () => {
  it('merges only defined session identity fields', () => {
    expect(withSessionProps({ has_text: true }, { sessionId: 's1', agentId: '', agentName: 'bot' })).toEqual({
      has_text: true,
      session_id: 's1',
      agent_name: 'bot',
    });
  });
});
