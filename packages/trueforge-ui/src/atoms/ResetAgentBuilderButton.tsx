'use client';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { shellIsCreateAgent, useOptionalShellMode } from '../server/ShellModeContext.js';
import { Button } from './primitives/Button.js';

// Build Agent only: remount with a clean config panel (model + runtime toggles).
export function ResetAgentBuilderButton() {
  const shell = useOptionalShellMode();
  const track = useTrackAnalytics();

  if (shell == null || !shellIsCreateAgent(shell.mode)) return null;

  return (
    <Button.Secondary
      type="button"
      title="Reset playground"
      onClick={() => {
        track(AnalyticsEvents.Config.RESET);
        shell.resetAgentBuilder();
      }}
    >
      <Icon name="rotate-right" size="0.875rem" />
      Reset
    </Button.Secondary>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ResetAgentBuilderButton: typeof ResetAgentBuilderButton;
  }
}
