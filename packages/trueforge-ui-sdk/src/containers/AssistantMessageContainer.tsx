'use client';

import { useActionBarCopy, useMessageError, useThreadIsRunning, type PartState } from '@assistant-ui/core/react';
import { MessagePrimitive, useAuiState, type EnrichedPartState, type GroupByContext } from '@assistant-ui/react';
import { useTrueFoundryResumeUnavailable } from '@truefoundry/assistant-ui-runtime';

import { useSlot } from '../theme/SlotsProvider.js';
import { computeAgentStepsSplit } from '../utils/computeAgentStepsSplit.js';
import { AgentStepsContainer } from './AgentStepsContainer.js';
import { AssistantTextContainer } from './AssistantTextContainer.js';
import { MessageImageContainer } from './MessageImageContainer.js';
import { ReasoningContainer } from './ReasoningContainer.js';
import { ToolCallContainer } from './ToolCallContainer.js';
import type { ThreadGroupPart } from './ToolGroupContainer.js';

/**
 * Dispatches a leaf message part to its renderer. "data" parts (generative
 * UI) are out of scope for this SDK entirely.
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
    default:
      return null;
  }
}

export function AssistantMessageContainer() {
  const AssistantMessageBubble = useSlot('AssistantMessageBubble');
  const MessageActionBar = useSlot('MessageActionBar');
  const MessageErrorBanner = useSlot('MessageErrorBanner');
  const MessageIndicator = useSlot('MessageIndicator');
  const isThreadRunning = useThreadIsRunning();
  const resumeUnavailable = useTrueFoundryResumeUnavailable();
  const error = useMessageError();
  const createdAt = useAuiState(s => s.message.createdAt);
  const isMessageRunning = useAuiState(s => s.message.status?.type === 'running');
  const { copy, isCopied } = useActionBarCopy({
    copyToClipboard: text => navigator.clipboard.writeText(text),
  });

  const parts = useAuiState(s => s.message.parts);

  const { cutIndex, hasFinal, toolCount, thinkingCount } = computeAgentStepsSplit(parts, isMessageRunning);

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
        actionBar={
          !isThreadRunning ? <MessageActionBar isCopied={isCopied} onCopy={copy} createdAt={createdAt} /> : undefined
        }
      >
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
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
              case 'indicator':
                return resumeUnavailable ? null : <MessageIndicator />;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
      </AssistantMessageBubble>
    </MessagePrimitive.Root>
  );
}
