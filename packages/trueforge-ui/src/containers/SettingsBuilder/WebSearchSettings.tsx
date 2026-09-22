'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '../../atoms/primitives/Button.js';
import { Icon } from '../../icons/Icon.js';
import { useCatalogServer } from '../../server/ServerContext.js';
import type { WebSearchProviderBase, WebSearchProviderCatalogEntry } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { useToasterOptional } from '../ToasterContainer.js';
import ConfigureWebSearchForm, { type WebSearchConfigDraft } from './ConfigureWebSearchForm.js';

const WebSearchSettings = () => {
  const { webSearchCatalog } = useCatalogServer();
  const toaster = useToasterOptional();

  const [providers, setProviders] = useState<WebSearchProviderBase[]>([]);
  const [catalog, setCatalog] = useState<WebSearchProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createEntry, setCreateEntry] = useState<WebSearchProviderCatalogEntry | null>(null);
  const [updateProvider, setUpdateProvider] = useState<WebSearchProviderBase | null>(null);

  const refresh = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (!webSearchCatalog) return;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const [listed, available] = await Promise.all([
          webSearchCatalog.listWebSearchProviders(),
          webSearchCatalog.getWebSearchProviderCatalog(),
        ]);
        setProviders(listed);
        setCatalog(available);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load web search providers'));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [webSearchCatalog],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Tenant/UI-wide: only one web-search provider may be configured at a time.
  const hasConfiguredProvider = providers.length > 0;
  const availableEntries = useMemo(() => {
    if (hasConfiguredProvider) return [];
    const connectedCatalogIds = new Set(providers.map(provider => provider.catalogId));
    return catalog.filter(entry => !connectedCatalogIds.has(entry.id));
  }, [catalog, providers, hasConfiguredProvider]);

  if (!webSearchCatalog) {
    return <p className="text-sm text-text-secondary">Web search provider catalog is not available.</p>;
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

  const handleCreate = async (draft: WebSearchConfigDraft) => {
    if (!createEntry) return;
    setFormError(null);
    await runMutation(async () => {
      await webSearchCatalog.createWebSearchProvider({
        catalogId: createEntry.id,
        name: createEntry.name,
        type: createEntry.type,
        apiKey: draft.apiKey,
      });
    }, setFormError);
    setCreateEntry(null);
    setTimeout(() => {
      toaster?.showSuccess({ title: `${createEntry.name} configured` });
    }, 0);
  };

  const handleUpdate = async (draft: WebSearchConfigDraft) => {
    if (!updateProvider) return;
    setFormError(null);
    await runMutation(async () => {
      await webSearchCatalog.updateWebSearchProvider({
        id: updateProvider.id,
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      });
    }, setFormError);
    setUpdateProvider(null);
    setTimeout(() => {
      toaster?.showSuccess({ title: `${updateProvider.name} updated` });
    }, 0);
  };

  const formOpen = createEntry != null || updateProvider != null;
  const isUpdate = updateProvider != null;
  const formTitle = updateProvider
    ? `Update ${updateProvider.name}`
    : createEntry
      ? `Configure ${createEntry.name}`
      : 'Configure web search provider';

  return (
    <>
      <h3 className="text-xl font-semibold tracking-tight text-text-primary">Web search</h3>
      <p className="mt-1 text-sm text-text-secondary">
        Configure a provider so agents can search the web. Only one can be active at a time.
      </p>

      {error ? (
        <p className="mt-3 rounded-md border border-failure-bg/30 bg-failure-bg/10 px-3 py-2 text-sm text-failure-bg">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-text-secondary">Loading web search providers…</p>
        ) : (
          <div className="space-y-6">
            {providers.length > 0 ? (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Configured · {providers.length}
                </h4>
                <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
                  {providers.map(provider => (
                    <article
                      key={provider.id}
                      className="flex flex-col gap-3 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-primary"
                          aria-hidden
                        >
                          <Icon name="search" className="size-4.5" />
                        </span>
                        <div className="min-w-0">
                          <h5 className="truncate text-sm font-medium text-text-primary">{provider.name}</h5>
                          <p className="truncate text-xs text-text-secondary">Parallel web search</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success-bg">
                          <span className="size-2 rounded-full bg-success-bg" aria-hidden />
                          Connected
                        </span>
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
                      </div>
                    </article>
                  ))}
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
                      : 'No web search providers in the catalog.'}
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
                            <Icon name="search" className="size-4.5" />
                          </span>
                          <div className="min-w-0">
                            <h5 className="truncate text-sm font-medium text-text-primary">{entry.name}</h5>
                            <p className="truncate text-xs text-text-secondary">Parallel web search</p>
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

      <ConfigureWebSearchForm
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
            ? 'Update this web search provider. Leave API key blank to keep the existing key.'
            : 'Configure this web search provider. API key is never stored in the catalog.'
        }
        requireApiKey={!isUpdate}
        busy={busy}
        error={formError}
      />
    </>
  );
};

export default WebSearchSettings;
