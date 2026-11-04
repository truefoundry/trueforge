'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTrackAnalytics } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { Button } from '../../atoms/primitives/Button.js';
import { Switch } from '../../atoms/primitives/Switch.js';
import { Icon } from '../../icons/Icon.js';
import {
  useOptionalCatalogServer,
  useOptionalConfigurationServer,
  useOptionalRefreshServerCapabilities,
  useServerCapabilities,
  useServerCapabilitiesSettled,
} from '../../server/ServerContext.js';
import type { MemoryProviderBase, MemoryProviderCatalogEntry } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { useToasterOptional } from '../ToasterContainer.js';
import ConfigureMemoryProviderForm, { type MemoryProviderConfigDraft } from './ConfigureMemoryProviderForm.js';

const MemorySettings = () => {
  const catalogServer = useOptionalCatalogServer();
  const settings = useServerCapabilities()?.settings;
  const capabilitiesSettled = useServerCapabilitiesSettled();
  const refreshCapabilities = useOptionalRefreshServerCapabilities();
  const configuration = useOptionalConfigurationServer();
  const toaster = useToasterOptional();
  const track = useTrackAnalytics();

  // Providers belong to the platform when `manageProviders` is false, so only the tenant
  // switch is the caller's to change. Unsettled capabilities withhold the provider calls.
  const canManageProviders = capabilitiesSettled && settings?.memoryProviders?.manageProviders !== false;
  const memoryCatalog = canManageProviders ? catalogServer?.memoryCatalog : undefined;

  // `null` until the tenant switch loads, so the control is not rendered half-known.
  const [tenantEnabled, setTenantEnabled] = useState<boolean | null>(null);
  const [tenantBusy, setTenantBusy] = useState(false);
  const [providers, setProviders] = useState<MemoryProviderBase[]>([]);
  const [catalog, setCatalog] = useState<MemoryProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createEntry, setCreateEntry] = useState<MemoryProviderCatalogEntry | null>(null);
  const [updateProvider, setUpdateProvider] = useState<MemoryProviderBase | null>(null);

  const refresh = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (!memoryCatalog) {
        setProviders([]);
        setCatalog([]);
        setLoading(false);
        return;
      }
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const [listed, available] = await Promise.all([
          memoryCatalog.listMemoryProviders(),
          memoryCatalog.getMemoryProviderCatalog(),
        ]);
        setProviders(listed);
        setCatalog(available);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load memory providers'));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [memoryCatalog],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!configuration) return;
    let cancelled = false;
    void configuration
      .getConfiguration()
      .then(loaded => {
        if (!cancelled) setTenantEnabled(loaded.memory.enabled);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load the memory setting'));
      });
    return () => {
      cancelled = true;
    };
  }, [configuration]);

  const hasConfiguredProvider = providers.length > 0;
  const availableEntries = useMemo(() => {
    if (hasConfiguredProvider) return [];
    const connectedCatalogIds = new Set(providers.map(provider => provider.catalogId));
    return catalog.filter(entry => !connectedCatalogIds.has(entry.id));
  }, [catalog, providers, hasConfiguredProvider]);

  if (memoryCatalog == null && configuration == null) {
    return <p className="text-sm text-text-secondary">Memory settings are not available.</p>;
  }

  const handleTenantToggle = async (next: boolean) => {
    if (!configuration) return;
    setTenantBusy(true);
    setError(null);
    try {
      const saved = await configuration.updateConfiguration({ memory: { enabled: next } });
      setTenantEnabled(saved.memory.enabled);
      toaster?.showSuccess({ title: saved.memory.enabled ? 'Memory turned on' : 'Memory turned off' });
      track(AnalyticsEvents.Settings.MEMORY_TENANT_TOGGLED, { enabled: saved.memory.enabled });
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save the memory setting'));
    } finally {
      setTenantBusy(false);
    }
  };

  const runMutation = async (fn: () => Promise<void>) => {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
      await refresh({ quiet: true });
      // A saved provider is what offers memory to agents, so the toggle should appear right away.
      refreshCapabilities?.();
    } catch (err) {
      setFormError(getErrorMessage(err, 'Request failed'));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (draft: MemoryProviderConfigDraft) => {
    if (!createEntry || !memoryCatalog) return;
    await runMutation(async () => {
      await memoryCatalog.createMemoryProvider({
        catalogId: createEntry.id,
        name: createEntry.name,
        type: createEntry.type,
        apiKey: draft.apiKey,
        ...(draft.serverUrl === '' ? {} : { serverUrl: draft.serverUrl }),
      });
    });
    setCreateEntry(null);
    toaster?.showSuccess({ title: `${createEntry.name} configured` });
    track(AnalyticsEvents.Settings.MEMORY_PROVIDER_SAVED, { provider_name: createEntry.name, mode: 'create' });
  };

  const handleUpdate = async (draft: MemoryProviderConfigDraft) => {
    if (!updateProvider || !memoryCatalog) return;
    await runMutation(async () => {
      await memoryCatalog.updateMemoryProvider({
        id: updateProvider.id,
        ...(draft.apiKey === '' ? {} : { apiKey: draft.apiKey }),
        ...(draft.serverUrl === '' ? {} : { serverUrl: draft.serverUrl }),
      });
    });
    setUpdateProvider(null);
    toaster?.showSuccess({ title: `${updateProvider.name} updated` });
    track(AnalyticsEvents.Settings.MEMORY_PROVIDER_SAVED, { provider_name: updateProvider.name, mode: 'update' });
  };

  const showProviders = memoryCatalog != null && tenantEnabled !== false;
  const formOpen = createEntry != null || updateProvider != null;
  const isUpdate = updateProvider != null;
  const formTitle = updateProvider
    ? `Update ${updateProvider.name}`
    : createEntry
      ? `Configure ${createEntry.name}`
      : 'Configure memory provider';

  return (
    <>
      <h3 className="text-xl font-semibold tracking-tight text-text-primary">Memory</h3>
      <p className="mt-1 text-sm text-text-secondary">
        Choose whether agents in this tenant may remember details from past chats.
      </p>

      {error ? (
        <p className="mt-3 rounded-md border border-failure-bg/30 bg-failure-bg/10 px-3 py-2 text-sm text-failure-bg">
          {error}
        </p>
      ) : null}

      {tenantEnabled !== null ? (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-card-bg p-3">
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-text-primary">Allow memory</h4>
            <p className="mt-0.5 text-xs text-text-secondary">
              {tenantEnabled
                ? 'Agents with memory turned on remember details from past chats.'
                : 'No agent remembers details from past chats.'}
            </p>
          </div>
          <Switch
            checked={tenantEnabled}
            disabled={tenantBusy}
            aria-label="Allow memory"
            onCheckedChange={next => {
              void handleTenantToggle(next);
            }}
          />
        </div>
      ) : null}

      <div className="mt-4 flex-1 overflow-y-auto">
        {!showProviders ? null : loading ? (
          <p className="text-sm text-text-secondary">Loading memory providers…</p>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-text-secondary">
              Configure a provider so agents can remember details. Only one can be active at a time.
            </p>

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
                          <Icon name="brain" className="size-4.5" />
                        </span>
                        <div className="min-w-0">
                          <h5 className="truncate text-sm font-medium text-text-primary">{provider.name}</h5>
                          <p className="truncate text-xs text-text-secondary">{provider.serverUrl ?? 'Zep Cloud'}</p>
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
                  <p className="text-sm text-text-secondary">No memory providers in the catalog.</p>
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
                            <Icon name="brain" className="size-4.5" />
                          </span>
                          <h5 className="truncate text-sm font-medium text-text-primary">{entry.name}</h5>
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

      <ConfigureMemoryProviderForm
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
            ? 'Update this memory provider. Leave API key blank to keep the existing key.'
            : 'Configure this memory provider. API key is never stored in the catalog.'
        }
        initialServerUrl={updateProvider?.serverUrl ?? ''}
        requireApiKey={!isUpdate}
        busy={busy}
        error={formError}
      />
    </>
  );
};

export default MemorySettings;
