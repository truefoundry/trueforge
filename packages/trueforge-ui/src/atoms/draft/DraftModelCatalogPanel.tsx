'use client';

import { useMemo, type SyntheticEvent } from 'react';
import { Icon } from '../../icons/Icon.js';
import type { ModelSelection } from '../../server/types.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { CatalogLogo } from '../primitives/CatalogLogo.js';
import { Tooltip, type TooltipSide } from '../primitives/Tooltip.js';
import { AUTO_MODEL, AUTO_MODEL_LABEL, AUTO_MODEL_TOOLTIP_LINES, AUTO_MODEL_TOOLTIP_TITLE } from './autoModel.js';
import { DraftCatalogEmptyState } from './DraftCatalogEmptyState.js';
import { modelMatchesQuery, normalizeModelSearchText } from './modelSearch.js';

function monogram(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export function displayModelLabel(modelName: string): string {
  if (modelName === AUTO_MODEL) return AUTO_MODEL_LABEL;
  const slash = modelName.lastIndexOf('/');
  return slash >= 0 ? modelName.slice(slash + 1) : modelName;
}

export function formatTokens(value: number): string {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function ModelWarningMark({ warning, side = 'right' }: { warning: string; side?: TooltipSide }) {
  return (
    <Tooltip content={warning} side={side} className="max-w-xs whitespace-normal">
      <span className="inline-flex shrink-0">
        <Icon name="triangle-exclamation" className="text-warning-bg size-3.5" aria-label={warning} />
      </span>
    </Tooltip>
  );
}

export function ProviderMark({ logo, label, className }: { logo?: string; label: string; className?: string }) {
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

export type DraftAutoModelOption = {
  enabled: boolean;
  /** Shown under the option while it is disabled. */
  unavailableHint: string;
  onSelect: () => void;
};

export type DraftModelReasoningControls = {
  /** `undefined` hides the effort label and its edit control for that row. */
  effortLabel: (model: ModelSelection) => string | undefined;
  editingName: string | undefined;
  onEdit: (model: ModelSelection, row: HTMLElement) => void;
};

function ReasoningEffortEditTrigger({
  isEditing,
  isPinned,
  onEdit,
}: {
  isEditing: boolean;
  /** Otherwise revealed on row hover or focus (always visible below md, where hover is unreliable). */
  isPinned: boolean;
  onEdit: (row: HTMLElement) => void;
}) {
  const open = (event: SyntheticEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const row = event.currentTarget.closest<HTMLElement>('[role="option"]');
    if (row) onEdit(row);
  };
  // A <button> cannot nest inside the option button, so this is a focusable span.
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Edit reasoning effort"
      aria-haspopup="menu"
      aria-expanded={isEditing}
      className={cn(
        'text-text-secondary hover:text-text-primary hover:bg-ghost-button-hover inline-flex size-5 shrink-0 items-center justify-center rounded',
        !isPinned && 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
      )}
      onClick={open}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') open(event);
      }}
    >
      <Icon name="pencil" className="size-3" />
    </span>
  );
}

export type ProviderSection = { name: string; logo?: string; models: ModelSelection[] };

export function groupModelsByProvider(models: ModelSelection[]): ProviderSection[] {
  const sections: ProviderSection[] = [];
  const byProvider = new Map<string, ProviderSection>();
  for (const model of models) {
    const name = model.provider.name.trim() || 'Other';
    const existing = byProvider.get(name);
    if (existing) {
      existing.models.push(model);
      if (!existing.logo && model.provider.logo) existing.logo = model.provider.logo;
    } else {
      const section: ProviderSection = { name, logo: model.provider.logo, models: [model] };
      byProvider.set(name, section);
      sections.push(section);
    }
  }
  return sections;
}

export function DraftModelCatalogPanel({
  models,
  loading,
  selectedName,
  query,
  onQueryChange,
  onSelect,
  onOpenSettings,
  listboxId,
  autoOption,
  reasoning,
  showHeading = true,
  showSearch = true,
}: {
  models: ModelSelection[];
  loading: boolean;
  selectedName: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (model: ModelSelection) => void;
  onOpenSettings?: () => void;
  listboxId: string;
  /** Listed above the providers when set. */
  autoOption: DraftAutoModelOption | undefined;
  /** Inline effort label and edit control per row; list layout (`showHeading`) only. */
  reasoning: DraftModelReasoningControls | undefined;
  showHeading?: boolean;
  showSearch?: boolean;
}) {
  const needle = normalizeModelSearchText(query);
  const filtered = useMemo(
    () => (needle ? models.filter(model => modelMatchesQuery({ model, needle })) : models),
    [models, needle],
  );
  const sections = groupModelsByProvider(filtered);
  const showAuto = autoOption !== undefined && normalizeModelSearchText(AUTO_MODEL_LABEL).includes(needle);
  const autoActive = selectedName === AUTO_MODEL;
  const detailedGridClass = 'grid-cols-[minmax(0,1fr)_5rem_1rem]';
  const listActiveClass = 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text';

  return (
    <>
      {showSearch && (
        <div className="border-b border-border px-3 py-2">
          <label className="relative block">
            <Icon
              name="search"
              className="text-text-secondary pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
            />
            <input
              type="search"
              value={query}
              onChange={event => onQueryChange(event.target.value)}
              placeholder="Search models"
              className={auiInputClass('h-8 py-1 pr-2 pl-7')}
              autoFocus
            />
          </label>
        </div>
      )}
      <div className="flex min-h-0 flex-auto flex-col overflow-y-auto">
        {!showHeading ? (
          <div
            className={cn(
              'bg-card-bg text-text-secondary sticky top-0 z-10 grid shrink-0 gap-2 border-b border-border px-3 py-2 text-[10px] font-semibold uppercase',
              detailedGridClass,
            )}
          >
            <span>Model</span>
            <span>Context</span>
            <span aria-hidden />
          </div>
        ) : null}
        <div id={listboxId} role="listbox" aria-label="Select model" className="flex flex-col p-1">
          {showAuto ? (
            <>
              <Tooltip
                side="left"
                interactive={false}
                triggerClassName="w-full"
                className="max-w-xs whitespace-normal border border-border p-3 text-left shadow-lg"
                content={
                  <span className="flex flex-col gap-2">
                    <span className="font-semibold text-text-primary">{AUTO_MODEL_TOOLTIP_TITLE}</span>
                    {AUTO_MODEL_TOOLTIP_LINES.map(line => (
                      <span key={line} className="text-text-secondary text-xs leading-snug">
                        {line}
                      </span>
                    ))}
                  </span>
                }
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={autoActive}
                  disabled={!autoOption.enabled}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm',
                    autoActive ? listActiveClass : 'hover:bg-ghost-button-hover',
                    !autoOption.enabled && 'cursor-default opacity-50 hover:bg-transparent',
                  )}
                  onClick={autoOption.onSelect}
                >
                  <Icon name="wand" className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-normal">{AUTO_MODEL_LABEL}</span>
                    {autoOption.enabled ? null : (
                      <span className="text-text-secondary mt-0.5 block text-[10px]">{autoOption.unavailableHint}</span>
                    )}
                  </span>
                </button>
              </Tooltip>
              <div aria-hidden className="mx-2 my-1 border-t border-border" />
            </>
          ) : null}
          {filtered.length === 0 ? (
            showAuto ? null : (
              <DraftCatalogEmptyState
                loading={loading}
                emptyLabel="No models"
                settingsTarget="Models"
                onOpenSettings={onOpenSettings}
              />
            )
          ) : (
            sections.map((section, sectionIndex) => {
              const headingId = `${listboxId}-provider-${sectionIndex}`;
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
                    const active = selectedName ? model.name === selectedName : filtered[0] === model;
                    const warning = model.warning?.trim();
                    const effortLabel = showHeading ? reasoning?.effortLabel(model) : undefined;
                    const isEditing = reasoning?.editingName === model.name;
                    return (
                      <button
                        key={model.id || model.name}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={cn(
                          'group w-full items-center rounded-md px-2 py-2 text-left text-sm',
                          showHeading ? 'flex gap-2' : cn('grid gap-2', detailedGridClass),
                          active
                            ? showHeading
                              ? listActiveClass
                              : 'bg-primary-button-bg/10 text-primary-button-bg'
                            : cn('hover:bg-ghost-button-hover', isEditing && 'bg-ghost-button-hover'),
                        )}
                        onClick={() => onSelect(model)}
                      >
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 truncate font-normal">{displayModelLabel(model.name)}</span>
                            {reasoning !== undefined && effortLabel !== undefined ? (
                              <>
                                <span className="text-text-secondary shrink-0 text-xs">{effortLabel}</span>
                                <ReasoningEffortEditTrigger
                                  isEditing={isEditing}
                                  isPinned={active || isEditing}
                                  onEdit={row => reasoning.onEdit(model, row)}
                                />
                              </>
                            ) : null}
                          </span>
                          {showHeading &&
                          (model.properties.contextLength !== undefined ||
                            model.properties.maxOutputTokens !== undefined) ? (
                            <span className="text-text-secondary mt-0.5 block truncate text-[10px]">
                              {[
                                model.properties.contextLength === undefined
                                  ? null
                                  : `${formatTokens(model.properties.contextLength)} context`,
                                model.properties.maxOutputTokens === undefined
                                  ? null
                                  : `${formatTokens(model.properties.maxOutputTokens)} output`,
                              ]
                                .filter(value => value !== null)
                                .join(' · ')}
                            </span>
                          ) : null}
                        </span>
                        {!showHeading ? (
                          <span className={cn('text-text-secondary text-xs', active && 'text-primary-button-bg')}>
                            {model.properties.contextLength === undefined
                              ? '—'
                              : formatTokens(model.properties.contextLength)}
                          </span>
                        ) : null}
                        {warning ? (
                          <span className={cn('flex items-center justify-end', showHeading && 'ml-auto')}>
                            <ModelWarningMark warning={warning} />
                          </span>
                        ) : !showHeading ? (
                          <span aria-hidden />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
