'use client';

import type { AgentSpec, ModelSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { CenteredModal } from '../primitives/CenteredModal.js';

export type AgentModelConfigModalProps = {
  editor: 'model' | 'model-settings' | null;
  spec: AgentSpec;
  models: ModelSelection[];
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onChange: (spec: AgentSpec) => void;
  onClose: () => void;
};

export function AgentModelConfigModal({
  editor,
  spec,
  models,
  loading,
  error,
  query,
  onQueryChange,
  onChange,
  onClose,
}: AgentModelConfigModalProps) {
  const AgentModelEditorContent = useSlot('AgentModelEditorContent');
  const selectingModel = editor === 'model';

  return (
    <CenteredModal
      open={editor !== null}
      onOpenChange={open => !open && onClose()}
      title={selectingModel ? 'Select model' : 'Model settings'}
      className={
        selectingModel
          ? 'md:w-[min(52rem,calc(100%-3rem))] md:max-w-5xl'
          : 'md:w-[min(36rem,calc(100%-3rem))] md:max-w-xl'
      }
      contentSized
      aria-label={selectingModel ? 'Edit model' : 'Edit model settings'}
    >
      {editor ? (
        <AgentModelEditorContent
          editor={editor}
          spec={spec}
          models={models}
          loading={loading}
          error={error}
          query={query}
          onQueryChange={onQueryChange}
          onChange={onChange}
        />
      ) : null}
    </CenteredModal>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentModelConfigModal: typeof AgentModelConfigModal;
  }
}
