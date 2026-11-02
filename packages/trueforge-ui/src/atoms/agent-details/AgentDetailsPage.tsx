'use client';

import { useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useSessionShareSearch } from '../../hooks/useSessionShareSearch.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { isMetricsChromeEnabled, isSchedulesChromeEnabled } from '../../server/serverChrome.js';
import {
  useOptionalAgentMetricsServer,
  useOptionalAgentSessionsServer,
  useOptionalScheduleServer,
} from '../../server/ServerContext.js';
import { useShellMode } from '../../server/ShellModeContext.js';
import type { AgentSessionsServer } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { defaultMetricsTimeRange, libraryAgentTabFromSearch } from '../../utils/sessionShareUrl.js';
import { DesktopOnlyNotice } from '../DesktopOnlyNotice.js';
import { isMobileNavDrawerOpen } from '../lib/isMobileNavDrawerOpen.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { Skeleton } from '../primitives/Skeleton.js';
import type { AgentDetailsPageProps } from './types.js';

function requireSessionsServer(server: AgentSessionsServer | null): AgentSessionsServer {
  if (server == null) throw new Error('Agent details require a sessions server.');
  return server;
}

export function AgentDetailsPage({ agentId }: AgentDetailsPageProps) {
  const sessionsServer = useOptionalAgentSessionsServer();
  const queryClient = useServerQueryClient();
  const metricsServer = useOptionalAgentMetricsServer();
  const scheduleServer = useOptionalScheduleServer();
  const shell = useShellMode();
  const isMobile = useIsMobile();
  const share = useSessionShareSearch();
  const track = useTrackAnalytics();
  const { updateShareSearch } = share;
  const requestedTab = libraryAgentTabFromSearch(share, agentId);
  const showMetrics = isMetricsChromeEnabled({ metrics: metricsServer });
  const showSchedules = isSchedulesChromeEnabled({ schedules: scheduleServer });
  const activeTab =
    (requestedTab === 'metrics' && !showMetrics) || (requestedTab === 'schedules' && !showSchedules)
      ? 'overview'
      : requestedTab;
  const AgentDetailsHeader = useSlot('AgentDetailsHeader');
  const AgentDetailsTabs = useSlot('AgentDetailsTabs');
  const AgentDetailsUnavailable = useSlot('AgentDetailsUnavailable');
  const AgentOverview = useSlot('AgentOverview');
  const AgentSessions = useSlot('AgentSessions');
  const SchedulesPage = useSlot('SchedulesPage');
  const AgentMetrics = useSlot('AgentMetrics');
  const AgentMetricsTimeRangeFilter = useSlot('AgentMetricsTimeRangeFilter');
  const AgentCodeSnippets = useSlot('AgentCodeSnippets');
  const [metricsTimeRange, setMetricsTimeRange] = useState(defaultMetricsTimeRange);

  const goBack = useCallback(() => {
    updateShareSearch({
      sessionId: null,
      agentId: null,
      tab: null,
      view: null,
      timeRange: null,
    });
    shell.closeLibraryAgent();
  }, [shell, updateShareSearch]);

  useEffect(() => {
    track(AnalyticsEvents.AgentDetails.OPENED, { agent_id: agentId });
    // Track only on mount (agentId-keyed remount boundary handles agent switches).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Let the mobile nav drawer consume Escape when it is open on top.
      if (isMobileNavDrawerOpen()) return;
      event.stopImmediatePropagation();
      goBack();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [goBack]);

  const detailQuery = useQuery(
    {
      queryKey: queryKeys.agentDetails.agent(agentId),
      queryFn: () => requireSessionsServer(sessionsServer).getAgent({ agentId }),
      enabled: sessionsServer != null,
    },
    queryClient,
  );
  const detail = detailQuery.data;
  const detailFailed = detail == null && detailQuery.isError;

  // Snippets load on first visit to the code tab and stay cached afterwards.
  const snippetsQuery = useQuery(
    {
      queryKey: queryKeys.agentDetails.codeSnippets(agentId),
      queryFn: () => requireSessionsServer(sessionsServer).getCodeSnippets({ agentId }),
      enabled: sessionsServer != null && activeTab === 'code',
    },
    queryClient,
  );
  const snippets = snippetsQuery.data;
  const snippetsFailed = snippets == null && snippetsQuery.isError;

  let content;
  if (sessionsServer == null) {
    content = (
      <AgentDetailsUnavailable
        onBack={goBack}
        reason="This host does not provide agent details. Return to the library to choose an agent."
      />
    );
  } else if (detailFailed) {
    content = <AgentDetailsUnavailable onBack={goBack} />;
  } else if (detail == null) {
    content = (
      <div
        className="grid min-h-0 gap-3 overflow-auto p-4 md:grid-cols-[minmax(0,1fr)_22rem]"
        role="status"
        aria-label="Loading agent details"
      >
        <Skeleton className="min-h-80 rounded-lg" />
        <div className="space-y-3">
          {['mcp', 'skills', 'model', 'execution'].map(item => (
            <Skeleton key={item} className="h-24 rounded-lg" />
          ))}
        </div>
      </div>
    );
  } else if (activeTab === 'overview') {
    content = <AgentOverview detail={detail} />;
  } else if (activeTab === 'sessions') {
    content = isMobile ? <DesktopOnlyNotice /> : <AgentSessions agentId={agentId} />;
  } else if (activeTab === 'schedules') {
    content = isMobile ? <DesktopOnlyNotice /> : <SchedulesPage agentId={agentId} />;
  } else if (activeTab === 'metrics') {
    content = (
      <AgentMetrics
        agentId={agentId}
        timeRange={metricsTimeRange}
        onTimeRangeChange={setMetricsTimeRange}
        showTimeRangeFilter={false}
      />
    );
  } else if (snippetsFailed) {
    content = <AgentDetailsUnavailable onBack={goBack} reason="Code samples for this agent could not be loaded." />;
  } else if (snippets === undefined) {
    content = (
      <div className="flex min-h-64 gap-3 p-3" role="status" aria-label="Loading code samples">
        <Skeleton className="hidden w-44 shrink-0 rounded-lg md:block" />
        <Skeleton className="min-h-64 min-w-0 flex-1 rounded-lg" />
      </div>
    );
  } else {
    content = <AgentCodeSnippets snippets={snippets} />;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-primary-bg">
      <AgentDetailsHeader agentId={agentId} detail={detail} onBack={goBack} />
      {sessionsServer != null && !detailFailed ? (
        <AgentDetailsTabs
          activeTab={activeTab}
          showMetrics={showMetrics}
          showSchedules={showSchedules}
          end={
            activeTab === 'metrics' ? (
              <AgentMetricsTimeRangeFilter timeRange={metricsTimeRange} onTimeRangeChange={setMetricsTimeRange} />
            ) : null
          }
          onTabChange={tab => {
            track(AnalyticsEvents.AgentDetails.TAB_CHANGED, { agent_id: agentId, tab });
            updateShareSearch({
              agentId,
              tab,
              view: null,
              timeRange: null,
              ...(tab === 'sessions' ? {} : { sessionId: null }),
            });
          }}
        />
      ) : null}
      {/* Tabs own their scrolling so long instructions / code samples stay inside their card. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden" role="tabpanel">
        <Suspense
          fallback={
            <div className="p-4" role="status" aria-label="Loading">
              <Skeleton className="min-h-64 rounded-lg" />
            </div>
          }
        >
          {content}
        </Suspense>
      </main>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentDetailsPage: typeof AgentDetailsPage;
  }
}
