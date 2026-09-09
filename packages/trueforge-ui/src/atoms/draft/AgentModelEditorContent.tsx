'use client';

import { useId, useMemo, useState } from 'react';

import { Icon } from '@/icons/Icon.js';
import type { AgentSpec, ModelSelection } from '../../server/types.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { DraftModelCatalogPanel } from './DraftModelCatalogPanel.js';
import { modelMatchesQuery, normalizeModelSearchText, providerMatchesQuery } from './modelSearch.js';
import { modelPatchWithReasoningEffort } from './reasoningEffort.js';

export type AgentModelEditorContentProps = {
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
  spec,
  models,
  loading,
  error,
  query,
  onQueryChange,
  onChange,
}: AgentModelEditorContentProps) {
  const listboxId = useId();
  const selectedModel = useMemo(() => models.find(model => model.name === spec.model.name), [models, spec.model.name]);
  const providers = useMemo(() => Array.from(new Set(models.map(model => model.provider.name))), [models]);
  const [provider, setProvider] = useState(selectedModel?.provider.name ?? providers[0] ?? '');
  const needle = normalizeModelSearchText(query);
  const matchingProviders = useMemo(
    () =>
      providers
        .map(name => {
          const providerModels = models.filter(model => model.provider.name === name);
          return {
            name,
            models: providerMatchesQuery({ providerName: name, needle })
              ? providerModels
              : providerModels.filter(model => modelMatchesQuery({ model, needle })),
          };
        })
        .filter(item => item.models.length > 0),
    [models, needle, providers],
  );
  const visibleProviders = useMemo(() => matchingProviders.map(item => item.name), [matchingProviders]);
  const effectiveProvider = useMemo(
    () =>
      visibleProviders.includes(provider)
        ? provider
        : selectedModel && visibleProviders.includes(selectedModel.provider.name)
          ? selectedModel.provider.name
          : (visibleProviders[0] ?? ''),
    [provider, selectedModel, visibleProviders],
  );
  const visibleModels = useMemo(
    () => matchingProviders.find(item => item.name === effectiveProvider)?.models ?? [],
    [effectiveProvider, matchingProviders],
  );

  return (
    <div>
      <div className="border-b border-border px-3 py-2">
        <p className="text-text-primary mb-2 text-base font-medium">Select model</p>
        <label className="relative block">
          <Icon
            name="search"
            className="text-text-secondary pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
          />
          <input
            type="search"
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="Search"
            className={auiInputClass('h-8 py-1 pr-2 pl-7')}
            autoFocus
          />
        </label>
      </div>
      {error ? <p className="text-failure-bg px-3 pt-3 text-sm">{error}</p> : null}
      <div className="grid h-[min(22rem,calc(100dvh-8rem))] w-full min-w-0 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden">
        <div className="min-h-0 overflow-y-auto border-r border-border p-2">
          {visibleProviders.map(name => (
            <button
              key={name}
              type="button"
              className={cn(
                'text-text-secondary mb-1 w-full truncate rounded-md px-2 py-2 text-left text-xs',
                effectiveProvider === name &&
                  'bg-primary-button-bg/10 border border-primary-button-bg font-medium text-primary-button-bg',
              )}
              onClick={() => setProvider(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <DraftModelCatalogPanel
            models={visibleModels}
            loading={loading}
            selectedName={spec.model.name}
            query={query}
            onQueryChange={onQueryChange}
            listboxId={listboxId}
            showHeading={false}
            showSearch={false}
            onSelect={model => onChange({ ...spec, model: modelForSelection(spec, model) })}
          />
        </div>
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentModelEditorContent: typeof AgentModelEditorContent;
  }
}
