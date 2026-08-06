'use client';

import { useAuiState, type MessagePrimitive } from '@assistant-ui/react';
import { useState, type PropsWithChildren, type ReactNode } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

export function ToolGroupContainer({ children, group }: PropsWithChildren<{ group: ThreadGroupPart }>) {
  const ToolGroupCard = useSlot('ToolGroupCard');

  const toolCallCount = group.indices.length;

  const active = useAuiState(s => {
    if (s.message.status?.type !== 'running') return false;
    const lastIndex = s.message.parts.length - 1;
    if (lastIndex < 0) return false;
    if (s.message.parts[lastIndex]?.type !== 'tool-call') return false;
    const lastGroupIndex = group.indices[group.indices.length - 1];
    return lastGroupIndex !== undefined && lastIndex >= group.indices[0]! && lastIndex <= lastGroupIndex;
  });

  const [expanded, setExpanded] = useState(true);
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (active) setExpanded(true);
  }

  return (
    <ToolGroupCard
      toolCallCount={toolCallCount}
      expanded={expanded}
      active={active}
      onToggle={() => setExpanded(prev => !prev)}
    >
      {children as ReactNode}
    </ToolGroupCard>
  );
}
