'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '../../atoms/primitives/Button.js';
import SearchInput from '../../atoms/primitives/SearchInput.js';
import { Icon } from '../../icons/Icon.js';
import { useCatalogServer } from '../../server/ServerContext.js';
import type { ModelEntry, ModelProviderBase, ModelProviderCatalogEntry } from '../../server/types.js';
import { useErrorToasterOptional } from '../ErrorToasterContainer.js';
import CustomModelProviderForm, { type CustomProviderDraft } from './CustomModelProviderForm.js';

const ModelSettings = () => {
  const { modelCatalog } = useCatalogServer();
  const toaster = useErrorToasterOptional();

  const [query, setQuery] = useState('');
  const [configured, setConfigured] = useState<ModelProviderBase[]>([]);
  const [catalog, setCatalog] = useState<ModelProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editingCatalogType, setEditingCatalogType] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [customProviderOpen, setCustomProviderOpen] = useState(false);

  const modelProviderIconMap = useMemo(() => {
    return (catalog ?? []).reduce(
      (acc, entry) => {
        acc[entry.name] = entry.logo ?? '';
        return acc;
      },
      {} as Record<string, string>,
    );
  }, [catalog]);

  const normalizedQuery = query.trim().toLowerCase();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listed, available] = await Promise.all([
        modelCatalog.listModelProviders(),
        modelCatalog.getModelProviderCatalog(),
      ]);
      setConfigured(listed);
      setCatalog(available);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model providers');
    } finally {
      setLoading(false);
    }
  }, [modelCatalog]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const configuredTypes = useMemo(() => new Set(configured.map(provider => provider.type)), [configured]);

  const matchingConfigured = useMemo(
    () =>
      configured.filter(
        provider =>
          provider.name.toLowerCase().includes(normalizedQuery) ||
          provider.models.some(
            model =>
              model.name.toLowerCase().includes(normalizedQuery) || model.id.toLowerCase().includes(normalizedQuery),
          ),
      ),
    [configured, normalizedQuery],
  );

  const matchingAvailable = useMemo(
    () =>
      catalog.filter(
        provider =>
          provider.type !== 'custom' &&
          !configuredTypes.has(provider.type) &&
          (provider.name.toLowerCase().includes(normalizedQuery) ||
            provider.models.some(
              model =>
                model.name.toLowerCase().includes(normalizedQuery) || model.id.toLowerCase().includes(normalizedQuery),
            )),
      ),
    [catalog, configuredTypes, normalizedQuery],
  );

  const supportedReasoningEfforts = useMemo(() => {
    return catalog.find(provider => provider.type === 'custom')?.supportedReasoningEfforts;
  }, [catalog]);

  const catalogModelsByType = useMemo(() => {
    const map = new Map<string, ModelEntry[]>();
    for (const entry of catalog) {
      map.set(entry.type, entry.models);
    }
    return map;
  }, [catalog]);

  const closeKeyEditor = () => {
    setEditingProviderId(null);
    setEditingCatalogType(null);
    setApiKey('');
  };

  const runMutation = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      closeKeyEditor();
    } catch (err) {
      if (toaster != null) {
        toaster.showError(err);
      } else {
        setError(err instanceof Error ? err.message : 'Request failed');
      }
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const handleCreateFromCatalog = (providerType: string) => {
    const entry = catalog.find(item => item.type === providerType);
    if (!entry || !apiKey.trim()) return;

    void runMutation(async () => {
      await modelCatalog.createModelProvider({
        type: entry.type,
        name: entry.name,
        apiKey: apiKey.trim(),
        models: entry.models,
      });
    }).catch(() => {});
  };

  const handleReplaceKey = (provider: ModelProviderBase) => {
    if (!apiKey.trim()) return;

    void runMutation(async () => {
      await modelCatalog.updateModelProvider({
        id: provider.id,
        type: provider.type,
        name: provider.name,
        ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
        apiKey: apiKey.trim(),
        models: provider.models,
      });
    }).catch(() => {});
  };

  const handleRemoveProvider = (provider: ModelProviderBase) => {
    if (!modelCatalog.deleteModelProvider) return;

    void runMutation(async () => {
      await modelCatalog.deleteModelProvider!({ id: provider.id });
    }).catch(() => {});
  };

  const handleUpdateModels = (provider: ModelProviderBase, models: ModelEntry[]) => {
    void runMutation(async () => {
      // apiKey required on update; empty means "keep existing" for hosts that support it.
      await modelCatalog.updateModelProvider({
        id: provider.id,
        type: provider.type,
        name: provider.name,
        ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
        apiKey: '',
        models,
      });
    }).catch(() => {});
  };

  const handleAddCustomProvider = async (draft: CustomProviderDraft) => {
    await runMutation(async () => {
      await modelCatalog.createModelProvider({
        type: 'custom',
        name: draft.name,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        models: draft.models,
      });
    });
  };

  const renderKeyEditor = (opts: { id: string; submitLabel: string; onSave: () => void }) => (
    <form
      className="mt-4 rounded-lg border border-border bg-muted/20 p-4"
      onSubmit={event => {
        event.preventDefault();
        opts.onSave();
      }}
    >
      <label
        htmlFor={`api-key-${opts.id}`}
        className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        API key
      </label>
      <input
        id={`api-key-${opts.id}`}
        type="password"
        value={apiKey}
        onChange={event => {
          setApiKey(event.target.value);
        }}
        placeholder="Enter API Key"
        autoFocus
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={closeKeyEditor} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={!apiKey.trim() || busy}>
          {opts.submitLabel}
        </Button>
      </div>
    </form>
  );

  return (
    <>
      <h3 className="text-xl font-semibold tracking-tight text-foreground">Models</h3>
      <p className="mt-1 text-sm text-muted-foreground">Connect providers and choose which models are available.</p>

      {error ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex-1 overflow-y-hidden">
        <div className="flex h-full flex-col gap-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <SearchInput query={query} setQuery={setQuery} placeholder="Search providers and models" />
            </div>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setCustomProviderOpen(true);
              }}
            >
              <Icon name="plus" size="1rem" className="mr-1" />
              Add Custom Provider
            </Button>
          </div>

          <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p> : null}

            {!loading && matchingConfigured.length > 0 ? (
              <section aria-labelledby="configured-providers-heading">
                <div
                  id="configured-providers-heading"
                  className="mb-2 text-[0.8125rem] font-semibold uppercase text-muted-foreground"
                >
                  Configured
                </div>

                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {matchingConfigured.map(provider => {
                    const catalogModels = catalogModelsByType.get(provider.type) ?? [];
                    const configuredIds = new Set(provider.models.map(model => model.id));
                    const availableModels = catalogModels.filter(model => !configuredIds.has(model.id));

                    return (
                      <article key={provider.id} className="border-b border-border p-3 last:border-b-0">
                        <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
                              aria-hidden
                            >
                              {modelProviderIconMap[provider.name] ? (
                                <img
                                  src={modelProviderIconMap[provider.name]}
                                  alt={provider.name}
                                  className="size-4.5"
                                />
                              ) : (
                                <Icon name="cpu" className="size-4.5" />
                              )}
                            </div>
                            <h5 className="truncate text-base font-medium text-foreground">{provider.name}</h5>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                            <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary"></span>
                              Connected
                            </span>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="text-[0.8125rem]"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setEditingCatalogType(null);
                                setEditingProviderId(provider.id);
                                setApiKey('');
                              }}
                            >
                              <Icon name="wrench" className="size-3.5" />
                              Replace key
                            </Button>
                            {modelCatalog.deleteModelProvider ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="transition-colors hover:bg-destructive/10 hover:text-destructive"
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  handleRemoveProvider(provider);
                                }}
                              >
                                Remove
                              </Button>
                            ) : null}
                          </div>
                        </header>

                        {editingProviderId === provider.id
                          ? renderKeyEditor({
                              id: provider.id,
                              submitLabel: 'Update',
                              onSave: () => {
                                handleReplaceKey(provider);
                              },
                            })
                          : null}

                        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-secondary/30">
                          {provider.models.map(model => (
                            <div
                              key={model.id}
                              className="flex min-h-10 items-center gap-3 border-b border-border px-3 py-2 text-sm text-foreground last:border-b-0"
                            >
                              <span className="min-w-0 flex-1 truncate">{model.name}</span>
                              <button
                                type="button"
                                aria-label={`Remove ${model.name}`}
                                disabled={busy}
                                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                                onClick={() => {
                                  handleUpdateModels(
                                    provider,
                                    provider.models.filter(item => item.id !== model.id),
                                  );
                                }}
                              >
                                <Icon name="trash" className="size-3.5" />
                              </button>
                            </div>
                          ))}

                          {availableModels.length > 0 ? (
                            <section>
                              <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Available to add · {availableModels.length}
                              </div>
                              {availableModels.map(model => (
                                <div
                                  key={model.id}
                                  className="flex min-h-12 items-center gap-3 border-b border-border px-3 py-2 text-sm text-foreground last:border-b-0"
                                >
                                  <span className="min-w-0 flex-1 truncate">{model.name}</span>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                      handleUpdateModels(provider, [...provider.models, model]);
                                    }}
                                  >
                                    Add
                                  </Button>
                                </div>
                              ))}
                            </section>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {!loading && matchingAvailable.length > 0 ? (
              <section aria-labelledby="available-providers-heading" className="mt-2">
                <div
                  id="available-providers-heading"
                  className="mb-2 text-[0.8125rem] font-semibold uppercase text-muted-foreground"
                >
                  Available
                </div>

                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {matchingAvailable.map(provider => (
                    <article key={provider.type} className="border-b border-border p-3 last:border-b-0">
                      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span
                            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
                            aria-hidden
                          >
                            {modelProviderIconMap[provider.name] ? (
                              <img src={modelProviderIconMap[provider.name]} alt={provider.name} className="size-4.5" />
                            ) : (
                              <Icon name="cpu" className="size-4.5" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <h5 className="truncate text-base font-medium text-foreground">{provider.name}</h5>
                            <p className="truncate text-sm text-muted-foreground">
                              {provider.models.map(model => model.name).join(' · ')}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEditingProviderId(null);
                            setEditingCatalogType(provider.type);
                            setApiKey('');
                          }}
                        >
                          <Icon name="wrench" className="size-4" />
                          Configure
                        </Button>
                      </header>
                      {editingCatalogType === provider.type
                        ? renderKeyEditor({
                            id: provider.type,
                            submitLabel: 'Create',
                            onSave: () => {
                              handleCreateFromCatalog(provider.type);
                            },
                          })
                        : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {!loading && matchingConfigured.length === 0 && matchingAvailable.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {normalizedQuery ? `No providers match “${query.trim()}”.` : 'No model providers yet.'}
              </div>
            ) : null}
          </div>

          <CustomModelProviderForm
            open={customProviderOpen}
            onOpenChange={setCustomProviderOpen}
            onAdd={handleAddCustomProvider}
            reasoningEffortOptions={supportedReasoningEfforts}
            busy={busy}
          />
        </div>
      </div>
    </>
  );
};

export default ModelSettings;
