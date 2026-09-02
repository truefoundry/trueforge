'use client';

import { ThreadPrimitive, type ThreadMessageLike } from '@assistant-ui/react';
import { convertTurnsToThreadMessages } from '@truefoundry/assistant-ui-runtime';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { useServer } from '../server/ServerContext.js';
import type { AgentChatServer, SessionEventItem } from '../server/types.js';
import type { SlotOverrides } from '../theme/SlotsProvider.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { buildSessionMetrics } from '../utils/buildSessionMetrics.js';
import { buildSessionTimelineSegments } from '../utils/buildSessionTimelineSegments.js';
import { createCachedListEventsBridge } from '../utils/cachedListEventsBridge.js';
import { buildSessionTurnViews, type SessionTurnView } from '../utils/sessionTurnViews.js';
import { AssistantMessageContainer } from './AssistantMessageContainer.js';
import { ReadOnlySessionTurnRuntime } from './ReadOnlySessionTurnRuntime.js';
import { UserMessageContainer } from './UserMessageContainer.js';

const READ_ONLY_SLOT_OVERRIDES: SlotOverrides = {
  UserMessageActionBar: () => <></>,
  MessageActionBar: () => <></>,
};

function turnIdFromMessage(message: ThreadMessageLike): string {
  const messageId = message.id ?? '';
  if (message.role === 'user') {
    return messageId.replace(/-user$/, '');
  }
  const custom = message.metadata?.custom;
  if (custom != null && typeof custom === 'object' && 'turnId' in custom) {
    const turnId = Reflect.get(custom, 'turnId');
    if (typeof turnId === 'string' && turnId.length > 0) {
      return turnId;
    }
  }
  return messageId.replace(/-assistant$/, '');
}

function messagesForTurn(messages: ThreadMessageLike[], turnId: string): ThreadMessageLike[] {
  return messages.filter(message => turnIdFromMessage(message) === turnId);
}

export type AgentSessionTimelineContainerProps = {
  sessionId: string;
  events: SessionEventItem[];
  listMetrics?: {
    totalTurns: number;
    totalCostInUsd: number;
    totalDurationMs: number;
  };
};

export function AgentSessionTimelineContainer({ sessionId, events, listMetrics }: AgentSessionTimelineContainerProps) {
  const server = useServer();
  const AgentSessionTurnHeader = useSlot('AgentSessionTurnHeader');
  const AgentSessionEventTimeline = useSlot('AgentSessionEventTimeline');
  const AgentSessionMetricsStrip = useSlot('AgentSessionMetricsStrip');
  const MessageListSkeleton = useSlot('MessageListSkeleton');
  const ThreadViewportShell = useSlot('ThreadViewportShell');

  const [messages, setMessages] = useState<ThreadMessageLike[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const sectionRefs = useRef(new Map<number, HTMLElement>());

  const turnViews = useMemo(() => buildSessionTurnViews(events), [events]);
  const timelineSegments = useMemo(() => buildSessionTimelineSegments(turnViews), [turnViews]);
  const sessionMetrics = useMemo(
    () => buildSessionMetrics({ turns: turnViews, segments: timelineSegments, listMetrics }),
    [listMetrics, timelineSegments, turnViews],
  );

  const handleSelectTurn = useCallback((index: number) => {
    sectionRefs.current.get(index)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMessages(undefined);
    setLoadFailed(false);

    const bridge = createCachedListEventsBridge(events);
    // Events already include every turn.created / turn.done, so skip listTurns.
    const chatServer: AgentChatServer = {
      ...server,
      listEvents: req => bridge.listEvents(req),
      listTurns: async () => ({ data: [] }),
    };

    void convertTurnsToThreadMessages(chatServer, sessionId)
      .then(result => {
        if (!cancelled) setMessages(result.messages);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [events, server, sessionId]);

  if (loadFailed) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-sm text-text-secondary">
        Session messages could not be loaded.
      </div>
    );
  }

  if (messages === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <MessageListSkeleton />
      </div>
    );
  }

  if (messages.length === 0 && turnViews.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-sm text-text-secondary">
        This session has no messages yet.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border">
        <AgentSessionMetricsStrip metrics={sessionMetrics} />
        <Suspense fallback={null}>
          <AgentSessionEventTimeline turns={turnViews} segments={timelineSegments} onSelectTurn={handleSelectTurn} />
        </Suspense>
      </div>
      <ThreadViewportShell className="flex-1 pb-4">
        <div className="flex flex-col gap-4">
          {turnViews.map(turn => (
            <SessionTurnSection
              key={turn.turnId}
              turn={turn}
              messages={messagesForTurn(messages, turn.turnId)}
              AgentSessionTurnHeader={AgentSessionTurnHeader}
              onMount={node => {
                if (node == null) sectionRefs.current.delete(turn.turnNumber - 1);
                else sectionRefs.current.set(turn.turnNumber - 1, node);
              }}
            />
          ))}
        </div>
      </ThreadViewportShell>
    </div>
  );
}

function SessionTurnSection({
  turn,
  messages,
  AgentSessionTurnHeader,
  onMount,
}: {
  turn: SessionTurnView;
  messages: ThreadMessageLike[];
  AgentSessionTurnHeader: ComponentType<{
    turnNumber: number;
    totalTokens?: number;
    durationMs?: number;
    totalCostInUsd?: number;
  }>;
  onMount: (node: HTMLElement | null) => void;
}) {
  if (!turn.showHeader && messages.length === 0) {
    return null;
  }

  return (
    <section ref={onMount} id={`session-turn-${turn.turnNumber}`} className="flex flex-col gap-2">
      {turn.showHeader ? (
        <AgentSessionTurnHeader
          turnNumber={turn.turnNumber}
          totalTokens={turn.totalTokens}
          durationMs={turn.durationMs}
          totalCostInUsd={turn.totalCostInUsd}
        />
      ) : null}
      {messages.length > 0 ? (
        <ReadOnlySessionTurnRuntime slotOverrides={READ_ONLY_SLOT_OVERRIDES} messages={messages}>
          <ThreadPrimitive.Root asChild>
            <div className="aui-root aui-thread-root flex w-full flex-col">
              <ThreadPrimitive.Messages>
                {({ message }) => (message.role === 'user' ? <UserMessageContainer /> : <AssistantMessageContainer />)}
              </ThreadPrimitive.Messages>
            </div>
          </ThreadPrimitive.Root>
        </ReadOnlySessionTurnRuntime>
      ) : null}
    </section>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionTimelineContainer: typeof AgentSessionTimelineContainer;
  }
}
