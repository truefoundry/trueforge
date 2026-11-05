'use client';

import { ThreadPrimitive, useAuiState, type ThreadMessageLike } from '@assistant-ui/react';
import { convertTurnsToThreadMessages, isMcpServerAuthInfoList } from '@truefoundry/trueforge-assistant-ui-runtime';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';

import type { SessionMetricTileId } from '../atoms/agent-details/types.js';
import { AssistantMessageBubble, type AssistantMessageBubbleProps } from '../atoms/AssistantMessageBubble.js';
import { Markdown, type MarkdownProps } from '../atoms/Markdown.js';
import { MessageActionBar } from '../atoms/MessageActionBar.js';
import { ToolApprovalBar, type ToolApprovalBarProps } from '../atoms/ToolApprovalBar.js';
import { ToolCallCard, type ToolCallCardProps } from '../atoms/ToolCallCard.js';
import type { UserMessageActionBarProps } from '../atoms/UserMessageActionBar.js';
import { useServer } from '../server/ServerContext.js';
import type { AgentChatServer, SessionEventItem } from '../server/types.js';
import type { SlotOverrides } from '../theme/SlotsProvider.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { buildSessionMetrics } from '../utils/buildSessionMetrics.js';
import { buildSessionTimelineSegments } from '../utils/buildSessionTimelineSegments.js';
import { createCachedListEventsBridge } from '../utils/cachedListEventsBridge.js';
import { getTurnInputSummary } from '../utils/sessionTimelineEvents.js';
import { aggregateSessionTurnBand, buildSessionTurnViews, type SessionTurnView } from '../utils/sessionTurnViews.js';
import { AssistantMessageContainer } from './AssistantMessageContainer.js';
import { ReadOnlySessionTurnRuntime } from './ReadOnlySessionTurnRuntime.js';
import { UserMessageContainer } from './UserMessageContainer.js';

function ReadOnlyMarkdown(props: MarkdownProps) {
  return (
    <Markdown
      {...props}
      readOnly
      onDownloadArtifact={undefined}
      sandboxDownloadReadOnlyTooltip="Download File is not available in read-only mode"
    />
  );
}

/** Copy + timestamp only — edit/retry are not meaningful in session details. */
function ReadOnlyUserMessageActionBar({ isCopied, onCopy, createdAt, className }: UserMessageActionBarProps) {
  return <MessageActionBar isCopied={isCopied} onCopy={onCopy} createdAt={createdAt} className={className} />;
}

/** HITL Allow/Deny is only for live chat — session detail is a historical replay. */
function ReadOnlyToolApprovalBar(props: ToolApprovalBarProps) {
  return <ToolApprovalBar {...props} readOnly />;
}

/** Nothing will answer a paused approval in a replay, so drop the "Awaiting Response" spinner. */
function ReadOnlyToolCallCard(props: ToolCallCardProps) {
  return <ToolCallCard {...props} awaiting={props.approvalSlot ? false : props.awaiting} />;
}

/** In session detail replay, render any pending MCP authorization prompt in readOnly mode. */
function ReadOnlyAssistantMessageBubble(props: AssistantMessageBubbleProps) {
  const McpAuthPrompt = useSlot('McpAuthPrompt');
  const custom = useAuiState(s => s.message.metadata.custom);
  const rawServers = custom?.pendingMcpAuth === true ? custom?.mcpServers : undefined;
  const mcpServers = isMcpServerAuthInfoList(rawServers) ? rawServers : undefined;

  return (
    <AssistantMessageBubble {...props}>
      {props.children}
      {mcpServers != null && mcpServers.length > 0 ? (
        <McpAuthPrompt servers={mcpServers} readOnly={true} onConnect={() => {}} />
      ) : null}
    </AssistantMessageBubble>
  );
}

const READ_ONLY_SLOT_OVERRIDES: SlotOverrides = {
  AssistantMessageBubble: ReadOnlyAssistantMessageBubble,
  UserMessageActionBar: ReadOnlyUserMessageActionBar,
  Markdown: ReadOnlyMarkdown,
  ToolApprovalBar: ReadOnlyToolApprovalBar,
  ToolCallCard: ReadOnlyToolCallCard,
};

type TurnCreatedEvent = Extract<SessionEventItem['event'], { type: 'turn.created' }>;
type UserMessageInput = Extract<NonNullable<TurnCreatedEvent['input']>[number], { type: 'user.message' }>;

function turnIdFromMessage(message: ThreadMessageLike): string {
  const messageId = message.id ?? '';
  // The stable message id identifies the opening backend turn. Metadata can
  // point at the latest continuation turn for artifact ownership.
  return message.role === 'user' ? messageId.replace(/-user$/, '') : messageId.replace(/-assistant$/, '');
}

function buildProjectionEvents(items: SessionEventItem[], turns: SessionTurnView[]): SessionEventItem[] {
  // The chat projection folds continuation inputs into the previous response.
  // Add a display-only user boundary so Agent Details keeps each backend turn separate.
  const continuationSummaries = new Map(
    turns.flatMap(turn => {
      const input = turn.created.input ?? [];
      return input.some(item => item.type === 'user.message') ? [] : [[turn.turnId, getTurnInputSummary(turn)]];
    }),
  );

  return items.map(item => {
    if (item.event.type !== 'turn.created') return item;
    const summary = continuationSummaries.get(item.turnId);
    if (summary === undefined) return item;
    const displayInput: UserMessageInput = { type: 'user.message', content: summary };
    return {
      ...item,
      event: {
        ...item.event,
        input: [...(item.event.input ?? []), displayInput],
      },
    };
  });
}

/** Retrieves MCP servers requiring OAuth in this turn from done actions or turn events. */
function findTurnMcpServers(turn: SessionTurnView) {
  const actions = turn.done?.state.status === 'done' ? turn.done.state.requiredActions : undefined;
  if (Array.isArray(actions)) {
    for (const action of actions) {
      if (action.type === 'mcp.auth_required' && isMcpServerAuthInfoList(action.mcpServers)) {
        return action.mcpServers;
      }
    }
  }
  for (const event of turn.events) {
    if (event.type === 'mcp.auth_required' && isMcpServerAuthInfoList(event.mcpServers)) {
      return event.mcpServers;
    }
  }
  return undefined;
}

/**
 * Re-attaches MCP auth metadata to the assistant message in session replay.
 * History projection drops pendingMcpAuth when synthetic continuation user messages
 * follow; restoring it here ensures ReadOnlyAssistantMessageBubble renders the auth widget.
 */
function applyMcpAuthState(messages: ThreadMessageLike[], turn: SessionTurnView): ThreadMessageLike[] {
  const mcpServers = findTurnMcpServers(turn);
  if (mcpServers == null || mcpServers.length === 0) return messages;

  const assistantIndex = messages.findIndex(message => message.role === 'assistant');
  const assistant = assistantIndex < 0 ? undefined : messages[assistantIndex];
  const createdAt = new Date(turn.done?.createdAt ?? turn.created.createdAt);
  const updatedAssistant: ThreadMessageLike = {
    ...(assistant ?? {
      id: `${turn.turnId}-assistant`,
      role: 'assistant',
      content: [],
      createdAt,
    }),
    ...(turn.done?.state.status === 'done' ? { status: { type: 'complete', reason: 'stop' } } : {}),
    metadata: {
      ...assistant?.metadata,
      custom: {
        ...assistant?.metadata?.custom,
        turnId: turn.turnId,
        pendingMcpAuth: true,
        mcpServers,
      },
    },
  };

  if (assistantIndex < 0) return [...messages, updatedAssistant];
  return messages.map((message, index) => (index === assistantIndex ? updatedAssistant : message));
}

function messageBelongsToTurn(message: ThreadMessageLike, turnId: string): boolean {
  if (turnIdFromMessage(message) === turnId) return true;
  // Folded continuations keep `${openingTurnId}-assistant` but stamp the cancelling
  // turn id on metadata.custom.turnId so the banner lands on the right section.
  const customTurnId = message.metadata?.custom?.['turnId'];
  return typeof customTurnId === 'string' && customTurnId === turnId;
}

function messagesForTurn(messages: ThreadMessageLike[], turn: SessionTurnView): ThreadMessageLike[] {
  const matched = messages.filter(message => messageBelongsToTurn(message, turn.turnId));
  const withAuth = applyMcpAuthState(matched, turn);
  // Session detail is a static snapshot — coerce running assistant status so
  // markdown does not typewrite as if the live stream were still open.
  if (turn.done != null) return withAuth;
  return withAuth.map(message => {
    if (message.role !== 'assistant' || message.status?.type !== 'running') return message;
    return { ...message, status: { type: 'complete', reason: 'stop' } };
  });
}

export type AgentSessionTimelineContainerProps = {
  sessionId: string;
  events: SessionEventItem[];
  contentMaxWidth?: string;
  sessionMetrics?: {
    totalTurns?: number;
    totalCostInUsd?: number;
    totalDurationMs: number;
  };
  /** Older events are still being fetched; `events` holds the newest part of history. */
  loadingOlder?: boolean;
  olderFailed?: boolean;
  onRetryOlder?: () => void;
};

/** Within this distance of the bottom the view keeps following new content. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 32;

type ScrollAnchor = { turnId: string; offsetTop: number };

/**
 * Pins the session scroll to the bottom until the user scrolls away; otherwise keeps
 * the topmost visible turn in place while older turns are prepended above it.
 */
function useSessionScrollAnchoring(content: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const anchorRef = useRef<ScrollAnchor | null>(null);

  const recordPosition = useCallback(() => {
    const el = scrollRef.current;
    if (el == null) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX;
    const containerTop = el.getBoundingClientRect().top;
    anchorRef.current = null;
    for (const section of el.querySelectorAll<HTMLElement>('[data-session-turn-id]')) {
      const rect = section.getBoundingClientRect();
      const turnId = section.dataset['sessionTurnId'];
      if (rect.bottom > containerTop && turnId != null) {
        anchorRef.current = { turnId, offsetTop: rect.top - containerTop };
        break;
      }
    }
  }, []);

  const restorePosition = useCallback(() => {
    const el = scrollRef.current;
    if (el == null) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      const anchor = anchorRef.current;
      const section =
        anchor == null
          ? null
          : Array.from(el.querySelectorAll<HTMLElement>('[data-session-turn-id]')).find(
              node => node.dataset['sessionTurnId'] === anchor.turnId,
            );
      if (anchor != null && section != null) {
        el.scrollTop += section.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offsetTop;
      }
    }
    recordPosition();
  }, [recordPosition]);

  useLayoutEffect(() => {
    restorePosition();
  }, [content, restorePosition]);

  // Markdown, code and images grow after mount; follow them while pinned.
  useEffect(() => {
    const el = scrollRef.current;
    const body = el?.firstElementChild;
    if (el == null || body == null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [content]);

  return { scrollRef, onScroll: recordPosition };
}

export function AgentSessionTimelineContainer({
  sessionId,
  events,
  contentMaxWidth,
  sessionMetrics: sessionMetricsHint,
  loadingOlder = false,
  olderFailed = false,
  onRetryOlder,
}: AgentSessionTimelineContainerProps) {
  const server = useServer();
  const AgentSessionTurnHeader = useSlot('AgentSessionTurnHeader');
  const AgentSessionEventTimeline = useSlot('AgentSessionEventTimeline');
  const AgentSessionMetricsStrip = useSlot('AgentSessionMetricsStrip');
  const MessageListSkeleton = useSlot('MessageListSkeleton');
  const ThreadViewportShell = useSlot('ThreadViewportShell');

  // Chat and timeline render from the last converted snapshot so a newly loaded
  // page swaps in atomically instead of flashing the skeleton.
  const [rendered, setRendered] = useState<{ turnViews: SessionTurnView[]; messages: ThreadMessageLike[] }>();
  const [loadFailed, setLoadFailed] = useState(false);
  const sectionRefs = useRef(new Map<number, HTMLElement>());

  const latestTurnViews = useMemo(() => buildSessionTurnViews(events), [events]);
  const projectionEvents = useMemo(
    () =>
      buildProjectionEvents(
        events,
        latestTurnViews.filter(turn => turn.renderable),
      ),
    [events, latestTurnViews],
  );
  const allTurnViews = useMemo(() => rendered?.turnViews ?? [], [rendered]);
  const renderableTurnViews = useMemo(() => allTurnViews.filter(turn => turn.renderable), [allTurnViews]);
  const messages = rendered?.messages;
  const { scrollRef, onScroll } = useSessionScrollAnchoring(rendered);
  const timelineSegments = useMemo(() => buildSessionTimelineSegments(allTurnViews), [allTurnViews]);
  const sessionMetrics = useMemo(
    () => buildSessionMetrics({ turns: allTurnViews, segments: timelineSegments, sessionMetrics: sessionMetricsHint }),
    [sessionMetricsHint, timelineSegments, allTurnViews],
  );

  // Duration and cost come from getSession when available, so only the event-derived tiles wait.
  const pendingTiles = useMemo<ReadonlySet<SessionMetricTileId> | undefined>(() => {
    if (!loadingOlder) return undefined;
    const tiles = new Set<SessionMetricTileId>(['turns', 'tokens', 'context', 'tool-calls', 'sub-agents', 'errors']);
    if (sessionMetricsHint == null) {
      tiles.add('wall-time');
      tiles.add('cost');
    }
    return tiles;
  }, [loadingOlder, sessionMetricsHint]);

  const handleSelectTurn = useCallback((index: number) => {
    sectionRefs.current.get(index)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bridge = createCachedListEventsBridge(projectionEvents, { allAtOnce: true });
    // Events already include every turn.created / turn.done, so skip listTurns.
    const chatServer: AgentChatServer = {
      ...server,
      listEvents: req => bridge.listEvents(req),
      listTurns: async () => ({ data: [] }),
    };

    void convertTurnsToThreadMessages(chatServer, sessionId)
      .then(result => {
        if (cancelled) return;
        setRendered({ turnViews: latestTurnViews, messages: result.messages });
        setLoadFailed(false);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [latestTurnViews, projectionEvents, server, sessionId]);

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

  // No renderable turn.created inputs — nothing to section under.
  if (renderableTurnViews.length === 0 && !loadingOlder && !olderFailed) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-sm text-text-secondary">
        This session has no messages yet.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
      data-slot="agent-session-scroll"
    >
      <div>
        <div className="sticky top-0 z-20 bg-primary-bg" data-slot="agent-session-metrics-sticky">
          <AgentSessionMetricsStrip metrics={sessionMetrics} {...(pendingTiles == null ? {} : { pendingTiles })} />
        </div>
        <div className="border-b border-border">
          <Suspense fallback={null}>
            <AgentSessionEventTimeline
              turns={allTurnViews}
              segments={timelineSegments}
              onSelectTurn={handleSelectTurn}
            />
          </Suspense>
        </div>
        <ThreadViewportShell
          scrollable={false}
          className="pb-4"
          {...(contentMaxWidth == null ? {} : { contentMaxWidth })}
        >
          <div className="flex flex-col gap-4">
            {loadingOlder ? (
              <div role="status" className="pt-4 text-center text-xs text-text-secondary">
                Loading earlier messages…
              </div>
            ) : olderFailed ? (
              <div role="alert" className="flex items-center justify-center gap-2 pt-4 text-xs text-text-secondary">
                Earlier messages could not be loaded.
                {onRetryOlder == null ? null : (
                  <button type="button" className="font-medium text-text-primary underline" onClick={onRetryOlder}>
                    Retry
                  </button>
                )}
              </div>
            ) : null}
            {renderableTurnViews.map(turn => (
              <SessionTurnSection
                key={turn.turnId}
                turn={aggregateSessionTurnBand(allTurnViews, turn.turnNumber) ?? turn}
                messages={messagesForTurn(messages, turn)}
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
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    inputTokensBreakdown?: SessionTurnView['inputTokensBreakdown'];
    durationMs?: number;
    totalCostInUsd?: number;
    modelName?: string;
  }>;
  onMount: (node: HTMLElement | null) => void;
}) {
  const isRunning = turn.done == null;
  if (!turn.showHeader && messages.length === 0 && !isRunning) {
    return null;
  }

  return (
    <section
      ref={onMount}
      id={`session-turn-${turn.turnNumber}`}
      data-session-turn-id={turn.turnId}
      className="flex flex-col gap-2"
    >
      {turn.showHeader ? (
        <AgentSessionTurnHeader
          turnNumber={turn.turnNumber}
          totalTokens={turn.totalTokens}
          inputTokens={turn.inputTokens}
          outputTokens={turn.outputTokens}
          cachedTokens={turn.cachedTokens}
          cacheReadTokens={turn.cacheReadTokens}
          cacheWriteTokens={turn.cacheWriteTokens}
          inputTokensBreakdown={turn.inputTokensBreakdown}
          durationMs={turn.durationMs}
          totalCostInUsd={turn.totalCostInUsd}
          modelName={turn.modelName}
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
      {isRunning ? (
        <div
          role="status"
          className="border-warning-bg bg-warning-bg/10 text-warning-bg inline-flex w-fit max-w-full items-center gap-3 rounded-xl border px-3 py-1.5 text-sm font-medium leading-[1.4]"
        >
          Turn is still in running, all events might not be visible
        </div>
      ) : null}
    </section>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionTimelineContainer: typeof AgentSessionTimelineContainer;
  }
}
