'use client';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { withSessionProps } from '../../analytics/sessionProps.js';
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
  const track = useTrackAnalytics();
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
        onClick={() => {
          const nextOpen = !open;
          if (nextOpen) {
            track(
              AnalyticsEvents.Config.OPENED,
              withSessionProps(undefined, {
                ...(shell?.mode.status === 'active'
                  ? { agentId: shell.mode.agentId, agentName: shell.mode.agentName }
                  : {}),
              }),
            );
          }
          shell?.setAgentConfigOpen(nextOpen);
        }}
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
