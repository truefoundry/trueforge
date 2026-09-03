'use client';

import { useId, useState } from 'react';

import type { AgentSpec, ModelSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { cn } from '../lib/cn.js';
import { DraftModelCatalogPanel } from './DraftModelCatalogPanel.js';
import { modelPatchWithReasoningEffort } from './reasoningEffort.js';

export type AgentModelEditorContentProps = {
  editor: 'model' | 'model-settings';
  spec: AgentSpec;
  models: ModelSelection[];
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onChange: (spec: AgentSpec) => void;
};

function modelForSelection(spec: AgentSpec, model: ModelSelection): AgentSpec['model'] {
  const next = modelPatchWithReasoningEffort(model.name, spec.model.params, model.properties.reasoningEfforts);
  const maxOutputTokens = model.properties.maxOutputTokens;
  if (
    maxOutputTokens === undefined ||
    next.params?.maxTokens === undefined ||
    next.params.maxTokens <= maxOutputTokens
  ) {
    return next;
  }
  return { ...next, params: { ...next.params, maxTokens: maxOutputTokens } };
}

export function AgentModelEditorContent({
  editor,
  spec,
  models,
  loading,
  error,
  query,
  onQueryChange,
  onChange,
}: AgentModelEditorContentProps) {
  const listboxId = useId();
  const AgentModelSettingsContent = useSlot('AgentModelSettingsContent');
  const selectedModel = models.find(model => model.name === spec.model.name);
  const providers = Array.from(new Set(models.map(model => model.provider.name)));
  const [provider, setProvider] = useState(selectedModel?.provider.name ?? providers[0] ?? '');
  const effectiveProvider = providers.includes(provider)
    ? provider
    : (selectedModel?.provider.name ?? providers[0] ?? '');

  if (editor === 'model') {
    return (
      <div className="grid h-[min(32rem,calc(100dvh-8rem))] w-full min-w-0 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden">
        {error ? <p className="text-failure-bg px-3 pt-3 text-sm">{error}</p> : null}
        <div className="min-h-0 overflow-y-auto border-r border-border p-2">
          {providers.map(name => (
            <button
              key={name}
              type="button"
              className={cn(
                'text-text-secondary mb-1 w-full truncate rounded-md px-2 py-2 text-left text-xs',
                effectiveProvider === name && 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text',
              )}
              onClick={() => setProvider(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <DraftModelCatalogPanel
            models={models.filter(model => model.provider.name === effectiveProvider)}
            loading={loading}
            selectedName={spec.model.name}
            query={query}
            onQueryChange={onQueryChange}
            listboxId={listboxId}
            showHeading={false}
            onSelect={model => onChange({ ...spec, model: modelForSelection(spec, model) })}
          />
        </div>
      </div>
    );
  }

  return <AgentModelSettingsContent spec={spec} model={selectedModel} onChange={onChange} />;
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentModelEditorContent: typeof AgentModelEditorContent;
  }
}
