'use client';

import { useActionBarCopy, useMessageError, useThreadIsRunning, type PartState } from '@assistant-ui/core/react';
import { MessagePrimitive, useAuiState, type EnrichedPartState, type GroupByContext } from '@assistant-ui/react';
import {
  CANCELLATION_REASON_CUSTOM_KEY,
  CONTEXT_COMPACTION_DATA_NAME,
  useTrueForgeResumeUnavailable,
} from '@truefoundry/trueforge-assistant-ui-runtime';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { withSessionProps } from '../analytics/sessionProps.js';
import { useSlowActivityLabel } from '../hooks/useSlowActivityLabel.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { computeAgentStepsSplit } from '../utils/computeAgentStepsSplit.js';
import { loaderActivityKey, loaderActivityProgress, resolveLoaderLabel } from '../utils/resolveActivityLabel.js';
import { AgentStepsContainer } from './AgentStepsContainer.js';
import { AssistantTextContainer } from './AssistantTextContainer.js';
import { ContextCompactionContainer } from './ContextCompactionContainer.js';
import { MessageImageContainer } from './MessageImageContainer.js';
import { ReasoningContainer } from './ReasoningContainer.js';
import { ToolCallContainer } from './ToolCallContainer.js';
import type { ThreadGroupPart } from './ToolGroupContainer.js';

/**
 * Dispatches a leaf message part to its renderer. Known `data` parts (context
 * compaction) render here; other data / generative UI parts stay out of scope.
 */
function AssistantLeafPartContainer({ part }: { part: EnrichedPartState }) {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return <AssistantTextContainer />;
    case 'image':
      return <MessageImageContainer />;
    case 'tool-call':
      return <ToolCallContainer {...part} />;
    case 'data':
      if (part.name === CONTEXT_COMPACTION_DATA_NAME) {
        return <ContextCompactionContainer />;
      }
      return null;
    default:
      return null;
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
  const cancelledBanner =
    messageStatus?.type === 'incomplete' && messageStatus.reason === 'cancelled'
      ? (cancellationReason ?? 'cancelled')
      : undefined;

  const { cutIndex, hasFinal, toolCount, thinkingCount } = computeAgentStepsSplit(parts, isMessageRunning);

  // Built-in indicator modes hide the loader while reasoning streams; we want it there too.
  const showIndicator = isMessageRunning && !resumeUnavailable && parts[parts.length - 1]?.type !== 'text';
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
      return ['group-agentSteps'];
    }

    return null;
  };

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
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        {showIndicator ? <MessageIndicator label={loaderLabel} /> : null}
      </AssistantMessageBubble>
    </MessagePrimitive.Root>
  );
}
