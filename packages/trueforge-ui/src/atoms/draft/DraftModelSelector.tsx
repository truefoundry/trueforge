'use client';

import { useTrueForgeAgentSpec, useTrueForgeUpdateAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useEffect, useId, useRef, useState } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { Icon } from '../../icons/Icon.js';
import { isSettingsChromeEnabled } from '../../server/serverChrome.js';
import { useOptionalCatalogServer, useServerCapabilities } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { BottomSheet } from '../primitives/BottomSheet.js';
import { Button } from '../primitives/Button.js';
import { Tooltip } from '../primitives/Tooltip.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';
import { displayModelLabel, DraftModelCatalogPanel, ModelWarningMark, ProviderMark } from './DraftModelCatalogPanel.js';
import { modelPatchWithReasoningEffort } from './reasoningEffort.js';

export type DraftModelSelectorProps = {
  disabled?: boolean;
  isRunning?: boolean;
};

export function DraftModelSelector({ disabled, isRunning }: DraftModelSelectorProps) {
  const { models, loading, loaded, ensureLoaded } = useDraftCatalog();
  const { agentSpec } = useTrueForgeAgentSpec();
  const updateAgentSpec = useTrueForgeUpdateAgentSpec();
  const catalog = useOptionalCatalogServer();
  const capabilities = useServerCapabilities();
  const shell = useOptionalShellMode();
  const track = useTrackAnalytics();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isMobile = useIsMobile();
  const compactLayout = useCompactLayout();
  const settingsChromeEnabled = isSettingsChromeEnabled({ catalog, capabilities });
  const showConfigureSettingsCta = loaded && models.length === 0 && settingsChromeEnabled && shell != null;
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
  const selectedWarning = selected?.warning?.trim();
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

  if (showConfigureSettingsCta) {
    return (
      <Button.Ghost
        type="button"
        size="small"
        disabled={disabled || isRunning}
        aria-label="Configure model"
        className="h-8 max-w-48 rounded-full px-2 text-xs font-medium"
        onClick={() => {
          if (!shell?.settingsOpen) track(AnalyticsEvents.Settings.OPENED);
          shell?.setSettingsOpen(true, 'models');
        }}
      >
        Configure model
      </Button.Ghost>
    );
  }

  const account = selected?.provider.name ?? selectedName;

  const content = (
    <DraftModelCatalogPanel
      models={models}
      loading={loading}
      selectedName={selectedName}
      query={query}
      onQueryChange={setQuery}
      listboxId={menuId}
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
    <div ref={containerRef} className="relative flex min-w-0 items-center gap-1">
      <Tooltip content={selectedName || 'Select model'} className="max-w-xs whitespace-normal break-all">
        <button
          type="button"
          disabled={disabled || isRunning}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label="Select model"
          className={auiButtonClass({
            variant: 'ghost',
            size: 'small',
            className: cn('h-8 max-w-48 gap-1.5 rounded-full px-2 text-xs font-medium', 'hover:bg-ghost-button-hover'),
          })}
          onClick={() => setOpen(v => !v)}
        >
          <ProviderMark logo={selected?.provider.logo} label={account} className="size-4 text-xs" />
          <span className="truncate">{label}</span>
          <Icon name="chevron-down" className="size-3.5 shrink-0 opacity-60" />
        </button>
      </Tooltip>
      {selectedWarning ? <ModelWarningMark warning={selectedWarning} side="bottom" /> : null}

      {open ? (
        isMobile || compactLayout ? (
          <BottomSheet open onOpenChange={setOpen} aria-label="Select model">
            {content}
          </BottomSheet>
        ) : (
          <div className="aui-popup-enter bg-card-bg text-text-primary absolute right-0 bottom-full z-50 mb-2 flex max-h-[22rem] w-[18rem] flex-col overflow-hidden rounded-lg border border-border shadow-lg">
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
