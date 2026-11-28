'use client';

import { modelParams } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useCallback, useId, useMemo, useState } from 'react';

import { Icon } from '@/icons/Icon.js';
import { useServerCapabilities } from '../../server/ServerContext.js';
import type { AgentSpec, FixedModel, ModelSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { auiInputClass } from '../lib/inputClasses.js';
import {
  AUTO_MODEL_LABEL,
  AUTO_MODEL_PATCH,
  AUTO_MODEL_UNAVAILABLE_HINT,
  autoCandidateNames,
  modelSelectionKey,
} from './autoModel.js';
import { DraftModelCatalogPanel, ProviderMark } from './DraftModelCatalogPanel.js';
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
  /** Lets Cancel and Apply in the Auto view dismiss the picker. */
  onClose?: () => void;
};

function modelForSelection(spec: AgentSpec, model: ModelSelection): FixedModel {
  const next = modelPatchWithReasoningEffort(model.name, modelParams(spec.model), model.properties.reasoningEfforts);
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

type AutoRailEntryProps = {
  active: boolean;
  /** Candidates the agent routes among; shown only while Auto is the agent's model. */
  count: number | undefined;
  disabledHint: string | undefined;
  onSelect: () => void;
};

/** Auto sits above the provider list, set apart by a separator, because it is not a provider. */
function AutoRailEntry({ active, count, disabledHint, onSelect }: AutoRailEntryProps) {
  return (
    <button
      type="button"
      disabled={disabledHint !== undefined}
      title={disabledHint}
      aria-pressed={active}
      className={cn(
        'text-text-secondary mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50',
        active && 'bg-primary-button-bg/10 border border-primary-button-bg font-medium text-primary-button-bg',
      )}
      onClick={onSelect}
    >
      <Icon name="wand" className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{AUTO_MODEL_LABEL}</span>
      {count === undefined ? null : <span className="shrink-0 text-[0.625rem]">{count}</span>}
    </button>
  );
}

export function AgentModelEditorContent({
  spec,
  models,
  loading,
  error,
  query,
  onQueryChange,
  onChange,
  onClose,
}: AgentModelEditorContentProps) {
  const AutoModelCandidatesPanel = useSlot('AutoModelCandidatesPanel');
  const listboxId = useId();
  const compact = useCompactLayout();
  const capabilities = useServerCapabilities();
  const selectedKey = modelSelectionKey(spec.model);
  const selectedModel = useMemo(() => models.find(model => model.name === selectedKey), [models, selectedKey]);
  const providers = useMemo(() => Array.from(new Set(models.map(model => model.provider.name))), [models]);
  const [provider, setProvider] = useState(selectedModel?.provider.name ?? providers[0] ?? '');
  const [compactProvider, setCompactProvider] = useState<string | null>(null);
  // `null` until the user picks a side, so Auto is open by default only while it is the agent's model.
  const [autoOpen, setAutoOpen] = useState<boolean | null>(null);
  const [compactAutoOpen, setCompactAutoOpen] = useState(false);
  const needle = normalizeModelSearchText(query);

  const autoAvailable = capabilities != null && capabilities.auto.status !== 'not_configured';
  const autoDisabledHint =
    capabilities != null && capabilities.auto.status === 'disabled'
      ? (capabilities.auto.reason ?? AUTO_MODEL_UNAVAILABLE_HINT)
      : undefined;
  const autoActive = autoAvailable && autoDisabledHint === undefined && (autoOpen ?? spec.model.type === 'auto');
  const savedCandidates = autoCandidateNames({
    model: spec.model.type === 'auto' ? spec.model : AUTO_MODEL_PATCH,
    models,
  });
  const autoCount = spec.model.type === 'auto' ? savedCandidates.length : undefined;
  const showAutoEntry = autoAvailable && (autoActive || normalizeModelSearchText(AUTO_MODEL_LABEL).includes(needle));

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
  const compactModels = useMemo(() => {
    if (compactProvider === null) return [];
    const providerModels = models.filter(model => model.provider.name === compactProvider);
    return needle ? providerModels.filter(model => modelMatchesQuery({ model, needle })) : providerModels;
  }, [compactProvider, models, needle]);

  const handleBackToProviders = useCallback(() => {
    onQueryChange('');
    setCompactProvider(null);
    setCompactAutoOpen(false);
  }, [onQueryChange]);

  const applyAuto = (candidateModels: string[]) => {
    onChange({ ...spec, model: { type: 'auto', candidateModels } });
    onClose?.();
  };

  const autoPanel = (
    <AutoModelCandidatesPanel
      models={models}
      saved={savedCandidates}
      query={query}
      onApply={applyAuto}
      onCancel={() => onClose?.()}
    />
  );

  const search = (
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
  );

  if (compact) {
    if (compactProvider === null && !compactAutoOpen) {
      return (
        <div className="flex min-h-0 flex-auto flex-col">
          <div className="shrink-0 border-b border-border px-3 py-2">
            <p className="text-text-primary mb-2 text-base font-medium">Select provider</p>
            {search}
          </div>
          {error ? <p className="text-failure-bg px-3 pt-3 text-sm">{error}</p> : null}
          <div className="min-h-0 flex-auto overflow-y-auto p-2">
            {showAutoEntry ? (
              <>
                <button
                  type="button"
                  disabled={autoDisabledHint !== undefined}
                  title={autoDisabledHint}
                  className="hover:bg-ghost-button-hover flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setCompactAutoOpen(true)}
                >
                  <Icon name="wand" className="size-5 shrink-0 p-0.5" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{AUTO_MODEL_LABEL}</span>
                  {autoCount === undefined ? null : (
                    <span className="text-text-secondary shrink-0 text-xs">{autoCount}</span>
                  )}
                  <Icon name="chevron-right" className="text-text-secondary size-4 shrink-0" />
                </button>
                <div aria-hidden className="mx-2 my-1 border-t border-border" />
              </>
            ) : null}
            {visibleProviders.length === 0 ? (
              showAutoEntry ? null : (
                <p className="text-text-secondary px-2 py-6 text-center text-sm" role="status">
                  {loading ? 'Loading…' : 'No providers'}
                </p>
              )
            ) : (
              visibleProviders.map(name => {
                const providerModel = models.find(model => model.provider.name === name);
                return (
                  <button
                    key={name}
                    type="button"
                    className="hover:bg-ghost-button-hover flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm"
                    onClick={() => setCompactProvider(name)}
                  >
                    <ProviderMark logo={providerModel?.provider.logo} label={name} className="size-5 text-xs" />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <Icon name="chevron-right" className="text-text-secondary size-4 shrink-0" />
                  </button>
                );
              })
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-auto flex-col">
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="mb-2 flex items-center gap-1">
            <button
              type="button"
              aria-label="Back to providers"
              title="Back to providers"
              className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7 shrink-0' })}
              onClick={handleBackToProviders}
            >
              <Icon name="arrow-left" className="size-4" />
            </button>
            <p className="text-text-primary min-w-0 flex-1 truncate text-base font-medium">Select Model</p>
          </div>
          {search}
        </div>
        {error ? <p className="text-failure-bg px-3 pt-3 text-sm">{error}</p> : null}
        {compactAutoOpen ? (
          autoPanel
        ) : (
          <DraftModelCatalogPanel
            models={compactModels}
            loading={loading}
            selectedName={selectedKey}
            query=""
            onQueryChange={onQueryChange}
            listboxId={listboxId}
            autoOption={undefined}
            reasoning={undefined}
            showHeading={false}
            showSearch={false}
            onSelect={model => onChange({ ...spec, model: modelForSelection(spec, model) })}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-border px-3 py-2">
        <p className="text-text-primary mb-2 text-base font-medium">Select model</p>
        {search}
      </div>
      {error ? <p className="text-failure-bg px-3 pt-3 text-sm">{error}</p> : null}
      <div className="grid h-[min(22rem,calc(100dvh-8rem))] w-full min-w-0 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden">
        <div className="min-h-0 overflow-y-auto border-r border-border p-2">
          {showAutoEntry ? (
            <>
              <AutoRailEntry
                active={autoActive}
                count={autoCount}
                disabledHint={autoDisabledHint}
                onSelect={() => setAutoOpen(true)}
              />
              <div aria-hidden className="mx-1 mb-2 border-t border-border" />
            </>
          ) : null}
          {visibleProviders.length > 0 ? (
            <p className="text-text-secondary px-2 pb-1.5 text-[0.625rem] font-semibold tracking-wide uppercase">
              Provider
            </p>
          ) : null}
          {visibleProviders.map(name => (
            <button
              key={name}
              type="button"
              className={cn(
                'text-text-secondary mb-1 w-full truncate rounded-md px-2 py-2 text-left text-xs',
                !autoActive &&
                  effectiveProvider === name &&
                  'bg-primary-button-bg/10 border border-primary-button-bg font-medium text-primary-button-bg',
              )}
              onClick={() => {
                setProvider(name);
                setAutoOpen(false);
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {autoActive ? (
            autoPanel
          ) : (
            <DraftModelCatalogPanel
              models={visibleModels}
              loading={loading}
              selectedName={selectedKey}
              query={query}
              onQueryChange={onQueryChange}
              listboxId={listboxId}
              autoOption={undefined}
              reasoning={undefined}
              showHeading={false}
              showSearch={false}
              onSelect={model => onChange({ ...spec, model: modelForSelection(spec, model) })}
            />
          )}
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
