'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { displayModelLabel, groupModelsByProvider, ProviderMark } from '../../atoms/draft/DraftModelCatalogPanel.js';
import { modelMatchesQuery, normalizeModelSearchText } from '../../atoms/draft/modelSearch.js';
import { cn } from '../../atoms/lib/cn.js';
import { auiInputClass } from '../../atoms/lib/inputClasses.js';
import { Button } from '../../atoms/primitives/Button.js';
import { Checkbox } from '../../atoms/primitives/Checkbox.js';
import { Skeleton } from '../../atoms/primitives/Skeleton.js';
import { Icon } from '../../icons/Icon.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalServer, useServerCapabilities } from '../../server/ServerContext.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';

/** The server rejects lists outside these limits (an empty list is allowed); kept in step with its `candidate_models`. */
const MAX_CANDIDATE_MODELS = 10;
const MIN_CANDIDATE_MODELS = 4;

type AutoModelCandidateListProps = {
  /** The saved full model names (account/model); an empty list allows none. */
  candidateModels: string[];
  saving: boolean;
  onSave: (candidateModels: string[]) => void;
};

function sameSelection({ left, right }: { left: readonly string[]; right: readonly string[] }): boolean {
  return left.length === right.length && left.every(name => right.includes(name));
}

/**
 * Which models Auto may choose from: a searchable dropdown of the models this admin can use, grouped by provider like
 * the chat model picker, with the picks shown as removable chips. The draft stays local until saved, so each pick does
 * not refresh capabilities. The list opens in the page flow, pushing Save down rather than floating over it, so it is
 * never clipped by the scrolling settings pane. Remount with a new `key` when the saved list changes to restart the draft from it.
 */
const AutoModelCandidateList = ({ candidateModels, saving, onSave }: AutoModelCandidateListProps) => {
  const server = useOptionalServer();
  const capabilities = useServerCapabilities();
  const queryClient = useServerQueryClient();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<string[]>(candidateModels);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const modelsQuery = useQuery(
    {
      queryKey: queryKeys.catalog.models(),
      queryFn: () => (server == null ? Promise.reject(new Error('Server is not configured.')) : server.getModels()),
      enabled: server != null,
    },
    queryClient,
  );

  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);
  const needle = normalizeModelSearchText(query);
  const sections = useMemo(
    () => groupModelsByProvider(needle ? models.filter(model => modelMatchesQuery({ model, needle })) : models),
    [models, needle],
  );

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  useEffect(() => {
    if (!open) return;
    // On click, not mousedown: closing the list moves Save up, which would swallow the click that was aimed at it.
    const handleOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [open]);

  // Saved names this admin can't see stay listed, so saving never drops them silently. Nothing is flagged until the
  // listing has loaded, and a failed listing still shows what is saved.
  const listed = new Set(models.map(model => model.name));
  const isListingKnown = modelsQuery.isSuccess;

  const dirty = !sameSelection({ left: selected, right: candidateModels });
  const atLimit = selected.length >= MAX_CANDIDATE_MODELS;
  // An empty selection is saveable (it clears the list); a partial one is not.
  const belowMinimum = selected.length > 0 && selected.length < MIN_CANDIDATE_MODELS;
  const routingUnavailableReason = capabilities?.auto.status === 'disabled' ? capabilities.auto.reason : undefined;

  const hint =
    selected.length === 0
      ? ` Pick ${String(MIN_CANDIDATE_MODELS)} to ${String(MAX_CANDIDATE_MODELS)} models; with none, Auto stays unavailable.`
      : belowMinimum && dirty
        ? ` Pick at least ${String(MIN_CANDIDATE_MODELS)} to save.`
        : atLimit
          ? ' Remove one to add another.'
          : '';

  const toggle = (name: string) =>
    setSelected(current => (current.includes(name) ? current.filter(item => item !== name) : [...current, name]));

  return (
    <div>
      {routingUnavailableReason ? (
        <p role="status" className="mb-3 text-xs text-failure-bg">
          {routingUnavailableReason}
        </p>
      ) : null}

      <div ref={rootRef}>
        {modelsQuery.isPending ? (
          <Skeleton data-testid="auto-model-candidate-list-skeleton" className="h-8 w-full rounded-md" />
        ) : (
          <div
            className={auiInputClass(
              'flex min-h-8 flex-wrap items-center gap-1 px-1.5 py-1 focus-within:ring-2 focus-within:ring-focus-ring/40',
            )}
          >
            {selected.map(name => (
              <span
                key={name}
                className="flex max-w-full items-center gap-1 rounded border border-border bg-dropdown-selected-item-bg py-0.5 pl-1.5 pr-0.5 text-xs text-text-primary"
              >
                <span className="truncate">{name}</span>
                {!isListingKnown || listed.has(name) ? null : (
                  <span className="shrink-0 text-text-secondary">Not visible to you</span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  disabled={saving}
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded hover:bg-secondary-button-hover disabled:opacity-50"
                  onClick={() => toggle(name)}
                >
                  <Icon name="xmark" size="0.625rem" />
                </button>
              </span>
            ))}
            <button
              type="button"
              role="combobox"
              aria-label="Select models"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={open ? listboxId : undefined}
              disabled={saving}
              className="flex h-6 min-w-24 flex-1 items-center justify-between gap-2 px-1.5 text-left text-[0.8125rem] text-text-secondary outline-none disabled:cursor-not-allowed"
              onClick={() => (open ? close() : setOpen(true))}
            >
              <span className="truncate">{selected.length === 0 ? 'Select models' : 'Add models'}</span>
              <Icon name="chevron-down" className="size-3.5 shrink-0 opacity-60" />
            </button>
          </div>
        )}

        {open ? (
          <div
            className="aui-popup-enter mt-1 flex max-h-72 w-full flex-col overflow-hidden rounded-lg border border-border bg-card-bg text-text-primary"
            onKeyDown={event => {
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              close();
            }}
          >
            <div className="border-b border-border px-3 py-2">
              <label className="relative block">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-secondary"
                />
                <input
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search models"
                  aria-label="Search models"
                  className={auiInputClass('h-8 py-1 pl-7 pr-2')}
                  autoFocus
                />
              </label>
            </div>
            <div
              id={listboxId}
              role="listbox"
              aria-multiselectable
              aria-label="Models Auto can choose from"
              className="flex min-h-0 flex-col overflow-y-auto p-1"
            >
              {sections.map((section, sectionIndex) => {
                const headingId = `${listboxId}-provider-${String(sectionIndex)}`;
                return (
                  <div
                    key={section.name}
                    role="group"
                    aria-labelledby={headingId}
                    className={cn(sectionIndex > 0 && 'mt-2')}
                  >
                    <div
                      id={headingId}
                      className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary"
                    >
                      <ProviderMark logo={section.logo} label={section.name} className="size-3.5 text-[9px]" />
                      <span className="truncate">{section.name}</span>
                    </div>
                    {section.models.map(model => {
                      const checked = selected.includes(model.name);
                      return (
                        <button
                          key={model.name}
                          type="button"
                          role="option"
                          aria-selected={checked}
                          aria-label={model.name}
                          disabled={atLimit && !checked}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-ghost-button-hover disabled:pointer-events-none disabled:opacity-50"
                          onClick={() => toggle(model.name)}
                        >
                          <Checkbox checked={checked} />
                          <span className="min-w-0 flex-1 truncate font-normal">{displayModelLabel(model.name)}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {sections.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-text-secondary">
                  {models.length === 0 ? 'No models are available to select.' : 'No models match your search.'}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {modelsQuery.isError ? (
        <p className="mt-2 text-xs text-failure-bg">{getErrorMessage(modelsQuery.error, 'Failed to load models')}</p>
      ) : null}
      <p className="mt-2 text-xs text-text-secondary">{`${String(selected.length)} of ${String(MAX_CANDIDATE_MODELS)} selected.${hint}`}</p>

      {dirty ? (
        <div className="mt-3 flex justify-end gap-2">
          <Button.Secondary size="small" type="button" disabled={saving} onClick={() => setSelected(candidateModels)}>
            Reset
          </Button.Secondary>
          <Button.Primary size="small" type="button" disabled={saving || belowMinimum} onClick={() => onSave(selected)}>
            Save
          </Button.Primary>
        </div>
      ) : null}
    </div>
  );
};

export default AutoModelCandidateList;
