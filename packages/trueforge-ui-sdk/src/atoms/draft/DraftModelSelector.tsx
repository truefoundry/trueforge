'use client';

import { useTrueFoundryAgentSpec, useTrueFoundryUpdateAgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import { useOptionalCatalogServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { ModelSelection } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { BottomSheet } from '../primitives/BottomSheet.js';
import { CatalogLogo } from '../primitives/CatalogLogo.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';
import { modelPatchWithReasoningEffort } from './reasoningEffort.js';

function monogram(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

function ProviderMark({ logo, label, className }: { logo?: string; label: string; className?: string }) {
  if (logo) {
    return <CatalogLogo src={logo} alt="" className={cn('shrink-0 rounded object-contain', className)} aria-hidden />;
  }
  return (
    <span
      className={cn(
        'bg-secondary-bg text-text-secondary flex shrink-0 items-center justify-center rounded font-semibold',
        className,
      )}
      aria-hidden
    >
      {monogram(label)}
    </span>
  );
}

function displayModelLabel(modelName: string): string {
  const slash = modelName.lastIndexOf('/');
  return slash >= 0 ? modelName.slice(slash + 1) : modelName;
}

type ProviderSection = {
  name: string;
  logo?: string;
  models: ModelSelection[];
};

function groupModelsByProvider(models: ModelSelection[]): ProviderSection[] {
  const sections: ProviderSection[] = [];
  const byProvider = new Map<string, ProviderSection>();
  for (const model of models) {
    const name = model.provider.name.trim() || 'Other';
    const existing = byProvider.get(name);
    if (existing) {
      existing.models.push(model);
      if (!existing.logo && model.provider.logo) existing.logo = model.provider.logo;
      continue;
    }
    const section: ProviderSection = { name, logo: model.provider.logo, models: [model] };
    byProvider.set(name, section);
    sections.push(section);
  }
  return sections;
}

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

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const selectedName = agentSpec?.model?.name ?? models[0]?.name ?? '';
  const selected = models.find(m => m.name === selectedName);
  const label = selected
    ? displayModelLabel(selected.name)
    : selectedName
      ? displayModelLabel(selectedName)
      : loading
        ? 'Loading…'
        : 'Select model';

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models;
    return models.filter(
      m =>
        m.name.toLowerCase().includes(needle) ||
        m.id.toLowerCase().includes(needle) ||
        m.provider.name.toLowerCase().includes(needle),
    );
  }, [models, query]);

  const sections = useMemo(() => groupModelsByProvider(filtered), [filtered]);

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
    <>
      <div className="border-b border-border px-3 py-2">
        <p className="text-text-primary mb-2 text-sm font-semibold">Select model</p>
        <label className="relative block">
          <Icon
            name="search"
            className="text-text-secondary pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
          />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search"
            className="border-input-border bg-input-box-bg text-text-primary placeholder:text-text-secondary h-8 w-full rounded-md border py-1 pr-2 pl-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
            autoFocus
          />
        </label>
      </div>
      <div
        id={menuId}
        role="listbox"
        aria-label="Select model"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1"
      >
        {filtered.length === 0 ? (
          showConfigureSettingsCta ? (
            <button
              type="button"
              className="text-text-secondary hover:text-text-primary flex w-full items-center justify-center gap-1 px-2 py-4 text-center text-sm"
              onClick={() => {
                setOpen(false);
                setQuery('');
                shell?.setSettingsOpen(true);
              }}
            >
              <span>
                Please configure Models in the <span className="underline">settings</span>
              </span>
              <Icon name="chevron-right" className="size-3.5 shrink-0" />
            </button>
          ) : (
            <p className="text-text-secondary px-2 py-4 text-center text-sm">No models</p>
          )
        ) : (
          sections.map((section, sectionIndex) => {
            const headingId = `${menuId}-provider-${sectionIndex}`;
            return (
              <div
                key={section.name}
                role="group"
                aria-labelledby={headingId}
                className={cn(sectionIndex > 0 && 'mt-2')}
              >
                <div
                  id={headingId}
                  className="text-text-secondary flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium tracking-wide uppercase"
                >
                  <ProviderMark logo={section.logo} label={section.name} className="size-3.5 text-[9px]" />
                  <span className="truncate">{section.name}</span>
                </div>
                {section.models.map(model => {
                  // If there is no selected model, consider the first in the filtered list as active
                  const active = selectedName ? model.name === selectedName : filtered[0] === model;
                  return (
                    <button
                      key={model.id || model.name}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={cn(
                        'flex w-full items-center rounded-md px-2 py-2 text-left text-sm',
                        active
                          ? 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text'
                          : 'hover:bg-ghost-button-hover',
                      )}
                      onClick={() => {
                        updateAgentSpec?.({
                          model: modelPatchWithReasoningEffort(
                            model.name,
                            agentSpec?.model?.params,
                            model.properties.reasoningEfforts,
                          ),
                        });
                        setOpen(false);
                        setQuery('');
                      }}
                    >
                      <span className="truncate font-medium">{displayModelLabel(model.name)}</span>
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </>
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || isRunning}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Select model"
        className={auiButtonClass({
          variant: 'ghost',
          size: 'sm',
          className: cn('h-8 max-w-48 gap-1.5 rounded-full px-2 text-xs font-medium', 'hover:bg-ghost-button-hover'),
        })}
        onClick={() => setOpen(v => !v)}
      >
        <ProviderMark logo={selected?.provider.logo} label={account} className="size-4 text-xs" />
        <span className="truncate">{label}</span>
        <Icon name="chevron-down" className="size-3.5 shrink-0 opacity-60" />
      </button>

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
