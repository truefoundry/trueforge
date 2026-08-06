'use client';

import { useAuiState } from '@assistant-ui/react';
import { useCallback, useRef, useState } from 'react';

import { useSlot } from '../theme/SlotsProvider.js';
import type { ThreadGroupPart } from './ToolGroupContainer.js';

export function ReasoningContainer({ group }: { group: ThreadGroupPart }) {
  const ReasoningCard = useSlot('ReasoningCard');

  const content = useAuiState(s =>
    group.indices
      .map(i => s.message.parts[i])
      .filter((p): p is NonNullable<typeof p> => p != null && p.type === 'reasoning')
      .map(p => (p as { text?: string }).text ?? '')
      .join(''),
  );

  const streaming = useAuiState(s => {
    if (s.message.status?.type !== 'running') return false;
    const lastIndex = s.message.parts.length - 1;
    if (lastIndex < 0) return false;
    if (s.message.parts[lastIndex]?.type !== 'reasoning') return false;
    const lastGroupIndex = group.indices[group.indices.length - 1];
    return lastGroupIndex !== undefined && lastIndex >= group.indices[0]! && lastIndex <= lastGroupIndex;
  });

  const [expanded, setExpanded] = useState(streaming);
  const [prevStreaming, setPrevStreaming] = useState(streaming);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const observerRef = useRef<ResizeObserver | null>(null);
  if (streaming !== prevStreaming) {
    setPrevStreaming(streaming);
    if (streaming) setExpanded(true);
  }

  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (node == null || streaming) return;

      const check = () => {
        const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight) || 24;
        setIsMultiLine(node.scrollHeight > lineHeight * 1.5);
      };

      check();
      observerRef.current = new ResizeObserver(check);
      observerRef.current.observe(node);
    },
    [streaming],
  );
  const reasoningTimeText = null;
  const previewText = content.replace(/\s+/g, ' ').trim();
  const isShortText = !streaming && content.length > 0 && !isMultiLine;
  const headingText = 'Reasoning';

  return (
    <ReasoningCard
      content={content}
      isStreaming={streaming}
      expanded={expanded}
      isMultiLine={isMultiLine}
      reasoningTimeText={reasoningTimeText}
      previewText={previewText}
      headingText={headingText}
      contentRef={isShortText ? contentRef : undefined}
      onToggle={() => setExpanded(prev => !prev)}
    />
  );
}
