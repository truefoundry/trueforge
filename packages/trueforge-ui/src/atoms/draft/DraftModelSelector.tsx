'use client';

import { useTrueForgeAgentSpec, useTrueForgeUpdateAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useEffect, useId, useRef, useState } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { Icon } from '../../icons/Icon.js';
import { isSettingsChromeEnabled } from '../../server/serverChrome.js';
import { useOptionalCatalogServer, useServerCapabilities } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { Model, ModelSelection } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { BottomSheet } from '../primitives/BottomSheet.js';
import { Button } from '../primitives/Button.js';
import { Tooltip } from '../primitives/Tooltip.js';
import { AUTO_MODEL, AUTO_MODEL_PATCH, keepsAutoModel } from './autoModel.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';
import { displayModelLabel, DraftModelCatalogPanel, ModelWarningMark, ProviderMark } from './DraftModelCatalogPanel.js';
import { DraftReasoningEffortMenu } from './DraftReasoningEffortMenu.js';
import {
  hasReasoningEfforts,
  modelPatchWithReasoningEffort,
  reasoningEffortLabel,
  resolveReasoningEffort,
} from './reasoningEffort.js';

type ReasoningEffortTarget = { model: ModelSelection; efforts: string[]; top: number };

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
  const [effortTarget, setEffortTarget] = useState<ReasoningEffortTarget | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isMobile = useIsMobile();
  const compactLayout = useCompactLayout();
  const settingsChromeEnabled = isSettingsChromeEnabled({ catalog, capabilities });
  const showConfigureSettingsCta = loaded && models.length === 0 && settingsChromeEnabled && shell != null;
  const seededDefaultModelRef = useRef<string | null>(null);
  const isAutoModelKept = keepsAutoModel(capabilities);

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
      const available = currentName === AUTO_MODEL ? isAutoModelKept : models.some(m => m.name === currentName);
      if (available) {
        seededDefaultModelRef.current = null;
        return;
      }
    }
    if (seededDefaultModelRef.current === firstValue) return;
    seededDefaultModelRef.current = firstValue;
    updateAgentSpec({
      model: modelPatchWithReasoningEffort(firstValue, agentSpec?.model?.params, first.properties.reasoningEfforts),
    });
  }, [updateAgentSpec, loading, models, isAutoModelKept, agentSpec?.model?.name, agentSpec?.model?.params]);

  const selectedName = agentSpec?.model?.name ?? models[0]?.name ?? '';
  const selected = models.find(m => m.name === selectedName);
  const selectedWarning = selected?.warning?.trim();
  const currentParams = agentSpec?.model?.params;
  const currentEffort = currentParams?.reasoningEffort;
  // Other rows show what selecting them would apply (see `modelPatchWithReasoningEffort`).
  const effortFor = (model: ModelSelection): string | undefined =>
    model.name === selectedName
      ? currentEffort
      : resolveReasoningEffort(model.properties.reasoningEfforts, currentEffort);
  const selectedEffortLabel =
    selected !== undefined && hasReasoningEfforts(selected.properties.reasoningEfforts)
      ? reasoningEffortLabel(currentEffort)
      : undefined;
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
        setEffortTarget(null);
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
  const sheet = isMobile || compactLayout;

  const close = () => {
    setOpen(false);
    setEffortTarget(null);
  };

  const commit = (model: Model) => {
    updateAgentSpec?.({ model });
    close();
    setQuery('');
  };

  const content = (
    <DraftModelCatalogPanel
      models={models}
      loading={loading}
      selectedName={selectedName}
      query={query}
      onQueryChange={next => {
        setQuery(next);
        setEffortTarget(null);
      }}
      listboxId={menuId}
      autoOption={{
        enabled: capabilities?.auto?.enabled === true,
        onSelect: () => commit(AUTO_MODEL_PATCH),
      }}
      reasoning={{
        effortLabel: model =>
          hasReasoningEfforts(model.properties.reasoningEfforts) ? reasoningEffortLabel(effortFor(model)) : undefined,
        editingName: effortTarget?.model.name,
        onEdit: (model, row) => {
          const efforts = model.properties.reasoningEfforts;
          if (effortTarget?.model.name === model.name || !hasReasoningEfforts(efforts)) {
            setEffortTarget(null);
            return;
          }
          const popoverTop = popoverRef.current?.getBoundingClientRect().top ?? 0;
          setEffortTarget({ model, efforts, top: Math.max(0, row.getBoundingClientRect().top - popoverTop) });
        },
      }}
      onSelect={model =>
        commit(modelPatchWithReasoningEffort(model.name, currentParams, model.properties.reasoningEfforts))
      }
    />
  );

  const effortMenu = effortTarget ? (
    <DraftReasoningEffortMenu
      efforts={effortTarget.efforts}
      current={effortFor(effortTarget.model)}
      onBack={sheet ? () => setEffortTarget(null) : undefined}
      onSelect={effort =>
        commit(
          effort === undefined
            ? modelPatchWithReasoningEffort(effortTarget.model.name, currentParams, undefined)
            : modelPatchWithReasoningEffort(
                effortTarget.model.name,
                { ...currentParams, reasoningEffort: effort },
                effortTarget.efforts,
              ),
        )
      }
    />
  ) : null;

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
          onClick={() => (open ? close() : setOpen(true))}
        >
          {selectedName === AUTO_MODEL ? null : (
            <ProviderMark logo={selected?.provider.logo} label={account} className="size-4 text-xs" />
          )}
          <span className="truncate">{label}</span>
          {selectedEffortLabel !== undefined ? (
            <span className="text-text-secondary shrink-0 font-normal">{selectedEffortLabel}</span>
          ) : null}
          <Icon name="chevron-down" className="size-3.5 shrink-0 opacity-60" />
        </button>
      </Tooltip>
      {selectedWarning ? <ModelWarningMark warning={selectedWarning} side="bottom" /> : null}

      {open ? (
        sheet ? (
          <BottomSheet open onOpenChange={next => (next ? setOpen(true) : close())} aria-label="Select model">
            {effortMenu ?? content}
          </BottomSheet>
        ) : (
          <div className="absolute right-0 bottom-full z-50 mb-2">
            <div
              ref={popoverRef}
              className="aui-popup-enter bg-card-bg text-text-primary flex max-h-[22rem] w-[18rem] flex-col overflow-hidden rounded-lg border border-border shadow-lg"
            >
              {content}
            </div>
            {effortTarget ? (
              <div
                className="aui-popup-enter bg-card-bg text-text-primary absolute right-full mr-2 flex max-h-[22rem] w-[11rem] flex-col overflow-hidden rounded-lg border border-border shadow-lg"
                style={{ top: effortTarget.top }}
              >
                {effortMenu}
              </div>
            ) : null}
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
