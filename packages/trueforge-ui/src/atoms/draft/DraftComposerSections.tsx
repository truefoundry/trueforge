'use client';

import { Icon } from '../../icons/Icon.js';
import { shellIsCreateAgent, useOptionalShellMode } from '../../server/ShellModeContext.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import type { ComposerLeftSectionProps, ComposerRightSectionProps } from '../ComposerSections.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { Tooltip } from '../primitives/Tooltip.js';
import { DraftReasoningEffortSelector } from './DraftReasoningEffortSelector.js';

export function DraftComposerLeftSection({ disabled, isRunning, onAttach }: ComposerLeftSectionProps) {
  const shell = useOptionalShellMode();
  const DraftCompositeSelector = useSlot('DraftCompositeSelector');
  const DraftAgentConfigTrigger = useSlot('DraftAgentConfigTrigger');
  const compact = useCompactLayout();
  const isMobile = useIsMobile();
  const isBuilder = shell != null && shellIsCreateAgent(shell.mode);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {!isBuilder ? <DraftCompositeSelector disabled={disabled} isRunning={isRunning} onAttach={onAttach} /> : null}
      {isBuilder && (compact || isMobile) ? (
        <DraftAgentConfigTrigger disabled={disabled} isRunning={isRunning} />
      ) : null}
      {isBuilder && onAttach != null ? (
        <Tooltip content="Attach a file">
          <button
            type="button"
            disabled={disabled || isRunning}
            aria-label="Attach a file"
            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
            onClick={onAttach}
          >
            <Icon name="paperclip" />
          </button>
        </Tooltip>
      ) : null}
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
