'use client';

import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import { groupModelsByProvider, type ProviderSection } from '../../atoms/draft/DraftModelCatalogPanel.js';
import { modelMatchesQuery, normalizeModelSearchText } from '../../atoms/draft/modelSearch.js';
import { cn } from '../../atoms/lib/cn.js';
import { auiInputClass } from '../../atoms/lib/inputClasses.js';
import { Checkbox } from '../../atoms/primitives/Checkbox.js';
import { Tooltip } from '../../atoms/primitives/Tooltip.js';
import type { ModelSelection } from '../../server/types.js';
import { tierCells } from './autoRoutingTiers.js';

/** Why a model can't be ticked right now, shown in a tooltip on the row. */
export type PickerBlock = { title: string; text: string };

type AutoModelPickerPopoverProps = {
  listboxId: string;
  models: readonly ModelSelection[];
  selected: ReadonlySet<string>;
  /** Applies to models that aren't selected yet; selected ones can always be unticked. */
  limitBlock: PickerBlock | null;
  onToggle: (name: string) => void;
};

/** The row's own reason for being unavailable, or null when Auto can route to it. */
function unsupportedBlock(model: ModelSelection): PickerBlock | null {
  const routing = model.properties.autoRouting;
  if (routing?.supported === true) return null;
  return {
    title: 'Not available for auto routing',
    text: routing?.unsupportedReason ?? 'Auto routing support is not reported for this model.',
  };
}

function isSupported(model: ModelSelection): boolean {
  return model.properties.autoRouting?.supported === true;
}

type PickerSection = ProviderSection & { key: string };

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

/** Models Auto can route to first, then the locked ones; each block is grouped by provider, alphabetically. */
function sectionsBySupport(models: readonly ModelSelection[]): PickerSection[] {
  return [true, false].flatMap(supported =>
    groupModelsByProvider(models.filter(model => isSupported(model) === supported))
      .sort(byName)
      .map(section => ({
        ...section,
        key: `${supported ? 'supported' : 'unsupported'}:${section.name}`,
        models: [...section.models].sort((a, b) => a.id.localeCompare(b.id)),
      })),
  );
}

type OptionProps = {
  model: ModelSelection;
  checked: boolean;
  limitBlock: PickerBlock | null;
  onToggle: (name: string) => void;
};

/** One model row. Memoized so ticking a model re-renders only the rows whose state changed. */
const Option = memo(({ model, checked, limitBlock, onToggle }: OptionProps) => {
  const routing = model.properties.autoRouting;
  const unsupported = unsupportedBlock(model);
  // A ticked row can always be unticked, even if the model has since stopped supporting Auto routing.
  const block = checked ? null : (unsupported ?? limitBlock);
  const categories = routing?.supported === true ? routing.categories : [];

  const row = (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      aria-label={model.id}
      // Not `disabled`: the row must stay focusable so keyboard users can reach the tooltip's reason.
      aria-disabled={block != null || undefined}
      className={cn(
        'flex w-full items-center gap-3 px-3.5 py-2.25 text-left text-sm text-text-primary focus-visible:bg-ghost-button-hover focus-visible:outline-none',
        block == null ? 'cursor-pointer hover:bg-ghost-button-hover' : 'cursor-not-allowed opacity-50',
      )}
      onClick={() => {
        if (block == null) onToggle(model.name);
      }}
    >
      <Checkbox checked={checked} className="size-4.5 rounded-[0.3125rem]" />
      <span className="min-w-0 flex-1 truncate">{model.id}</span>
      {unsupported == null ? (
        <>
          <span aria-hidden className="flex shrink-0 gap-[0.1875rem]">
            {tierCells(categories).map(cell => (
              <span
                key={cell.category}
                className={cn('h-1 w-3.5 rounded-sm', cell.covered ? 'bg-primary-button-bg' : 'bg-text-secondary/30')}
              />
            ))}
          </span>
        </>
      ) : (
        <span className="shrink-0 rounded-full border border-text-secondary/30 px-2 py-px text-xs text-text-secondary">
          Not supported
        </span>
      )}
    </button>
  );

  if (block == null) return row;
  // The tooltip hangs off a block wrapper so it lands at the popover's right edge, level with the row.
  return (
    <Tooltip
      side="right"
      interactive={false}
      triggerClassName="block w-full"
      className="w-[16.25rem] whitespace-normal rounded-lg bg-text-primary px-3 py-2.5 text-[0.8125rem] leading-[1.1875rem] text-primary-bg shadow-lg"
      content={
        <>
          <span className="block font-semibold">{block.title}</span>
          <span className="block">{block.text}</span>
        </>
      }
    >
      <span className="block w-full">{row}</span>
    </Tooltip>
  );
});
Option.displayName = 'AutoModelPickerOption';

/**
 * Searchable list of every model, grouped by provider, for ticking the ones Auto may route to. Supported models come
 * first, then models without Auto routing support stay listed but locked, with the reason on hover or focus. It overlays the card below its footer, so
 * the owner must be `relative`.
 */
const AutoModelPickerPopover = ({ listboxId, models, selected, limitBlock, onToggle }: AutoModelPickerPopoverProps) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');

  const needle = normalizeModelSearchText(query);
  const sections = useMemo(
    () => sectionsBySupport(needle ? models.filter(model => modelMatchesQuery({ model, needle })) : models),
    [models, needle],
  );

  // The card sits in a scrolling pane, so a popover opened near its bottom edge would otherwise start off-screen.
  useEffect(() => {
    popoverRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  return (
    <div
      ref={popoverRef}
      className="aui-popup-enter absolute left-6 top-14 z-10 flex w-[27.5rem] max-w-[calc(100%-3rem)] flex-col rounded-[0.625rem] border border-input-border bg-input-box-bg shadow-[0_1rem_2.5rem_rgba(0,0,0,0.5)]"
    >
      <div className="border-b border-border p-2.5">
        <input
          type="search"
          value={query}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          placeholder="Search models"
          aria-label="Search models"
          className={auiInputClass('h-9 bg-card-bg')}
          autoFocus
        />
      </div>
      <div
        id={listboxId}
        role="listbox"
        aria-multiselectable
        aria-label="Models Auto can choose from"
        className="max-h-80 overflow-y-auto py-1.5"
      >
        {sections.map((section, sectionIndex) => {
          const headingId = `${listboxId}-provider-${String(sectionIndex)}`;
          return (
            <div key={section.key} role="group" aria-labelledby={headingId}>
              <div
                id={headingId}
                className="truncate px-3.5 pb-1 pt-2.5 text-[0.6875rem] uppercase tracking-[0.08em] text-text-secondary"
              >
                {section.name}
              </div>
              {section.models.map(model => (
                <Option
                  key={model.name}
                  model={model}
                  checked={selected.has(model.name)}
                  limitBlock={limitBlock}
                  onToggle={onToggle}
                />
              ))}
            </div>
          );
        })}
        {sections.length === 0 ? (
          <p className="px-3.5 py-3.5 text-[0.8125rem] text-text-secondary">
            {models.length === 0 ? 'No models are available to select.' : 'No models match.'}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default AutoModelPickerPopover;
