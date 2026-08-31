'use client';

import { Suspense, useEffect, useState } from 'react';
import { useOptionalAgentSessionsServer } from '../../server/ServerContext.js';
import { useShellMode } from '../../server/ShellModeContext.js';
import type { AgentDetail, CodeSnippet } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { Skeleton } from '../primitives/Skeleton.js';
import type { AgentDetailsPageProps, AgentDetailsTab } from './types.js';

export function AgentDetailsPage({ agentId }: AgentDetailsPageProps) {
  const sessionsServer = useOptionalAgentSessionsServer();
  const shell = useShellMode();
  const AgentDetailsHeader = useSlot('AgentDetailsHeader');
  const AgentDetailsTabs = useSlot('AgentDetailsTabs');
  const AgentDetailsUnavailable = useSlot('AgentDetailsUnavailable');
  const AgentOverview = useSlot('AgentOverview');
  const AgentSessions = useSlot('AgentSessions');
  const AgentCodeSnippets = useSlot('AgentCodeSnippets');
  const [activeTab, setActiveTab] = useState<AgentDetailsTab>('overview');
  const [detail, setDetail] = useState<AgentDetail>();
  const [detailFailed, setDetailFailed] = useState(false);
  const [snippets, setSnippets] = useState<CodeSnippet[]>();
  const [snippetsFailed, setSnippetsFailed] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      shell.closeLibraryAgent();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [shell]);

  useEffect(() => {
    if (sessionsServer == null) return;
    let cancelled = false;
    void sessionsServer.getAgent({ agentId }).then(
      result => {
        if (!cancelled) setDetail(result);
      },
      () => {
        if (!cancelled) setDetailFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [agentId, sessionsServer]);

  useEffect(() => {
    if (activeTab !== 'code' || sessionsServer == null || snippets !== undefined || snippetsFailed) return;
    let cancelled = false;
    void sessionsServer.getCodeSnippets({ agentId }).then(
      result => {
        if (!cancelled) setSnippets(result);
      },
      () => {
        if (!cancelled) setSnippetsFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [activeTab, agentId, sessionsServer, snippets, snippetsFailed]);

  const goBack = () => {
    shell.closeLibraryAgent();
  };

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
        className="grid min-h-0 gap-3 overflow-auto p-4 md:grid-cols-[minmax(0,1fr)_18rem]"
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
    content = <AgentSessions />;
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
        <AgentDetailsTabs activeTab={activeTab} onTabChange={setActiveTab} />
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
