'use client';

import { useMemo, useState } from 'react';

import {
  tierCells,
  tierCoverageCounts,
  tierLabel,
  uncoveredTiers,
} from '../../containers/SettingsBuilder/autoRoutingTiers.js';
import type { AutoRoutingCategory, ModelSelection } from '../../server/types.js';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { Checkbox } from '../primitives/Checkbox.js';
import { Tooltip } from '../primitives/Tooltip.js';
import {
  isAutoCandidate,
  MAX_AUTO_CANDIDATE_MODELS,
  MIN_AUTO_CANDIDATE_MODELS,
  removedAutoCandidates,
} from './autoModel.js';
import { displayModelLabel, groupModelsByProvider } from './DraftModelCatalogPanel.js';
import { modelMatchesQuery, normalizeModelSearchText } from './modelSearch.js';

export type AutoModelCandidatesPanelProps = {
  models: ModelSelection[];
  /** The candidates the agent routes among today; the checklist starts from them. */
  saved: string[];
  query: string;
  onApply: (candidateModels: string[]) => void;
  onCancel: () => void;
};

function accountOf(modelName: string): string {
  const slash = modelName.lastIndexOf('/');
  return slash > 0 ? modelName.slice(0, slash) : modelName;
}

function categoriesOf(model: ModelSelection): AutoRoutingCategory[] {
  const routing = model.properties.autoRouting;
  return routing?.supported === true ? routing.categories : [];
}

type CandidateRowProps = {
  label: string;
  /** Set for a saved candidate the workspace no longer offers, which has no tiers to draw. */
  caption?: string;
  categories: readonly AutoRoutingCategory[];
  checked: boolean;
  /** Why an unticked row cannot be ticked; a ticked row can always be unticked. */
  blockedReason: string | null;
  onToggle: () => void;
};

function CandidateRow({ label, caption, categories, checked, blockedReason, onToggle }: CandidateRowProps) {
  const blocked = !checked && blockedReason !== null;
  const covered = categories.map(tierLabel).join(', ');
  const row = (
    <button
      type="button"
      role="option"
      aria-selected={checked}
      // Not `disabled`, so keyboard users can still reach the reason.
      aria-disabled={blocked || undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm',
        blocked ? 'cursor-not-allowed opacity-50' : 'hover:bg-ghost-button-hover',
      )}
      onClick={() => {
        if (!blocked) onToggle();
      }}
    >
      <Checkbox checked={checked} className="size-4" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-normal">{label}</span>
        {caption === undefined ? null : (
          <span className="text-warning-bg mt-0.5 block truncate text-[0.625rem]">{caption}</span>
        )}
      </span>
      {categories.length > 0 ? (
        <span aria-hidden title={covered} className="flex shrink-0 gap-[0.1875rem]">
          {tierCells(categories).map(cell => (
            <span
              key={cell.category}
              className={cn('h-1 w-3 rounded-sm', cell.covered ? 'bg-primary-button-bg' : 'bg-text-secondary/30')}
            />
          ))}
        </span>
      ) : null}
    </button>
  );
  if (!blocked) return row;
  return (
    <Tooltip
      side="top"
      interactive={false}
      triggerClassName="w-full"
      className="max-w-xs whitespace-normal p-2 text-left shadow-lg"
      content={blockedReason}
    >
      {row}
    </Tooltip>
  );
}

/** What stops Apply, or null when the selection can be saved. */
function selectionProblem({
  count,
  removed,
  uncovered,
}: {
  count: number;
  removed: number;
  uncovered: readonly AutoRoutingCategory[];
}) {
  // The server rejects candidates that settings no longer enable, so they must be unticked first.
  if (removed > 0) return `untick ${String(removed)} unavailable ${removed === 1 ? 'model' : 'models'}`;
  if (count < MIN_AUTO_CANDIDATE_MODELS) return `pick at least ${String(MIN_AUTO_CANDIDATE_MODELS)}`;
  if (uncovered.length > 0) return `no model for ${new Intl.ListFormat('en').format(uncovered.map(tierLabel))}`;
  return null;
}

/**
 * The Auto view of the model picker: a checklist, grouped by provider, of the models Auto may route this agent
 * among. Models Auto cannot route to, or that settings do not enable for it, are left out.
 */
export function AutoModelCandidatesPanel({ models, saved, query, onApply, onCancel }: AutoModelCandidatesPanelProps) {
  const [selected, setSelected] = useState<string[]>(saved);
  const needle = normalizeModelSearchText(query);

  const removed = useMemo(
    () => new Set(removedAutoCandidates({ candidateModels: selected, models })),
    [selected, models],
  );
  const routable = useMemo(() => models.filter(isAutoCandidate), [models]);
  const removedRows = selected.filter(name => removed.has(name) && normalizeModelSearchText(name).includes(needle));
  const sections = groupModelsByProvider(
    needle ? routable.filter(model => modelMatchesQuery({ model, needle })) : routable,
  );
  const atLimit = selected.length >= MAX_AUTO_CANDIDATE_MODELS;
  const limitReason = atLimit
    ? `Auto can use at most ${String(MAX_AUTO_CANDIDATE_MODELS)} models. Remove one to add another.`
    : null;
  const uncovered = uncoveredTiers(
    tierCoverageCounts(routable.filter(model => selected.includes(model.name)).map(categoriesOf)),
  );
  const problem = selectionProblem({ count: selected.length, removed: removed.size, uncovered });

  const toggle = (name: string) =>
    setSelected(previous => (previous.includes(name) ? previous.filter(item => item !== name) : [...previous, name]));

  return (
    <div className="flex min-h-0 min-w-0 flex-auto flex-col overflow-hidden">
      <div className="flex min-h-0 flex-auto flex-col overflow-y-auto">
        <div role="listbox" aria-label="Auto candidate models" aria-multiselectable className="flex flex-col p-1">
          {removedRows.length > 0 ? (
            <div role="group" aria-label="No longer in workspace list">
              {removedRows.map(name => (
                <CandidateRow
                  key={name}
                  label={displayModelLabel(name)}
                  caption={`${accountOf(name)} · no longer in workspace list`}
                  categories={[]}
                  checked
                  blockedReason={null}
                  onToggle={() => toggle(name)}
                />
              ))}
            </div>
          ) : null}
          {sections.map(section => (
            <div key={section.name} role="group" aria-label={section.name}>
              <div className="text-text-secondary truncate px-2 pt-2.5 pb-1 text-[0.6875rem] tracking-wide uppercase">
                {section.name}
              </div>
              {section.models.map(model => (
                <CandidateRow
                  key={model.id || model.name}
                  label={displayModelLabel(model.name)}
                  categories={categoriesOf(model)}
                  checked={selected.includes(model.name)}
                  blockedReason={limitReason}
                  onToggle={() => toggle(model.name)}
                />
              ))}
            </div>
          ))}
          {removedRows.length + sections.length === 0 ? (
            <p className="text-text-secondary px-2 py-6 text-center text-sm" role="status">
              No models
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2">
        <span className={cn('min-w-0 text-xs', problem === null ? 'text-text-secondary' : 'text-warning-bg')}>
          {`${String(selected.length)} of ${String(routable.length + removed.size)} selected`}
          {problem === null ? '' : ` · ${problem}`}
        </span>
        <span className="flex shrink-0 gap-2">
          <Button.Secondary type="button" size="large" onClick={onCancel}>
            Cancel
          </Button.Secondary>
          <Button.Primary type="button" size="large" disabled={problem !== null} onClick={() => onApply(selected)}>
            Apply
          </Button.Primary>
        </span>
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AutoModelCandidatesPanel: typeof AutoModelCandidatesPanel;
  }
}
