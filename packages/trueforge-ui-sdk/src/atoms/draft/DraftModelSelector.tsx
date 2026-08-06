'use client';

import { useTrueFoundryAgentSpec, useTrueFoundryUpdateAgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import type { ModelSelection } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { BottomSheet } from '../primitives/BottomSheet.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';
import { modelPatchWithReasoningEffort } from './reasoningEffort.js';

type RichModel = ModelSelection & { apiModel?: string; modelId?: string };

const PROVIDER_COLORS = ['#ec4899', '#0ea5e9', '#f59e0b', '#10b981', '#6366f1', '#8b5cf6'] as const;

function monogram(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

function colorFor(value: string): string {
  let hash = 0;
  for (const ch of value) hash = (hash + ch.charCodeAt(0)) % PROVIDER_COLORS.length;
  return PROVIDER_COLORS[hash] ?? PROVIDER_COLORS[0];
}

function displayModelLabel(modelName: string): string {
  const slash = modelName.lastIndexOf('/');
  return slash >= 0 ? modelName.slice(slash + 1) : modelName;
}

function modelValue(model: RichModel): string {
  return model.apiModel ?? model.name;
}

export type DraftModelSelectorProps = {
  disabled?: boolean;
  isRunning?: boolean;
};

export function DraftModelSelector({ disabled, isRunning }: DraftModelSelectorProps) {
  const { models: rawModels, loading } = useDraftCatalog();
  const models = rawModels as RichModel[];
  const { agentSpec } = useTrueFoundryAgentSpec();
  const updateAgentSpec = useTrueFoundryUpdateAgentSpec();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isMobile = useIsMobile();
  const compactLayout = useCompactLayout();

  const selectedName = agentSpec?.model?.name ?? (models[0] ? modelValue(models[0]) : '');
  const selected = models.find(m => modelValue(m) === selectedName || m.name === selectedName);
  const label = selected
    ? displayModelLabel(modelValue(selected))
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
        (m.apiModel?.toLowerCase().includes(needle) ?? false) ||
        (m.modelId?.toLowerCase().includes(needle) ?? false) ||
        m.provider.toLowerCase().includes(needle),
    );
  }, [models, query]);

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

  const account = selected?.provider ?? selectedName;
  const iconBg = colorFor(account);

  const content = (
    <>
      <div className="border-b border-border px-3 py-2">
        <p className="text-foreground mb-2 text-sm font-semibold">Select model</p>
        <label className="relative block">
          <Icon
            name="search"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
          />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search"
            className="border-input bg-background placeholder:text-muted-foreground h-8 w-full rounded-md border py-1 pr-2 pl-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
          <p className="text-muted-foreground px-2 py-4 text-center text-sm">No models</p>
        ) : (
          filtered.map(model => {
            const value = modelValue(model);
            const active = value === selectedName || model.name === selectedName;
            return (
              <button
                key={value || model.modelId || model.name}
                type="button"
                role="option"
                aria-selected={active}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm',
                  active ? 'bg-accent' : 'hover:bg-accent/60',
                )}
                onClick={() => {
                  updateAgentSpec?.({
                    model: modelPatchWithReasoningEffort(value, agentSpec?.model?.params, model.reasoningEfforts),
                  });
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white"
                  style={{ backgroundColor: colorFor(model.provider || model.name) }}
                  aria-hidden
                >
                  {monogram(model.provider || model.name)}
                </span>
                <span className="truncate font-medium">{displayModelLabel(value)}</span>
              </button>
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
          className: cn('h-8 max-w-[12rem] gap-1.5 rounded-full px-2 text-xs font-medium', 'hover:bg-accent'),
        })}
        onClick={() => setOpen(v => !v)}
      >
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
          style={{ backgroundColor: iconBg }}
          aria-hidden
        >
          {monogram(account)}
        </span>
        <span className="truncate">{label}</span>
        <Icon name="chevron-down" className="size-3.5 shrink-0 opacity-60" />
      </button>

      {open ? (
        isMobile || compactLayout ? (
          <BottomSheet open onOpenChange={setOpen} aria-label="Select model">
            {content}
          </BottomSheet>
        ) : (
          <div className="bg-popover text-popover-foreground absolute right-0 bottom-full z-50 mb-2 flex max-h-[22rem] w-[18rem] flex-col overflow-hidden rounded-lg border border-border shadow-lg">
            {content}
          </div>
        )
      ) : null}
    </div>
  );
}
