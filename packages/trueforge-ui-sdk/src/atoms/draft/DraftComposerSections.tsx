'use client';

import type { ComposerLeftSectionProps, ComposerRightSectionProps } from '../ComposerSections.js';
import { DraftCompositeSelector, DraftSelectionChips } from './DraftCompositeSelector.js';
import { DraftModelSelector } from './DraftModelSelector.js';
import { DraftReasoningEffortSelector } from './DraftReasoningEffortSelector.js';

export function DraftComposerLeftSection({ disabled, isRunning, onAttach }: ComposerLeftSectionProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <DraftCompositeSelector disabled={disabled} isRunning={isRunning} onAttach={onAttach} />
      <DraftSelectionChips />
    </div>
  );
}

export function DraftComposerRightSection({ disabled, isRunning }: ComposerRightSectionProps) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <DraftModelSelector disabled={disabled} isRunning={isRunning} />
      <DraftReasoningEffortSelector disabled={disabled} isRunning={isRunning} />
    </div>
  );
}
