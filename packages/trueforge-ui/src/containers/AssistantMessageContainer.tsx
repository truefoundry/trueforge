'use client';

import { useActionBarCopy, useMessageError, useThreadIsRunning, type PartState } from '@assistant-ui/core/react';
import { MessagePrimitive, useAuiState, type GroupByContext } from '@assistant-ui/react';
import {
  CANCELLATION_REASON_CUSTOM_KEY,
  TURN_CANCELLATION_REASON,
  useTrueForgeResumeUnavailable,
} from '@truefoundry/trueforge-assistant-ui-runtime';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { withSessionProps } from '../analytics/sessionProps.js';
import { useSlowActivityLabel } from '../hooks/useSlowActivityLabel.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { computeAgentStepsSplit } from '../utils/computeAgentStepsSplit.js';
import {
  isParallelToolGroupPart,
  parallelGroupKeyForPart,
  readParallelToolGroups,
} from '../utils/parallelToolGroups.js';
import { loaderActivityKey, loaderActivityProgress, resolveLoaderLabel } from '../utils/resolveActivityLabel.js';
import { AgentStepsContainer } from './AgentStepsContainer.js';
import { AssistantLeafPartContainer } from './AssistantLeafPartContainer.js';
import { AssistantTextContainer } from './AssistantTextContainer.js';
import { ReasoningContainer } from './ReasoningContainer.js';
import { useSessionReplay } from './sessionReplayContext.js';
import { ToolGroupContainer, type ThreadGroupPart } from './ToolGroupContainer.js';

function cancellationLabel(reason: string | undefined): string {
  switch (reason) {
    case undefined:
      return 'Response stopped';
    case TURN_CANCELLATION_REASON.CLIENT_CANCELLED:
      return 'You stopped this response';
    case TURN_CANCELLATION_REASON.SERVER_EXECUTION_TIMEOUT:
      return 'Response timed out';
    case TURN_CANCELLATION_REASON.ABANDONED:
      return 'Response was interrupted';
    case TURN_CANCELLATION_REASON.CANCELLED_FOR_NEXT_TURN:
      return 'Stopped for a newer message';
    default:
      return reason;
  }
}

export function AssistantMessageContainer() {
  const AssistantMessageBubble = useSlot('AssistantMessageBubble');
  const MessageActionBar = useSlot('MessageActionBar');
  const MessageErrorBanner = useSlot('MessageErrorBanner');
  const MessageCancelledBanner = useSlot('MessageCancelledBanner');
  const MessageIndicator = useSlot('MessageIndicator');
  const isThreadRunning = useThreadIsRunning();
  const resumeUnavailable = useTrueForgeResumeUnavailable();
  const error = useMessageError();
  const createdAt = useAuiState(s => s.message.createdAt);
  const sessionId = useAuiState(s => s.threadListItem.remoteId);
  const isMessageRunning = useAuiState(s => s.message.status?.type === 'running');
  const messageStatus = useAuiState(s => s.message.status);
  const cancellationReason = useAuiState(s => {
    const value = s.message.metadata?.custom?.[CANCELLATION_REASON_CUSTOM_KEY];
    return typeof value === 'string' ? value : undefined;
  });
  const isSessionReplay = useSessionReplay();
  const track = useTrackAnalytics();
  const shell = useOptionalShellMode();
  const shellAgent =
    shell?.mode.status === 'active' ? { agentId: shell.mode.agentId, agentName: shell.mode.agentName } : {};
  const { copy, isCopied } = useActionBarCopy({
    copyToClipboard: text => navigator.clipboard.writeText(text),
  });
  const onCopy = () => {
    track(AnalyticsEvents.Message.COPIED, withSessionProps({ role: 'assistant' }, { sessionId, ...shellAgent }));
    copy();
  };

  const parts = useAuiState(s => s.message.parts);
  const parallelToolGroups = useAuiState(s => readParallelToolGroups(s.message.metadata.custom));
  const isCancelled = messageStatus?.type === 'incomplete' && messageStatus.reason === 'cancelled';
  // The newer user message already explains why; session replay keeps it for debugging.
  const hideCancelled =
    isCancelled && !isSessionReplay && cancellationReason === TURN_CANCELLATION_REASON.CANCELLED_FOR_NEXT_TURN;
  const cancelledBanner = isCancelled && !hideCancelled ? cancellationLabel(cancellationReason) : undefined;

  const { cutIndex, hasFinal, toolCount, thinkingCount } = computeAgentStepsSplit(parts, isMessageRunning);

  // Built-in indicator modes hide the loader while reasoning streams; we want it there too.
  // Hide when resume is unavailable (message stays "running" but no events arrive) or the
  // thread is idle — a stale running status after cancel must not revive the spinner.
  const showIndicator =
    isMessageRunning && isThreadRunning && !resumeUnavailable && parts[parts.length - 1]?.type !== 'text';
  const loaderLabel = useSlowActivityLabel({
    label: resolveLoaderLabel(parts),
    activityKey: showIndicator ? loaderActivityKey(parts) : null,
    progressKey: showIndicator ? loaderActivityProgress(parts) : null,
  });

  const groupBy = (part: PartState, _context: GroupByContext): readonly `group-${string}`[] | null => {
    const index = parts.findIndex(p => p === part);
    if (index === -1) return null;

    if (part.type === 'text' && index >= cutIndex) {
      return null;
    }

    if (index < cutIndex) {
      if (part.type === 'reasoning') {
        return ['group-agentSteps', 'group-reasoning'];
      }
      // When a tool call was requested alongside others in one response, we nest it in a parallel group inside
      // agent steps so the batch renders as one "N tool calls in parallel" row.
      const parallelKey = parallelGroupKeyForPart({ part, parts, parallelToolGroups });
      if (parallelKey != null) {
        return ['group-agentSteps', parallelKey];
      }
      return ['group-agentSteps'];
    }

    return null;
  };

  if (hideCancelled && parts.length === 0 && error === undefined) {
    return null;
  }

  return (
    <MessagePrimitive.Root data-role="assistant">
      <AssistantMessageBubble
        error={error !== undefined ? <MessageErrorBanner message={String(error)} /> : undefined}
        statusBanner={cancelledBanner !== undefined ? <MessageCancelledBanner message={cancelledBanner} /> : undefined}
        actionBar={
          !isThreadRunning ? <MessageActionBar isCopied={isCopied} onCopy={onCopy} createdAt={createdAt} /> : undefined
        }
      >
        <MessagePrimitive.GroupedParts groupBy={groupBy} indicator="never">
          {({ part, children }) => {
            switch (part.type) {
              case 'group-agentSteps':
                return (
                  <AgentStepsContainer toolCount={toolCount} thinkingCount={thinkingCount} hasFinal={hasFinal}>
                    {children}
                  </AgentStepsContainer>
                );
              case 'group-reasoning':
                return <ReasoningContainer group={part as ThreadGroupPart} />;
              case 'text': {
                const index = parts.findIndex(p => p === part);
                // Intermediate text inside Agent steps: muted + indented vs final answer
                if (index >= 0 && index < cutIndex) {
                  return (
                    <div className="mb-2 ml-[1.75rem] text-xs text-text-secondary [&_.markdown-body]:text-inherit">
                      <AssistantTextContainer />
                    </div>
                  );
                }
                return <AssistantTextContainer />;
              }
              case 'reasoning':
              case 'tool-call':
              case 'image':
              case 'data':
                return <AssistantLeafPartContainer part={part} />;
              default:
                if (isParallelToolGroupPart(part)) {
                  return <ToolGroupContainer group={part}>{children}</ToolGroupContainer>;
                }
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        {showIndicator ? <MessageIndicator label={loaderLabel} /> : null}
      </AssistantMessageBubble>
    </MessagePrimitive.Root>
  );
}
