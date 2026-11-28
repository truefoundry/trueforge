'use client';

import { useMemo } from 'react';
import type { AgentSpec, ModelSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { CenteredModal } from '../primitives/CenteredModal.js';
import { modelSelectionKey } from './autoModel.js';

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
  const AgentModelSettingsContent = useSlot('AgentModelSettingsContent');
  const selectedKey = modelSelectionKey(spec.model);
  const model = useMemo(() => models.find(item => item.name === selectedKey), [models, selectedKey]);
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
      {selectingModel ? (
        <AgentModelEditorContent
          spec={spec}
          models={models}
          loading={loading}
          error={error}
          query={query}
          onQueryChange={onQueryChange}
          onChange={onChange}
          onClose={onClose}
        />
      ) : (
        <AgentModelSettingsContent spec={spec} model={model} onChange={onChange} />
      )}
    </CenteredModal>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentModelConfigModal: typeof AgentModelConfigModal;
  }
}
