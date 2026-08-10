'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ToolCallContentBlockProps } from '../atoms/ToolCallContentBlock.js';
import { useSlot } from '../theme/SlotsProvider.js';

export function ToolCallContentBlockContainer(props: ToolCallContentBlockProps) {
  const ToolCallContentBlock = useSlot('ToolCallContentBlock');
  const { isJson, onContentHeightChange: notifyContentHeightChange, resizable } = props;
  const [fullscreen, setFullscreen] = useState(false);
  const [contentHeightRem, setContentHeightRem] = useState<number>();
  const observerRef = useRef<ResizeObserver | null>(null);
  const contentNodeRef = useRef<HTMLDivElement | null>(null);
  const hasMeasuredRef = useRef(false);

  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      contentNodeRef.current = node;
      hasMeasuredRef.current = false;
      if (node == null) return;

      setContentHeightRem(undefined);
      if (!resizable) return;

      const updateHeight = () => {
        if (!hasMeasuredRef.current && isJson !== false) return;
        const renderedHeight = node.getBoundingClientRect().height;
        const height = hasMeasuredRef.current && renderedHeight > 0 ? renderedHeight : node.scrollHeight;
        hasMeasuredRef.current = true;
        setContentHeightRem(height / 16);
      };
      updateHeight();
      observerRef.current = new ResizeObserver(updateHeight);
      observerRef.current.observe(node);
    },
    [isJson, resizable],
  );

  const onContentHeightChange = useCallback(
    (height: number) => {
      const node = contentNodeRef.current;
      if (node == null) return;
      const renderedHeight = node.getBoundingClientRect().height;
      hasMeasuredRef.current = true;
      setContentHeightRem((renderedHeight > 0 ? renderedHeight : Math.max(height, node.scrollHeight)) / 16);
      notifyContentHeightChange?.(height);
    },
    [notifyContentHeightChange],
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
      onContentHeightChange={onContentHeightChange}
    />
  );
}
