'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Spinner } from '@/atoms/primitives/Spinner.js';
import { Button } from '../../atoms/primitives/Button.js';
import { Tooltip } from '../../atoms/primitives/Tooltip.js';
import { Icon } from '../../icons/Icon.js';
import { useCatalogServer } from '../../server/ServerContext.js';
import type {
  SandboxProviderBase,
  SandboxProviderCatalogEntry,
  SandboxProviderConfig,
  SandboxProviderListEntry,
  SandboxSnapshotSyncStatus,
} from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { useToasterOptional } from '../ToasterContainer.js';
import ConfigureSandboxForm, { type SandboxConfigDraft } from './ConfigureSandboxForm.js';

const SNAPSHOT_STATUS_POLL_INTERVAL_MS = 10000;

const configFrom = ({
  execTimeoutMs,
  autoStopIntervalInMinutes,
  autoArchiveIntervalInMinutes,
  autoDeleteIntervalInMinutes,
}: SandboxProviderConfig): SandboxProviderConfig => ({
  execTimeoutMs,
  autoStopIntervalInMinutes,
  autoArchiveIntervalInMinutes,
  autoDeleteIntervalInMinutes,
});

const statusPresentation = (status: SandboxSnapshotSyncStatus['status']): { label: string; className: string } => {
  switch (status) {
    case 'pending':
      return {
        label: 'Syncing image...',
        className: 'text-warning-bg',
      };
    case 'ready':
      return {
        label: 'Connected',
        className: 'text-success-bg',
      };
    case 'failed':
      return {
        label: 'Sync failed',
        className: 'text-failure-bg',
      };
    default:
      return {
        label: status,
        className: 'text-text-secondary',
      };
  }
};

const SandboxSettings = () => {
  const { sandboxCatalog } = useCatalogServer();
  const toaster = useToasterOptional();

  const [providers, setProviders] = useState<SandboxProviderListEntry[]>([]);
  const [catalog, setCatalog] = useState<SandboxProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createEntry, setCreateEntry] = useState<SandboxProviderCatalogEntry | null>(null);
  const [updateProvider, setUpdateProvider] = useState<SandboxProviderBase | null>(null);

  const refresh = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (!sandboxCatalog) return;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const [listed, available] = await Promise.all([
          sandboxCatalog.listSandboxProviders(),
          sandboxCatalog.getSandboxProviderCatalog(),
        ]);
        setProviders(listed);
        setCatalog(available);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load sandbox providers'));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [sandboxCatalog],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasPendingProvider = providers.some(entry => entry.snapshotSyncStatus.status === 'pending');

  useEffect(() => {
    if (!sandboxCatalog || !hasPendingProvider) return;
    const activeSandboxCatalog = sandboxCatalog;

    let cancelled = false;
    let timeoutId: number | undefined;

    function schedulePoll() {
      timeoutId = window.setTimeout(() => {
        void poll();
      }, SNAPSHOT_STATUS_POLL_INTERVAL_MS);
    }

    async function poll() {
      try {
        const listed = await activeSandboxCatalog.listSandboxProviders();
        if (cancelled) return;
        setProviders(listed);
        setError(null);
        if (listed.some(entry => entry.snapshotSyncStatus.status === 'pending')) {
          schedulePoll();
        }
      } catch (err) {
        if (cancelled) return;
        setError(getErrorMessage(err, 'Failed to refresh sandbox providers'));
        schedulePoll();
      }
    }

    schedulePoll();
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [sandboxCatalog, hasPendingProvider]);

  // Tenant/UI-wide: only one sandbox provider may be configured at a time.
  const hasConfiguredProvider = providers.length > 0;
  const availableEntries = useMemo(() => {
    if (hasConfiguredProvider) return [];
    const connectedCatalogIds = new Set(providers.map(provider => provider.data.catalogId));
    return catalog.filter(entry => !connectedCatalogIds.has(entry.id));
  }, [catalog, providers, hasConfiguredProvider]);

  const formInitialConfig = useMemo(
    () => (updateProvider ? configFrom(updateProvider) : createEntry ? configFrom(createEntry) : null),
    [updateProvider, createEntry],
  );

  if (!sandboxCatalog) {
    return <p className="text-sm text-text-secondary">Sandbox provider catalog is not available.</p>;
  }

  const runMutation = async (fn: () => Promise<void>, setMutationError = setError) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh({ quiet: true });
    } catch (err) {
      setMutationError(getErrorMessage(err, 'Request failed'));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (draft: SandboxConfigDraft) => {
    if (!createEntry) return;
    setFormError(null);
    await runMutation(async () => {
      await sandboxCatalog.createSandboxProvider({
        catalogId: createEntry.id,
        name: createEntry.name,
        type: createEntry.type,
        ...configFrom(draft),
        apiKey: draft.apiKey,
      });
    }, setFormError);
    setCreateEntry(null);
    setTimeout(() => {
      toaster?.showSuccess({ title: `${createEntry.name} configured` });
    }, 0);
  };

  const handleUpdate = async (draft: SandboxConfigDraft) => {
    if (!updateProvider) return;
    setFormError(null);
    await runMutation(async () => {
      await sandboxCatalog.updateSandboxProvider({
        id: updateProvider.id,
        ...configFrom(draft),
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      });
    }, setFormError);
    setUpdateProvider(null);
    setTimeout(() => {
      toaster?.showSuccess({ title: `${updateProvider.name} updated` });
    }, 0);
  };

  const handleRetry = (provider: SandboxProviderBase) => {
    void runMutation(async () => {
      await sandboxCatalog.updateSandboxProvider({
        id: provider.id,
        ...configFrom(provider),
      });
    }).catch(() => {});
  };

  const handleRemove = (provider: SandboxProviderBase) => {
    const deleteSandboxProvider = sandboxCatalog.deleteSandboxProvider;
    if (!deleteSandboxProvider) return;
    void runMutation(async () => {
      await deleteSandboxProvider({ id: provider.id });
    }).catch(() => {});
  };

  const formOpen = createEntry != null || updateProvider != null;
  const isUpdate = updateProvider != null;
  const formTitle = updateProvider
    ? `Update ${updateProvider.name}`
    : createEntry
      ? `Configure ${createEntry.name}`
      : 'Configure sandbox provider';

  return (
    <>
      <h3 className="text-xl font-semibold tracking-tight text-text-primary">Sandbox providers</h3>
      <p className="mt-1 text-sm text-text-secondary">
        Choose a provider that runs sandboxes for code, files and shell commands. Only one can be active at a time.
      </p>

      {error ? (
        <p className="mt-3 rounded-md border border-failure-bg/30 bg-failure-bg/10 px-3 py-2 text-sm text-failure-bg">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-text-secondary">Loading sandbox providers…</p>
        ) : (
          <div className="space-y-6">
            {providers.length > 0 ? (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Configured · {providers.length}
                </h4>
                <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
                  {providers.map(entry => {
                    const provider = entry.data;
                    const status = statusPresentation(entry.snapshotSyncStatus.status);
                    const statusReason = entry.snapshotSyncStatus.statusReason;
                    const statusIndicator = (
                      <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${status.className}`}>
                        {entry.snapshotSyncStatus.status === 'pending' ? (
                          <Spinner size={16} aria-label="Syncing snapshot image" />
                        ) : entry.snapshotSyncStatus.status === 'ready' ? (
                          <span className="size-2 rounded-full bg-success-bg" aria-hidden />
                        ) : entry.snapshotSyncStatus.status === 'failed' ? (
                          <Icon name="triangle-exclamation" className="size-4" />
                        ) : null}
                        {status.label}
                      </span>
                    );
                    return (
                      <article
                        key={provider.id}
                        className="flex flex-col gap-3 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span
                            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-primary"
                            aria-hidden
                          >
                            <Icon name="cube" className="size-4.5" />
                          </span>
                          <div className="min-w-0">
                            <h5 className="truncate text-sm font-medium text-text-primary">{provider.name}</h5>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                          {statusIndicator}
                          {statusReason ? (
                            <Tooltip content={statusReason}>
                              <button
                                type="button"
                                aria-label="Snapshot sync status details"
                                className="inline-flex text-text-secondary transition-colors hover:text-text-primary"
                              >
                                <Icon name="info" className="size-4" />
                              </button>
                            </Tooltip>
                          ) : null}
                          {entry.snapshotSyncStatus.status === 'failed' ? (
                            <Button.Ghost
                              size="small"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                handleRetry(provider);
                              }}
                            >
                              Retry
                            </Button.Ghost>
                          ) : null}
                          <Button.Secondary
                            size="small"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setFormError(null);
                              setCreateEntry(null);
                              setUpdateProvider(provider);
                            }}
                          >
                            Update
                          </Button.Secondary>

                          {sandboxCatalog.deleteSandboxProvider ? (
                            <Button.Ghost
                              size="small"
                              className="text-text-secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                handleRemove(provider);
                              }}
                            >
                              Remove
                            </Button.Ghost>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {!hasConfiguredProvider ? (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Available · {availableEntries.length}
                </h4>
                {availableEntries.length === 0 ? (
                  <p className="text-sm text-text-secondary">
                    {catalog.length > 0
                      ? 'All catalog providers are configured.'
                      : 'No sandbox providers in the catalog.'}
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
                    {availableEntries.map(entry => (
                      <article
                        key={entry.id}
                        className="flex flex-col gap-3 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span
                            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-primary"
                            aria-hidden
                          >
                            <Icon name="cube" className="size-4.5" />
                          </span>
                          <div className="min-w-0">
                            <h5 className="truncate text-sm font-medium text-text-primary">{entry.name}</h5>
                          </div>
                        </div>

                        <Button.Secondary
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setFormError(null);
                            setUpdateProvider(null);
                            setCreateEntry(entry);
                          }}
                        >
                          Configure
                        </Button.Secondary>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </div>
        )}
      </div>

      <ConfigureSandboxForm
        open={formOpen}
        onOpenChange={open => {
          if (!open) {
            setFormError(null);
            setCreateEntry(null);
            setUpdateProvider(null);
          }
        }}
        onSave={isUpdate ? handleUpdate : handleCreate}
        title={formTitle}
        description={
          isUpdate
            ? 'Update this sandbox provider. Leave API key blank to keep the existing key.'
            : 'Configure this sandbox provider. API key is never stored in the catalog.'
        }
        initialConfig={formInitialConfig}
        requireApiKey={!isUpdate}
        busy={busy}
        error={formError}
      />
    </>
  );
};

export default SandboxSettings;
