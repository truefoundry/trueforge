'use client';

import { useMemo, useState } from 'react';

import type { SandboxToolCallCardProps } from '../atoms/SandboxToolCallCard.js';
import { useSlot } from '../theme/SlotsProvider.js';

export function SandboxToolCallContainer(
  props: Omit<SandboxToolCallCardProps, 'viewMode' | 'hasContent' | 'onViewModeChange'>,
) {
  const SandboxToolCallCard = useSlot('SandboxToolCallCard');
  const [viewMode, setViewMode] = useState<'terminal' | 'code'>('terminal');
  const hasContent = useMemo(() => {
    if (viewMode === 'code') return Boolean(props.argsJson || props.resultJson);
    return Boolean(props.command || props.resultText || props.resultJson);
  }, [props.argsJson, props.command, props.resultJson, props.resultText, viewMode]);

  return <SandboxToolCallCard {...props} viewMode={viewMode} hasContent={hasContent} onViewModeChange={setViewMode} />;
}
