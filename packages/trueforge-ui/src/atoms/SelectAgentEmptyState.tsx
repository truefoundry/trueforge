'use client';

import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';

/** Empty main pane when AgentLibrary has no agent selected yet. */
export function SelectAgentEmptyState() {
  const shell = useOptionalShellMode();
  const AgentsLibraryButton = useSlot('AgentsLibraryButton');

  if (shell?.mode.status !== 'idle') return null;

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-4 px-6"
      data-slot="aui_select-agent-empty"
    >
      <p className="text-text-secondary max-w-sm text-center text-sm">Select an agent to start chatting</p>
      <AgentsLibraryButton className="w-56 max-w-full" />
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SelectAgentEmptyState: typeof SelectAgentEmptyState;
  }
}
