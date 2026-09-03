'use client';

import type { AgentSpec } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { CenteredModal } from '../primitives/CenteredModal.js';

export type AgentRuntimeConfigModalProps = {
  open: boolean;
  spec: AgentSpec;
  sandboxAvailable: boolean;
  onChange: (spec: AgentSpec) => void;
  onClose: () => void;
};

export function AgentRuntimeConfigModal({
  open,
  spec,
  sandboxAvailable,
  onChange,
  onClose,
}: AgentRuntimeConfigModalProps) {
  const AgentRuntimeEditorContent = useSlot('AgentRuntimeEditorContent');

  return (
    <CenteredModal
      open={open}
      onOpenChange={nextOpen => !nextOpen && onClose()}
      title="Runtime Config"
      className="md:w-[min(56rem,calc(100%-3rem))] md:max-w-4xl"
      contentSized
      aria-label="Edit Runtime Config"
    >
      <AgentRuntimeEditorContent spec={spec} sandboxAvailable={sandboxAvailable} onChange={onChange} />
    </CenteredModal>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentRuntimeConfigModal: typeof AgentRuntimeConfigModal;
  }
}
