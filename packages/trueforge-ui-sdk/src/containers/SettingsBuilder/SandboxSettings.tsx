'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '../../atoms/primitives/Button.js';
import { Icon } from '../../icons/Icon.js';
import { useCatalogServer } from '../../server/ServerContext.js';
import type { SandboxProviderBase, SandboxProviderCatalogEntry, SandboxProviderConfig } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import ConfigureSandboxForm, { type SandboxConfigDraft } from './ConfigureSandboxForm.js';

const configFrom = ({
  snapshotName,
  execTimeoutMs,
  autoStopIntervalInMinutes,
  autoArchiveIntervalInMinutes,
  autoDeleteIntervalInMinutes,
}: SandboxProviderConfig): SandboxProviderConfig => ({
  snapshotName,
  execTimeoutMs,
  autoStopIntervalInMinutes,
  autoArchiveIntervalInMinutes,
  autoDeleteIntervalInMinutes,
});

const SandboxSettings = () => {
  const { sandboxCatalog } = useCatalogServer();

  const [providers, setProviders] = useState<SandboxProviderBase[]>([]);
  const [catalog, setCatalog] = useState<SandboxProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  // Tenant/UI-wide: only one sandbox provider may be configured at a time.
  const hasConfiguredProvider = providers.length > 0;
  const availableEntries = useMemo(() => {
    if (hasConfiguredProvider) return [];
    const connectedCatalogIds = new Set(providers.map(provider => provider.catalogId));
    return catalog.filter(entry => !connectedCatalogIds.has(entry.id));
  }, [catalog, providers, hasConfiguredProvider]);

  const formInitialConfig = useMemo(
    () => (updateProvider ? configFrom(updateProvider) : createEntry ? configFrom(createEntry) : null),
    [updateProvider, createEntry],
  );

  if (!sandboxCatalog) {
    return <p className="text-sm text-muted-foreground">Sandbox provider catalog is not available.</p>;
  }

  const runMutation = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh({ quiet: true });
    } catch (err) {
      setError(getErrorMessage(err, 'Request failed'));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (draft: SandboxConfigDraft) => {
    if (!createEntry) return;
    await runMutation(async () => {
      await sandboxCatalog.createSandboxProvider({
        catalogId: createEntry.id,
        name: createEntry.name,
        type: createEntry.type,
        ...configFrom(draft),
        apiKey: draft.apiKey,
      });
    });
    setCreateEntry(null);
  };

  const handleUpdate = async (draft: SandboxConfigDraft) => {
    if (!updateProvider) return;
    await runMutation(async () => {
      await sandboxCatalog.updateSandboxProvider({
        id: updateProvider.id,
        ...configFrom(draft),
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      });
    });
    setUpdateProvider(null);
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
      <h3 className="text-xl font-semibold tracking-tight text-foreground">Sandbox providers</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose a provider that runs sandboxes for code, files and shell commands. Only one can be active at a time.
      </p>

      {error ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading sandbox providers…</p>
        ) : (
          <div className="space-y-6">
            {providers.length > 0 ? (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Configured · {providers.length}
                </h4>
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {providers.map(provider => (
                    <article
                      key={provider.id}
                      className="flex flex-col gap-3 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
                          aria-hidden
                        >
                          <Icon name="cube" className="size-4.5" />
                        </span>
                        <div className="min-w-0">
                          <h5 className="truncate text-sm font-medium text-foreground">{provider.name}</h5>
                          <p className="truncate text-[0.8125rem] text-muted-foreground">{provider.snapshotName}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                        {provider.isConnected ? (
                          <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary"></span>
                            Connected
                          </span>
                        ) : null}
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setCreateEntry(null);
                            setUpdateProvider(provider);
                          }}
                        >
                          Update
                        </Button>
                        {sandboxCatalog.deleteSandboxProvider ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              handleRemove(provider);
                            }}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Available · {availableEntries.length}
              </h4>
              {availableEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {hasConfiguredProvider
                    ? 'One provider is set up. Update it or remove it to switch.'
                    : catalog.length > 0
                      ? 'All catalog providers are configured.'
                      : 'No sandbox providers in the catalog.'}
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {availableEntries.map(entry => (
                    <article
                      key={entry.id}
                      className="flex flex-col gap-3 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
                          aria-hidden
                        >
                          <Icon name="cube" className="size-4.5" />
                        </span>
                        <div className="min-w-0">
                          <h5 className="truncate text-sm font-medium text-foreground">{entry.name}</h5>
                          <p className="truncate text-[0.8125rem] text-muted-foreground">
                            {entry.snapshotName} · {entry.type}
                          </p>
                        </div>
                      </div>

                      <Button
                        variant="secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setUpdateProvider(null);
                          setCreateEntry(entry);
                        }}
                      >
                        Configure
                      </Button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <ConfigureSandboxForm
        open={formOpen}
        onOpenChange={open => {
          if (!open) {
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
      />
    </>
  );
};

export default SandboxSettings;
