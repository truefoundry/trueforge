'use client';

import { Icon } from '../../icons/Icon.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { Tooltip } from '../primitives/Tooltip.js';

export type DraftAgentConfigTriggerProps = {
  disabled?: boolean;
  isRunning?: boolean;
};

export function DraftAgentConfigTrigger({ disabled, isRunning }: DraftAgentConfigTriggerProps) {
  const shell = useOptionalShellMode();
  const open = shell?.agentConfigOpen === true;

  return (
    <Tooltip content="Agent config">
      <button
        type="button"
        aria-label="Agent config"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled || isRunning || shell == null}
        className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-8' })}
        onClick={() => shell?.setAgentConfigOpen(!open)}
      >
        <Icon name="sliders" className="size-3.5" />
      </button>
    </Tooltip>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    DraftAgentConfigTrigger: typeof DraftAgentConfigTrigger;
  }
}
