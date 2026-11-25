'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { Button } from '../../atoms/primitives/Button.js';
import { Checkbox } from '../../atoms/primitives/Checkbox.js';
import { Skeleton } from '../../atoms/primitives/Skeleton.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalServer, useServerCapabilities } from '../../server/ServerContext.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';

/** The server rejects longer lists; kept in step with its `allowed_models` limit. */
const MAX_ALLOWED_MODELS = 10;

type AutoModelAllowListProps = {
  /** The saved full model names (account/model); an empty list allows none. */
  allowedModels: string[];
  saving: boolean;
  onSave: (allowedModels: string[]) => void;
};

function sameSelection({ left, right }: { left: readonly string[]; right: readonly string[] }): boolean {
  return left.length === right.length && left.every(name => right.includes(name));
}

/**
 * Which models Auto may choose from. The draft stays local until saved, so each tick does not refresh capabilities.
 * Remount with a new `key` when the saved list changes to restart the draft from it.
 */
const AutoModelAllowList = ({ allowedModels, saving, onSave }: AutoModelAllowListProps) => {
  const server = useOptionalServer();
  const capabilities = useServerCapabilities();
  const queryClient = useServerQueryClient();

  const [selected, setSelected] = useState<string[]>(allowedModels);

  const modelsQuery = useQuery(
    {
      queryKey: queryKeys.catalog.models(),
      queryFn: () => (server == null ? Promise.reject(new Error('Server is not configured.')) : server.getModels()),
      enabled: server != null,
    },
    queryClient,
  );

  // Saved names this admin can't see stay listed, so saving never drops them silently. Nothing is flagged until the
  // listing has loaded, and a failed listing still shows what is saved.
  const rows = useMemo(() => {
    if (modelsQuery.isPending) return [];
    const listed = new Set((modelsQuery.data ?? []).map(model => model.name));
    const saved = allowedModels.filter(name => !listed.has(name));
    const isListingKnown = modelsQuery.isSuccess;
    return [
      ...[...listed].sort((a, b) => a.localeCompare(b)).map(name => ({ name, visible: true })),
      ...saved.sort((a, b) => a.localeCompare(b)).map(name => ({ name, visible: !isListingKnown })),
    ];
  }, [modelsQuery.isPending, modelsQuery.isSuccess, modelsQuery.data, allowedModels]);

  const dirty = !sameSelection({ left: selected, right: allowedModels });
  const atLimit = selected.length >= MAX_ALLOWED_MODELS;
  const routingUnavailableReason = capabilities?.auto.status === 'disabled' ? capabilities.auto.reason : undefined;

  const toggle = (name: string) =>
    setSelected(current => (current.includes(name) ? current.filter(item => item !== name) : [...current, name]));

  return (
    <div className="mt-2 rounded-xl border border-border bg-card-bg p-3">
      <h4 className="text-sm font-medium text-text-primary">Models Auto can choose from</h4>
      <p className="mt-0.5 text-xs text-text-secondary">
        {`Auto only picks from the models selected here, among the models each user has access to. Choose up to ${String(MAX_ALLOWED_MODELS)}.`}
      </p>

      {routingUnavailableReason ? (
        <p role="status" className="mt-3 text-xs text-failure-bg">
          {routingUnavailableReason}
        </p>
      ) : null}

      <div className="mt-3">
        {modelsQuery.isPending ? (
          <Skeleton data-testid="auto-model-allow-list-skeleton" className="h-24 w-full rounded-lg" />
        ) : null}
        {modelsQuery.isError ? (
          <p className="text-xs text-failure-bg">{getErrorMessage(modelsQuery.error, 'Failed to load models')}</p>
        ) : null}
        {rows.length > 0 ? (
          <div
            role="group"
            aria-label="Models Auto can choose from"
            className="max-h-64 overflow-y-auto rounded-lg border border-border bg-secondary-bg/30"
          >
            {rows.map(row => {
              const checked = selected.includes(row.name);
              return (
                <button
                  key={row.name}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={row.name}
                  disabled={saving || (atLimit && !checked)}
                  className="flex min-h-10 w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-sm text-text-primary last:border-b-0 hover:bg-ghost-button-hover disabled:opacity-50"
                  onClick={() => toggle(row.name)}
                >
                  <Checkbox checked={checked} />
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  {row.visible ? null : (
                    <span className="shrink-0 text-xs text-text-secondary">Not visible to you</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : null}
        {!modelsQuery.isPending && !modelsQuery.isError && rows.length === 0 ? (
          <p className="text-xs text-text-secondary">No models are available to select.</p>
        ) : null}
        <p className="mt-2 text-xs text-text-secondary">
          {`${String(selected.length)} of ${String(MAX_ALLOWED_MODELS)} selected.`}
          {selected.length === 0 ? ' With none selected, Auto has no model to pick.' : ''}
          {atLimit ? ' Deselect a model to choose another.' : ''}
        </p>
      </div>

      {dirty ? (
        <div className="mt-3 flex justify-end gap-2">
          <Button.Secondary size="small" type="button" disabled={saving} onClick={() => setSelected(allowedModels)}>
            Reset
          </Button.Secondary>
          <Button.Primary size="small" type="button" disabled={saving} onClick={() => onSave(selected)}>
            Save
          </Button.Primary>
        </div>
      ) : null}
    </div>
  );
};

export default AutoModelAllowList;
