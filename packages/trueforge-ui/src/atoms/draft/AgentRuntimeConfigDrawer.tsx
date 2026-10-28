'use client';

import { Icon } from '../../icons/Icon.js';
import type { AgentSpec } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { SideDrawer } from '../primitives/SideDrawer.js';

const RUNTIME_CONFIG_DOCS_URL = 'https://trueforge.dev/create-agent/overview';

function RuntimeConfigDocsLink() {
  return (
    <a
      href={RUNTIME_CONFIG_DOCS_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="View docs"
      className="text-text-secondary hover:text-text-primary inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
    >
      <Icon name="circle-question" className="size-4" />
    </a>
  );
}

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
      titleAccessory={<RuntimeConfigDocsLink />}
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
