'use client';

import { useAuiState, type MessagePrimitive } from '@assistant-ui/react';
import { useState, type PropsWithChildren, type ReactNode } from 'react';

import type { AgentStepStatus } from '../atoms/agent-chat/AgentStepRow.js';
import { useSlot } from '../theme/SlotsProvider.js';

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

// One group row stands for several calls, so we show the most urgent state: running (incl. waiting on approval)
// beats error, and error beats success, so a failure is not hidden behind a green check.
function aggregateToolGroupStatus(
  parts: readonly { status?: { type?: string }; isError?: boolean }[],
): AgentStepStatus {
  let hasRunning = false;
  let hasError = false;
  let hasSuccess = false;
  for (const part of parts) {
    const statusType = part.status?.type;
    if (statusType === 'running' || statusType === 'requires-action') {
      hasRunning = true;
      continue;
    }
    if (part.isError === true || statusType === 'incomplete') {
      hasError = true;
      continue;
    }
    if (statusType === 'complete') {
      hasSuccess = true;
    }
  }
  if (hasRunning) return 'running';
  if (hasError) return 'error';
  if (hasSuccess) return 'success';
  return 'idle';
}

export function ToolGroupContainer({ children, group }: PropsWithChildren<{ group: ThreadGroupPart }>) {
  const ToolGroupCard = useSlot('ToolGroupCard');

  const toolCallCount = group.indices.length;

  const status = useAuiState(s => {
    const parts = group.indices
      .map(i => s.message.parts[i])
      .filter((p): p is NonNullable<typeof p> => p != null && p.type === 'tool-call');
    return aggregateToolGroupStatus(parts);
  });

  const [expanded, setExpanded] = useState(true);
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    // When any call in the group starts running again (e.g. after approval), we re-open the group so progress
    // is visible even if the user collapsed it.
    if (status === 'running') setExpanded(true);
  }

  return (
    <ToolGroupCard
      toolCallCount={toolCallCount}
      expanded={expanded}
      status={status}
      onToggle={() => setExpanded(prev => !prev)}
    >
      {children as ReactNode}
    </ToolGroupCard>
  );
}
