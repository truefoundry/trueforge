'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { displayModelLabel } from '../../atoms/draft/DraftModelCatalogPanel.js';
import { cn } from '../../atoms/lib/cn.js';
import { Button } from '../../atoms/primitives/Button.js';
import { Skeleton } from '../../atoms/primitives/Skeleton.js';
import { Icon } from '../../icons/Icon.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalServer } from '../../server/ServerContext.js';
import type { AutoRoutingCategory, ModelSelection } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import AutoModelPickerPopover, { type PickerBlock } from './AutoModelPickerPopover.js';
import {
  AUTO_ROUTING_TIERS,
  tierCells,
  tierCoverageCounts,
  tierLabel,
  uncoveredTiers,
  type TierCell,
} from './autoRoutingTiers.js';

/** Mirrors the server's limits on `candidate_models` (empty until models are chosen). */
const MAX_CANDIDATE_MODELS = 10;
const MIN_CANDIDATE_MODELS = 4;

/** Model name, one column per tier, then the remove button. Every row shares it so the tier columns line up. */
const GRID_CLASS = 'grid items-center px-6';
const GRID_STYLE = {
  gridTemplateColumns: `minmax(0,1fr) repeat(${AUTO_ROUTING_TIERS.length},minmax(0,7rem)) 2.5rem`,
};

type AutoModelCandidateListProps = {
  /** The saved full model names (account/model); empty until models are chosen. */
  candidateModels: string[];
  saving: boolean;
  onSave: (candidateModels: string[]) => void;
};

type CandidateRow = {
  name: string;
  label: string;
  categories: readonly AutoRoutingCategory[];
  /** Why the saved model can't be used; the server refuses a list that holds one. */
  problem: string | null;
};

function sameSelection({ left, right }: { left: readonly string[]; right: readonly string[] }): boolean {
  return left.length === right.length && left.every(name => right.includes(name));
}

function toCandidateRow({
  name,
  model,
  listingKnown,
}: {
  name: string;
  model: ModelSelection | undefined;
  listingKnown: boolean;
}): CandidateRow {
  if (model === undefined) {
    // Nothing is flagged until the listing loads, since every saved name would look hidden.
    return {
      name,
      label: displayModelLabel(name),
      categories: [],
      problem: listingKnown ? 'Not visible to you' : null,
    };
  }
  const routing = model.properties.autoRouting;
  return {
    name,
    label: model.id,
    categories: routing?.supported === true ? routing.categories : [],
    problem: routing?.supported === true ? null : 'Not available for auto routing',
  };
}

function formatTierList(tiers: readonly AutoRoutingCategory[]): string {
  return tiers.map(tierLabel).join(', ');
}

/** The line beside the footer buttons: what is missing, or what stops the admin from saving. */
function describeSelection({
  selectedCount,
  supportedTotal,
  listingKnown,
  gaps,
  hasProblem,
  dirty,
  belowMinimum,
  atLimit,
}: {
  selectedCount: number;
  supportedTotal: number;
  listingKnown: boolean;
  gaps: readonly AutoRoutingCategory[];
  hasProblem: boolean;
  dirty: boolean;
  belowMinimum: boolean;
  atLimit: boolean;
}): { text: string; warning: boolean } {
  if (selectedCount === 0) {
    return {
      text: `No models selected.${dirty ? ` Pick at least ${String(MIN_CANDIDATE_MODELS)} to update.` : ' With none selected, Auto stays unavailable.'}`,
      warning: false,
    };
  }
  if (gaps.length > 0) {
    const many = gaps.length > 1;
    return {
      text: `${formatTierList(gaps)} ${many ? 'have' : 'has'} no model. Add a model that covers ${many ? 'them' : 'it'}.`,
      warning: true,
    };
  }
  const count = listingKnown
    ? `${String(selectedCount)} of ${String(supportedTotal)} selected · every tier covered`
    : `${String(selectedCount)} selected`;
  if (hasProblem && dirty) return { text: `${count}. Remove the flagged models to update.`, warning: false };
  if (belowMinimum && dirty) {
    return { text: `${count}. Pick at least ${String(MIN_CANDIDATE_MODELS)} to update.`, warning: false };
  }
  if (atLimit) return { text: `${count}. Remove one to add another.`, warning: false };
  return { text: count, warning: false };
}

/** A tier's column of a model's row: the covered stretch is a bar through its dots, which are bigger at the ends. */
function TierCellView({ cell, index, previous }: { cell: TierCell; index: number; previous: TierCell | undefined }) {
  const first = index === 0;
  const last = index === AUTO_ROUTING_TIERS.length - 1;
  const label = tierLabel(cell.category);
  return (
    <div
      role="img"
      aria-label={cell.covered ? `Covers ${label}` : `Does not cover ${label}`}
      className="relative flex h-16 items-center justify-center"
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-1/2 h-0.5 -translate-y-1/2 bg-border',
          first ? 'left-1/2 right-0' : last ? 'left-0 right-1/2' : 'inset-x-0',
        )}
      />
      {previous?.joinsNext === true ? (
        <span aria-hidden className="absolute left-0 top-1/2 h-1 w-1/2 -translate-y-1/2 bg-primary-button-bg" />
      ) : null}
      {cell.joinsNext ? (
        <span aria-hidden className="absolute right-0 top-1/2 h-1 w-1/2 -translate-y-1/2 bg-primary-button-bg" />
      ) : null}
      <span
        aria-hidden
        className={cn(
          'relative rounded-full',
          !cell.covered && 'size-2 bg-text-secondary/30',
          cell.covered && cell.isEnd && 'size-4 border-4 border-primary-button-bg bg-primary-button-text',
          cell.covered && !cell.isEnd && 'size-2 bg-primary-button-bg',
        )}
      />
    </div>
  );
}

/**
 * The models Auto may route to, laid out against the four tiers so gaps are visible. Each model's tiers come from
 * the server and are read-only. The draft stays local until saved; remount with a new `key` to reset it from the
 * saved list.
 */
const AutoModelCandidateList = ({ candidateModels, saving, onSave }: AutoModelCandidateListProps) => {
  const server = useOptionalServer();
  const queryClient = useServerQueryClient();
  const listboxId = useId();
  const footerRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const [selected, setSelected] = useState<string[]>(candidateModels);
  const [open, setOpen] = useState(false);

  const modelsQuery = useQuery(
    {
      queryKey: queryKeys.catalog.models(),
      queryFn: () => (server == null ? Promise.reject(new Error('Server is not configured.')) : server.getModels()),
      enabled: server != null,
    },
    queryClient,
  );

  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);
  const modelsByName = useMemo(() => new Map(models.map(model => [model.name, model])), [models]);
  const listingKnown = modelsQuery.isSuccess;
  const supportedTotal = useMemo(
    () => models.filter(model => model.properties.autoRouting?.supported === true).length,
    [models],
  );

  const rows = useMemo(
    () => selected.map(name => toCandidateRow({ name, model: modelsByName.get(name), listingKnown })),
    [selected, modelsByName, listingKnown],
  );
  const counts = useMemo(() => tierCoverageCounts(rows.map(row => row.categories)), [rows]);
  const gaps = listingKnown ? uncoveredTiers(counts) : [];
  const hasProblem = rows.some(row => row.problem !== null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const dirty = useMemo(() => !sameSelection({ left: selected, right: candidateModels }), [selected, candidateModels]);
  const atLimit = selected.length >= MAX_CANDIDATE_MODELS;
  const belowMinimum = selected.length < MIN_CANDIDATE_MODELS;
  const status = describeSelection({
    selectedCount: selected.length,
    supportedTotal,
    listingKnown,
    gaps,
    hasProblem,
    dirty,
    belowMinimum,
    atLimit,
  });
  // The server refuses a list with a tier no model serves, so Update waits for every tier to be covered.
  const canSave = !saving && !belowMinimum && !hasProblem && gaps.length === 0;

  const limitBlock = useMemo<PickerBlock | null>(
    () =>
      atLimit
        ? {
            title: 'Model limit reached',
            text: `Auto can use at most ${String(MAX_CANDIDATE_MODELS)} models. Remove one to add another.`,
          }
        : null,
    [atLimit],
  );

  const toggle = useCallback(
    (name: string) =>
      setSelected(current => (current.includes(name) ? current.filter(item => item !== name) : [...current, name])),
    [],
  );
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePress = (event: MouseEvent) => {
      if (event.target instanceof Node && footerRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener('mousedown', handleOutsidePress);
    return () => document.removeEventListener('mousedown', handleOutsidePress);
  }, [open, close]);

  const handleFooterKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape' || !open) return;
      // Closes only the picker; without this the settings dialog would close with it.
      event.stopPropagation();
      close();
      addButtonRef.current?.focus();
    },
    [open, close],
  );
  const handleSave = useCallback(() => onSave(selected), [onSave, selected]);

  if (modelsQuery.isPending) {
    return (
      <div className="border-t border-border p-6">
        <Skeleton data-testid="auto-model-candidate-list-skeleton" className="h-24 w-full rounded-md" />
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      <div className={cn(GRID_CLASS, 'pb-2 pt-4 text-xs uppercase tracking-[0.08em]')} style={GRID_STYLE}>
        <div className="text-text-secondary">Model</div>
        {AUTO_ROUTING_TIERS.map(tier => (
          <div key={tier} className="whitespace-nowrap text-center text-text-primary">
            {tierLabel(tier)}
          </div>
        ))}
        <div />
      </div>
      {rows.length === 0 ? (
        <p className="border-t border-border px-6 py-5 text-[0.8125rem] text-text-secondary">
          Add the models Auto may route to.
        </p>
      ) : null}
      {rows.map(row => {
        const cells = tierCells(row.categories);
        return (
          <div key={row.name} className={cn(GRID_CLASS, 'min-h-16 border-t border-border')} style={GRID_STYLE}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="truncate text-[0.9375rem] font-medium text-text-primary">{row.label}</div>
              {row.problem !== null ? (
                <div className="truncate text-[0.8125rem] text-failure-bg">{row.problem}</div>
              ) : null}
            </div>
            {cells.map((cell, index) => (
              <TierCellView key={cell.category} cell={cell} index={index} previous={cells[index - 1]} />
            ))}
            <button
              type="button"
              aria-label={`Remove ${row.name}`}
              disabled={saving}
              className="inline-flex size-7 items-center justify-center justify-self-end rounded-md text-text-secondary hover:bg-ghost-button-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring disabled:opacity-50"
              onClick={() => toggle(row.name)}
            >
              <Icon name="xmark" size="0.75rem" />
            </button>
          </div>
        );
      })}

      {listingKnown ? (
        <div
          className={cn(GRID_CLASS, 'min-h-12 border-t border-border bg-black/10 text-[0.8125rem]')}
          style={GRID_STYLE}
        >
          <div className="text-xs uppercase tracking-[0.08em] text-text-secondary">Coverage</div>
          {AUTO_ROUTING_TIERS.map((tier, index) => {
            const count = counts[index] ?? 0;
            return (
              <div key={tier} className={cn('text-center', count > 0 ? 'text-text-secondary' : 'text-warning-bg')}>
                {count > 0 ? `${String(count)} model${count > 1 ? 's' : ''}` : 'No model'}
              </div>
            );
          })}
          <div />
        </div>
      ) : null}

      {modelsQuery.isError ? (
        <p className="border-t border-border px-6 py-3 text-xs text-failure-bg">
          {getErrorMessage(modelsQuery.error, 'Failed to load models')}
        </p>
      ) : null}

      <div
        ref={footerRef}
        className="relative flex items-center justify-between gap-4 border-t border-border px-6 py-3.5"
        onKeyDown={handleFooterKeyDown}
      >
        <Button.Secondary
          ref={addButtonRef}
          size="small"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          disabled={saving}
          onClick={() => setOpen(current => !current)}
        >
          <Icon name="plus" />
          Add models
        </Button.Secondary>
        <div className="flex min-w-0 items-center justify-end gap-3">
          <p
            role="status"
            className={cn('text-right text-[0.8125rem]', status.warning ? 'text-warning-bg' : 'text-text-secondary')}
          >
            {status.text}
          </p>
          {dirty ? (
            <Button.Primary size="small" type="button" disabled={!canSave} onClick={handleSave}>
              Update
            </Button.Primary>
          ) : null}
        </div>
        {open ? (
          <AutoModelPickerPopover
            listboxId={listboxId}
            models={models}
            selected={selectedSet}
            limitBlock={limitBlock}
            onToggle={toggle}
          />
        ) : null}
      </div>
    </div>
  );
};

export default AutoModelCandidateList;
