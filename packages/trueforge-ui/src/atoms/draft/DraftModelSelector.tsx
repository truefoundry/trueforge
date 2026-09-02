'use client';

import { useTrueFoundryAgentSpec, useTrueFoundryUpdateAgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import { useOptionalCatalogServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { BottomSheet } from '../primitives/BottomSheet.js';
import { Button } from '../primitives/Button.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';
import { displayModelLabel, DraftModelCatalogPanel, ProviderMark } from './DraftModelCatalogPanel.js';
import { modelPatchWithReasoningEffort } from './reasoningEffort.js';

export type DraftModelSelectorProps = {
  disabled?: boolean;
  isRunning?: boolean;
};

export function DraftModelSelector({ disabled, isRunning }: DraftModelSelectorProps) {
  const { models, loading, ensureLoaded } = useDraftCatalog();
  const { agentSpec } = useTrueFoundryAgentSpec();
  const updateAgentSpec = useTrueFoundryUpdateAgentSpec();
  const catalog = useOptionalCatalogServer();
  const shell = useOptionalShellMode();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isMobile = useIsMobile();
  const compactLayout = useCompactLayout();
  const showConfigureSettingsCta = !loading && models.length === 0 && catalog != null;
  const seededDefaultModelRef = useRef<string | null>(null);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  // Keep agentSpec in sync with the visual default: when no model is set (or the
  // current name is not in the catalog), commit the first available catalog model.
  useEffect(() => {
    if (!updateAgentSpec || loading || models.length === 0) return;
    const first = models[0];
    if (first === undefined) return;
    const firstValue = first.name;
    const currentName = agentSpec?.model?.name?.trim() ?? '';
    if (currentName) {
      const inCatalog = models.some(m => m.name === currentName);
      if (inCatalog) {
        seededDefaultModelRef.current = null;
        return;
      }
    }
    if (seededDefaultModelRef.current === firstValue) return;
    seededDefaultModelRef.current = firstValue;
    updateAgentSpec({
      model: modelPatchWithReasoningEffort(firstValue, agentSpec?.model?.params, first.properties.reasoningEfforts),
    });
  }, [updateAgentSpec, loading, models, agentSpec?.model?.name, agentSpec?.model?.params]);

  const selectedName = agentSpec?.model?.name ?? models[0]?.name ?? '';
  const selected = models.find(m => m.name === selectedName);
  const label = selected
    ? displayModelLabel(selected.name)
    : selectedName
      ? displayModelLabel(selectedName)
      : loading
        ? 'Loading…'
        : 'Select model';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const account = selected?.provider.name ?? selectedName;

  const content = (
    <DraftModelCatalogPanel
      models={models}
      loading={loading}
      selectedName={selectedName}
      query={query}
      onQueryChange={setQuery}
      listboxId={menuId}
      onOpenSettings={
        showConfigureSettingsCta
          ? () => {
              setOpen(false);
              setQuery('');
              shell?.setSettingsOpen(true, 'models');
            }
          : undefined
      }
      onSelect={model => {
        updateAgentSpec?.({
          model: modelPatchWithReasoningEffort(model.name, agentSpec?.model?.params, model.properties.reasoningEfforts),
        });
        setOpen(false);
        setQuery('');
      }}
    />
  );

  return (
    <div ref={containerRef} className="relative">
      <Button.Ghost
        type="button"
        disabled={disabled || isRunning}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Select model"
        size="small"
        className="h-8 max-w-48 gap-1.5 rounded-full px-2 text-xs font-medium hover:bg-ghost-button-hover"
        onClick={() => setOpen(v => !v)}
      >
        <ProviderMark logo={selected?.provider.logo} label={account} className="size-4 text-xs" />
        <span className="truncate">{label}</span>
        <Icon name="chevron-down" className="size-3.5 shrink-0 opacity-60" />
      </Button.Ghost>

      {open ? (
        isMobile || compactLayout ? (
          <BottomSheet open onOpenChange={setOpen} aria-label="Select model">
            {content}
          </BottomSheet>
        ) : (
          <div className="bg-card-bg text-text-primary absolute right-0 bottom-full z-50 mb-2 flex max-h-[22rem] w-[18rem] flex-col overflow-hidden rounded-lg border border-border shadow-lg">
            {content}
          </div>
        )
      ) : null}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    DraftModelSelector: typeof DraftModelSelector;
  }
}
