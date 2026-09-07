'use client';

import { Icon } from '../../icons/Icon.js';
import type { ModelSelection } from '../../server/types.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { CatalogLogo } from '../primitives/CatalogLogo.js';
import { DraftCatalogEmptyState } from './DraftCatalogEmptyState.js';

function monogram(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export function displayModelLabel(modelName: string): string {
  const slash = modelName.lastIndexOf('/');
  return slash >= 0 ? modelName.slice(slash + 1) : modelName;
}

function formatTokens(value: number): string {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
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

type ProviderSection = { name: string; logo?: string; models: ModelSelection[] };

function groupModelsByProvider(models: ModelSelection[]): ProviderSection[] {
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
  showHeading = true,
}: {
  models: ModelSelection[];
  loading: boolean;
  selectedName: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (model: ModelSelection) => void;
  onOpenSettings?: () => void;
  listboxId: string;
  showHeading?: boolean;
}) {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? models.filter(
        model =>
          model.name.toLowerCase().includes(needle) ||
          model.id.toLowerCase().includes(needle) ||
          model.provider.name.toLowerCase().includes(needle),
      )
    : models;
  const sections = groupModelsByProvider(filtered);
  const detailedGridClass = 'grid-cols-[minmax(0,1fr)_5rem]';

  return (
    <>
      <div className="border-b border-border px-3 py-2">
        {showHeading ? <p className="text-text-primary mb-2 text-sm font-normal">Select model</p> : null}
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
      {!showHeading ? (
        <div
          className={cn(
            'text-text-secondary grid gap-2 border-b border-border px-3 py-2 text-[10px] font-semibold uppercase',
            detailedGridClass,
          )}
        >
          <span>Model</span>
          <span>Context</span>
        </div>
      ) : null}
      <div
        id={listboxId}
        role="listbox"
        aria-label="Select model"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1"
      >
        {filtered.length === 0 ? (
          <DraftCatalogEmptyState
            loading={loading}
            emptyLabel="No models"
            settingsTarget="Models"
            onOpenSettings={onOpenSettings}
          />
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
                  return (
                    <button
                      key={model.id || model.name}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={cn(
                        'w-full items-center rounded-md px-2 py-2 text-left text-sm',
                        showHeading ? 'flex' : cn('grid gap-2', detailedGridClass),
                        active
                          ? 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text'
                          : 'hover:bg-ghost-button-hover',
                      )}
                      onClick={() => onSelect(model)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-normal">{displayModelLabel(model.name)}</span>
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
                        <>
                          <span className="text-text-secondary text-xs">
                            {model.properties.contextLength === undefined
                              ? '—'
                              : formatTokens(model.properties.contextLength)}
                          </span>
                        </>
                      ) : null}
                      {active && showHeading ? <Icon name="check" className="ml-auto size-3.5" /> : null}
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
}
