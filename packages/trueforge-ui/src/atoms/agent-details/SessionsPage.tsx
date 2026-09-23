'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { useCopySharedSessionLink } from '../../hooks/useCopySharedSessionLink.js';
import { useSessionShareSearch } from '../../hooks/useSessionShareSearch.js';
import { Icon } from '../../icons/Icon.js';
import { useOptionalAgentSessionsServer } from '../../server/ServerContext.js';
import { useShellMode } from '../../server/ShellModeContext.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import {
  defaultSessionTimeRange,
  readSessionShareSearch,
  resolveSessionTimeRange,
  SESSION_TIME_BUFFER_MS,
  type SessionTimeRange,
} from '../../utils/sessionShareUrl.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { PageHeader } from '../PageHeader.js';
import { Skeleton } from '../primitives/Skeleton.js';

export function SessionsPage() {
  const sessionsServer = useOptionalAgentSessionsServer();
  const shell = useShellMode();
  const { sessionId, updateShareSearch } = useSessionShareSearch();
  const AgentSessions = useSlot('AgentSessions');
  const AgentSessionsFilters = useSlot('AgentSessionsFilters');
  const sharedSessionId = shell.sharedSessionId;
  const selectedSessionId = sharedSessionId ?? sessionId;
  const { copied, copySharedSessionLink } = useCopySharedSessionLink(selectedSessionId);

  const [agentFilter, setAgentFilter] = useState<string | null>(
    () => readSessionShareSearch(window.location.search).agentId,
  );
  const [timeRange, setTimeRange] = useState<SessionTimeRange>(
    () => readSessionShareSearch(window.location.search).timeRange ?? defaultSessionTimeRange(),
  );

  useEffect(() => {
    if (sharedSessionId != null) return;
    const share = readSessionShareSearch(window.location.search);
    updateShareSearch({
      view: 'sessions',
      ...(share.timeRange == null ? { timeRange } : {}),
    });
    // Seed `view=sessions` and the default window once; later writes come from the filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const syncFilters = () => {
      const share = readSessionShareSearch(window.location.search);
      setAgentFilter(share.agentId);
      setTimeRange(share.timeRange ?? defaultSessionTimeRange());
    };
    window.addEventListener('popstate', syncFilters);
    return () => window.removeEventListener('popstate', syncFilters);
  }, []);

  // Resolve relative presets only when the filter changes. Unrelated query
  // updates (such as selecting a session) must not shift/refetch the list.
  const resolved = useMemo(() => resolveSessionTimeRange(timeRange), [timeRange]);
  const timeRangeDurationMs = timeRange.endTs - timeRange.startTs;
  const showLoadRecentSessions =
    timeRange.timeWindowMs == null && timeRangeDurationMs > 0 && timeRangeDurationMs <= 2 * SESSION_TIME_BUFFER_MS;
  const loadRecentSessions = useCallback(() => {
    const recentRange = defaultSessionTimeRange();
    setTimeRange(recentRange);
    updateShareSearch({ timeRange: recentRange, sessionId: null, view: 'sessions' });
  }, [updateShareSearch]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-primary-bg">
      <PageHeader
        title="Agent Sessions"
        end={
          <>
            {selectedSessionId != null ? (
              <button
                type="button"
                className={auiButtonClass({ variant: 'secondary', size: 'small' })}
                onClick={() => void copySharedSessionLink()}
              >
                <Icon name="link" />
                {copied ? 'Copied' : 'Copy shared link'}
              </button>
            ) : null}
            {sharedSessionId == null ? (
              <AgentSessionsFilters
                agentId={agentFilter}
                timeRange={timeRange}
                onAgentChange={nextAgentId => {
                  setAgentFilter(nextAgentId);
                  updateShareSearch({ agentId: nextAgentId, sessionId: null, view: 'sessions' });
                }}
                onTimeRangeChange={nextRange => {
                  setTimeRange(nextRange);
                  updateShareSearch({ timeRange: nextRange, sessionId: null, view: 'sessions' });
                }}
              />
            ) : null}
          </>
        }
      />
      <div className="min-h-0 flex-1">
        {sessionsServer == null ? (
          <p className="px-6 py-12 text-center text-sm text-text-secondary">Session history is not available.</p>
        ) : (
          <Suspense
            fallback={
              <div className="p-4" role="status" aria-label="Loading sessions">
                <Skeleton className="min-h-64 rounded-lg" />
              </div>
            }
          >
            <AgentSessions
              agentId={agentFilter ?? undefined}
              startTimestamp={new Date(resolved.startTs).toISOString()}
              endTimestamp={new Date(resolved.endTs).toISOString()}
              {...(sharedSessionId == null
                ? {
                    shareView: 'sessions' as const,
                    ...(showLoadRecentSessions ? { onLoadRecentSessions: loadRecentSessions } : {}),
                  }
                : {
                    detailOnly: true,
                    detailSessionId: sharedSessionId,
                    onCloseDetail: shell.closeSharedSession,
                  })}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    SessionsPage: typeof SessionsPage;
  }
}
