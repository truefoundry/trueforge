'use client';

import { useSlot } from '../../theme/SlotsProvider.js';
import type { ComposerLeftSectionProps, ComposerRightSectionProps } from '../ComposerSections.js';
import { DraftReasoningEffortSelector } from './DraftReasoningEffortSelector.js';

export function DraftComposerLeftSection({ disabled, isRunning, onAttach }: ComposerLeftSectionProps) {
  const DraftCompositeSelector = useSlot('DraftCompositeSelector');

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <DraftCompositeSelector disabled={disabled} isRunning={isRunning} onAttach={onAttach} />
    </div>
  );
}

export function DraftComposerRightSection({ disabled, isRunning }: ComposerRightSectionProps) {
  const DraftModelSelector = useSlot('DraftModelSelector');

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DraftModelSelector disabled={disabled} isRunning={isRunning} />
      <DraftReasoningEffortSelector disabled={disabled} isRunning={isRunning} />
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    DraftComposerLeftSection: typeof DraftComposerLeftSection;
    DraftComposerRightSection: typeof DraftComposerRightSection;
  }
}
