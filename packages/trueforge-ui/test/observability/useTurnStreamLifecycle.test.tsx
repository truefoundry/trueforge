// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { TurnStreamLifecycleEvent } from '@truefoundry/trueforge-assistant-ui-runtime';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ObservabilityProvider } from '@/observability/ObservabilityProvider.js';
import type { ObservabilityConfig } from '@/observability/types.js';
import { useTurnStreamLifecycle } from '@/observability/useTurnStreamLifecycle.js';

const ids = { sessionId: 's1', turnId: 't1' };

function setup(observability?: ObservabilityConfig) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ObservabilityProvider observability={observability}>{children}</ObservabilityProvider>
  );
  const { result } = renderHook(() => useTurnStreamLifecycle('my-agent'), { wrapper });
  return { emit: result.current };
}

describe('useTurnStreamLifecycle', () => {
  it('breadcrumbs snake_case context with session, turn and agent identity', () => {
    const addBreadcrumb = vi.fn();
    const { emit } = setup({ addBreadcrumb });
    const event: TurnStreamLifecycleEvent = {
      ...ids,
      type: 'completed',
      status: 'done',
      durationMs: 900,
      eventCount: 4,
      reconnectCount: 1,
    };
    emit(event);
    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: 'trueforge.turn_stream',
      message: 'completed',
      data: {
        status: 'done',
        duration_ms: 900,
        event_count: 4,
        reconnect_count: 1,
        turn_id: 't1',
        session_id: 's1',
        agent_name: 'my-agent',
      },
    });
  });

  it('adds a breadcrumb per event but captures only transport failures', () => {
    const captureError = vi.fn();
    const addBreadcrumb = vi.fn();
    const { emit } = setup({ captureError, addBreadcrumb });

    emit({ ...ids, type: 'started', mode: 'create', attempt: 0 });
    emit({ ...ids, type: 'failed', reason: 'turn_error', reconnectCount: 0, error: new Error('model failed') });
    expect(addBreadcrumb).toHaveBeenCalledTimes(2);
    expect(captureError).not.toHaveBeenCalled();

    const error = new TypeError('Failed to fetch');
    emit({ ...ids, type: 'failed', reason: 'network_error', reconnectCount: 3, error });
    expect(captureError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ reason: 'network_error', session_id: 's1' }),
    );
  });

  it('captures a stall once, on the first threshold only', () => {
    const captureError = vi.fn();
    const { emit } = setup({ captureError });
    emit({ ...ids, type: 'stalled', thresholdMs: 30_000, msSinceLastEvent: 30_100 });
    emit({ ...ids, type: 'stalled', thresholdMs: 60_000, msSinceLastEvent: 60_100 });
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0]?.[0]).toMatchObject({ name: 'TurnStreamStalledError' });
  });

  it('does not throw without a host sink', () => {
    const { emit } = setup();
    expect(() => emit({ ...ids, type: 'abandoned', msSinceLastEvent: 5, stalled: false })).not.toThrow();
  });
});
