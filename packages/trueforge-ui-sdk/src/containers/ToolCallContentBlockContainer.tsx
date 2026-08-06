'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ToolCallContentBlockProps } from '../atoms/ToolCallContentBlock.js';
import { useSlot } from '../theme/SlotsProvider.js';

export function ToolCallContentBlockContainer(props: ToolCallContentBlockProps) {
  const ToolCallContentBlock = useSlot('ToolCallContentBlock');
  const [fullscreen, setFullscreen] = useState(false);
  const [contentHeightRem, setContentHeightRem] = useState(1.5);
  const observerRef = useRef<ResizeObserver | null>(null);

  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!props.resizable || node == null) return;

      const updateHeight = () => setContentHeightRem(node.scrollHeight / 16);
      updateHeight();
      observerRef.current = new ResizeObserver(updateHeight);
      observerRef.current.observe(node);
    },
    [props.resizable],
  );

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
    },
    [],
  );

  return (
    <ToolCallContentBlock
      {...props}
      fullscreen={fullscreen}
      onFullscreenChange={setFullscreen}
      contentHeightRem={contentHeightRem}
      contentRef={contentRef}
    />
  );
}
