'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';

import { useSessionShareSearch } from '../../hooks/useSessionShareSearch.js';
import { useOptionalAgentSessionsServer } from '../../server/ServerContext.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import {
  defaultSessionTimeRange,
  readSessionShareSearch,
  resolveSessionTimeRange,
  type SessionTimeRange,
} from '../../utils/sessionShareUrl.js';
import { PageHeader } from '../PageHeader.js';
import { Skeleton } from '../primitives/Skeleton.js';

export function SessionsPage() {
  const sessionsServer = useOptionalAgentSessionsServer();
  const { updateShareSearch } = useSessionShareSearch();
  const AgentSessions = useSlot('AgentSessions');
  const AgentSessionsFilters = useSlot('AgentSessionsFilters');

  const [agentFilter, setAgentFilter] = useState<string | null>(
    () => readSessionShareSearch(window.location.search).agentId,
  );
  const [timeRange, setTimeRange] = useState<SessionTimeRange>(
    () => readSessionShareSearch(window.location.search).timeRange ?? defaultSessionTimeRange(),
  );

  useEffect(() => {
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

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-primary-bg">
      <PageHeader
        title="Agent Sessions"
        end={
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
              shareView="sessions"
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
