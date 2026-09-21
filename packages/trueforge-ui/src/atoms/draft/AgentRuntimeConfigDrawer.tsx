'use client';

import type { AgentSpec } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { SideDrawer } from '../primitives/SideDrawer.js';

export type AgentRuntimeConfigDrawerProps = {
  open: boolean;
  spec: AgentSpec;
  sandboxAvailable: boolean;
  webSearchAvailable?: boolean;
  onChange: (spec: AgentSpec) => void;
  onClose: () => void;
};

export function AgentRuntimeConfigDrawer({
  open,
  spec,
  sandboxAvailable,
  webSearchAvailable = false,
  onChange,
  onClose,
}: AgentRuntimeConfigDrawerProps) {
  const AgentRuntimeEditorContent = useSlot('AgentRuntimeEditorContent');

  return (
    <SideDrawer
      open={open}
      onOpenChange={nextOpen => !nextOpen && onClose()}
      title="Runtime Config"
      description="Control execution, sandbox, and context behavior."
      anchor="right"
      size="xl"
      className="md:w-3xl"
      aria-label="Edit Runtime Config"
    >
      <AgentRuntimeEditorContent
        spec={spec}
        sandboxAvailable={sandboxAvailable}
        webSearchAvailable={webSearchAvailable}
        onChange={onChange}
      />
    </SideDrawer>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentRuntimeConfigDrawer: typeof AgentRuntimeConfigDrawer;
  }
}
