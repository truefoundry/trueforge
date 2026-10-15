// @vitest-environment jsdom
import { useSessionEvents } from '@/hooks/useSessionEvents.js';
import { SessionEventsCacheProvider } from '@/server/SessionEventsCacheContext.js';
import type { AgentChatServer, AgentSessionsServer, Session, SessionEventItem } from '@/server/types.js';
import { renderHook, waitFor } from '@testing-library/react';
import { createSessionEventsCache, type SessionEventsCache } from '@truefoundry/trueforge-assistant-ui-runtime';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mockSession: Session = {
  id: 'sess-1',
  title: 'Test Session',
  isMutable: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockEvent: SessionEventItem = {
  turnId: 't-1',
  event: {
    type: 'turn.created',
    id: 'ev-1',
    turnId: 't-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
};

function wrapWithCache(cache: SessionEventsCache) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(SessionEventsCacheProvider, { cache, children });
  };
}

describe('useSessionEvents', () => {
  it('paints cached data immediately and still refetches', async () => {
    const cache = createSessionEventsCache();
    cache.set('sess-1', {
      session: mockSession,
      events: [mockEvent],
      complete: true,
      fetchedAt: Date.now(),
    });

    const updatedEvent: SessionEventItem = {
      turnId: 't-1',
      event: {
        type: 'turn.done',
        id: 'ev-2',
        state: { status: 'done', completedAt: '2026-01-01T00:00:01.000Z' },
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    };
    const sessionsServer: Pick<AgentSessionsServer, 'listSessionEvents'> = {
      listSessionEvents: vi.fn(async () => ({ data: [updatedEvent] })),
    };
    const chatServer: Pick<AgentChatServer, 'getSession'> = {
      getSession: vi.fn(async () => ({ ...mockSession, title: 'Updated Title' })),
    };

    const { result } = renderHook(
      () =>
        useSessionEvents({
          sessionId: 'sess-1',
          sessionsServer,
          chatServer,
        }),
      { wrapper: wrapWithCache(cache) },
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.events).toEqual([mockEvent]);
    expect(result.current.session).toEqual(mockSession);
    expect(result.current.isRevalidating).toBe(true);

    await waitFor(() => {
      expect(result.current.session?.title).toBe('Updated Title');
      expect(result.current.events).toEqual([updatedEvent]);
      expect(result.current.isRevalidating).toBe(false);
    });

    expect(sessionsServer.listSessionEvents).toHaveBeenCalledOnce();
    expect(chatServer.getSession).toHaveBeenCalledOnce();
    expect(cache.get('sess-1')?.complete).toBe(true);
  });

  it('fetches and caches when not in cache', async () => {
    const cache = createSessionEventsCache();
    const sessionsServer: Pick<AgentSessionsServer, 'listSessionEvents'> = {
      listSessionEvents: vi.fn(async () => ({ data: [mockEvent] })),
    };
    const chatServer: Pick<AgentChatServer, 'getSession'> = {
      getSession: vi.fn(async () => mockSession),
    };

    const { result } = renderHook(
      () =>
        useSessionEvents({
          sessionId: 'sess-new',
          sessionsServer,
          chatServer,
        }),
      { wrapper: wrapWithCache(cache) },
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.events).toEqual([mockEvent]);
      expect(result.current.session).toEqual(mockSession);
    });

    expect(sessionsServer.listSessionEvents).toHaveBeenCalledOnce();
    expect(chatServer.getSession).toHaveBeenCalledOnce();
    expect(cache.get('sess-new')?.complete).toBe(true);
  });

  it('keeps cached timeline when background refresh fails', async () => {
    const cache = createSessionEventsCache();
    cache.set('sess-1', {
      session: mockSession,
      events: [mockEvent],
      complete: true,
      fetchedAt: Date.now(),
    });

    const sessionsServer: Pick<AgentSessionsServer, 'listSessionEvents'> = {
      listSessionEvents: vi.fn(async () => {
        throw new Error('Network error');
      }),
    };
    const chatServer: Pick<AgentChatServer, 'getSession'> = {
      getSession: vi.fn(async () => {
        throw new Error('Network error');
      }),
    };
    const onError = vi.fn();

    const { result } = renderHook(
      () =>
        useSessionEvents({
          sessionId: 'sess-1',
          sessionsServer,
          chatServer,
          onError,
        }),
      { wrapper: wrapWithCache(cache) },
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.events).toEqual([mockEvent]);

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
      expect(result.current.isRevalidating).toBe(false);
    });

    expect(result.current.failed).toBe(false);
    expect(result.current.events).toEqual([mockEvent]);
    expect(result.current.session).toEqual(mockSession);
  });

  it('reports failed when cold fetch fails', async () => {
    const sessionsServer: Pick<AgentSessionsServer, 'listSessionEvents'> = {
      listSessionEvents: vi.fn(async () => {
        throw new Error('Access denied');
      }),
    };
    const chatServer: Pick<AgentChatServer, 'getSession'> = {
      getSession: vi.fn(async () => {
        throw new Error('Access denied');
      }),
    };
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useSessionEvents({
        sessionId: 'sess-error',
        sessionsServer,
        chatServer,
        onError,
      }),
    );

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
      expect(result.current.loading).toBe(false);
    });

    expect(onError).toHaveBeenCalled();
  });
});
