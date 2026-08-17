'use client';

import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';

export interface AgentStepsContainerProps {
  toolCount: number;
  thinkingCount: number;
  hasFinal: boolean;
}

/**
 * Container for "Agent steps" section — groups reasoning, intermediate text, and tools
 * in a collapsible accordion that auto-collapses once final answer is confirmed.
 */
export function AgentStepsContainer({
  children,
  toolCount,
  thinkingCount,
  hasFinal,
}: PropsWithChildren<AgentStepsContainerProps>) {
  const AgentStepsCard = useSlot('AgentStepsCard');

  const [expanded, setExpanded] = useState(true);
  const collapsedByFinal = useRef(false);

  // Auto-collapse once when hasFinal becomes true (matches AgentTimeline behavior)
  useEffect(() => {
    if (hasFinal && !collapsedByFinal.current) {
      collapsedByFinal.current = true;
      setExpanded(false);
    }
  }, [hasFinal]);

  return (
    <AgentStepsCard
      toolCount={toolCount}
      thinkingCount={thinkingCount}
      expanded={expanded}
      onToggle={() => setExpanded(prev => !prev)}
    >
      {children as ReactNode}
    </AgentStepsCard>
  );
}
