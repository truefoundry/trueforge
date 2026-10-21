'use client';

import { useTrueForgeAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useState } from 'react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { shellIsCreateAgent, useOptionalShellMode } from '../server/ShellModeContext.js';
import { Button } from './primitives/Button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './primitives/Dialog.js';

// Build Agent only: remount with a clean config panel (model + runtime toggles).
export function ResetAgentBuilderButton() {
  const shell = useOptionalShellMode();
  const { agentSpec } = useTrueForgeAgentSpec();
  const track = useTrackAnalytics();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (shell == null || !shellIsCreateAgent(shell.mode)) return null;

  return (
    <>
      <Button.Ghost type="button" title="Reset playground" onClick={() => setConfirmOpen(true)}>
        <Icon name="rotate-right" size="0.875rem" />
        Reset
      </Button.Ghost>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} aria-label="Reset agent config">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset agent config</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            Instructions, connectors, and skills will be cleared and the chat will restart.
          </p>
          <DialogFooter>
            <Button.Secondary type="button" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button.Secondary>
            <Button.Primary
              type="button"
              onClick={() => {
                track(AnalyticsEvents.Config.RESET);
                shell.resetAgentBuilder(agentSpec ?? undefined);
                setConfirmOpen(false);
              }}
            >
              Reset
            </Button.Primary>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ResetAgentBuilderButton: typeof ResetAgentBuilderButton;
  }
}
