'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/atoms/primitives/Button.js';
import { CatalogLogo } from '@/atoms/primitives/CatalogLogo.js';
import SearchInput from '@/atoms/primitives/SearchInput.js';
import ConfigureModelProviderForm, {
  type ModelProviderKeyDraft,
} from '@/containers/SettingsBuilder/ConfigureModelProviderForm.js';
import CustomModelProviderForm, {
  type CustomProviderDraft,
} from '@/containers/SettingsBuilder/CustomModelProviderForm.js';
import { useToasterOptional } from '@/containers/ToasterContainer.js';
import { Icon } from '@/icons/Icon.js';
import { useCatalogServer } from '@/server/ServerContext.js';
import type { ModelEntry, ModelProviderBase, ModelProviderCatalogEntry } from '@/server/types.js';
import { getErrorMessage } from '@/utils/getErrorMessage.js';

function catalogBaseUrl(provider: ModelProviderCatalogEntry): string {
  if ('baseUrl' in provider && typeof provider.baseUrl === 'string') {
    return provider.baseUrl;
  }
  return '';
}

const ModelSettings = () => {
  const { modelCatalog } = useCatalogServer();
  const toaster = useToasterOptional();

  const [query, setQuery] = useState('');
  const [configured, setConfigured] = useState<ModelProviderBase[]>([]);
  const [catalog, setCatalog] = useState<ModelProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editingCatalogType, setEditingCatalogType] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [customProviderOpen, setCustomProviderOpen] = useState(false);
  const [customProviderToEdit, setCustomProviderToEdit] = useState<ModelProviderBase | null>(null);

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
      setError(getErrorMessage(err, 'Failed to load model providers'));
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
          provider.name?.toLowerCase().includes(normalizedQuery) ||
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
    setKeyError(null);
  };

  const runMutation = async (fn: () => Promise<void>, onError?: (error: unknown) => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      closeKeyEditor();
    } catch (err) {
      if (onError) {
        onError(err);
      } else if (toaster == null) {
        setError(getErrorMessage(err, 'Request failed'));
      } else {
        toaster.showError(err);
      }
      throw err;
    } finally {
      setBusy(false);
    }
  };

  // The key/endpoint modal owns the draft and awaits these handlers: on failure runMutation
  // re-throws so the modal stays open and shows `keyError`; on success it closes the editor.
  const handleCreateFromCatalog = async (entry: ModelProviderCatalogEntry, draft: ModelProviderKeyDraft) => {
    setKeyError(null);
    await runMutation(
      async () => {
        await modelCatalog.createModelProvider({
          type: entry.type,
          name: entry.name,
          ...(draft.baseUrl ? { baseUrl: draft.baseUrl } : {}),
          apiKey: draft.apiKey,
          models: entry.models,
        });
      },
      err => setKeyError(getErrorMessage(err, 'Request failed')),
    );
  };

  const handleReplaceKey = async (provider: ModelProviderBase, draft: ModelProviderKeyDraft) => {
    setKeyError(null);
    await runMutation(
      async () => {
        await modelCatalog.updateModelProvider({
          id: provider.id,
          type: provider.type,
          name: provider.name,
          ...(draft.baseUrl ? { baseUrl: draft.baseUrl } : {}),
          // Empty key means "keep the existing one" for hosts that support it.
          apiKey: draft.apiKey,
          models: provider.models,
        });
      },
      err => setKeyError(getErrorMessage(err, 'Request failed')),
    );
    toaster?.showSuccess({ title: `${provider.name} updated` });
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
    setFormError(null);
    await runMutation(
      async () => {
        await modelCatalog.createModelProvider({
          type: 'custom',
          name: draft.name,
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey,
          models: draft.models,
        });
      },
      err => setFormError(getErrorMessage(err, 'Request failed')),
    );
    setTimeout(() => {
      toaster?.showSuccess({ title: `${draft.name} added` });
    }, 0);
  };

  const handleUpdateCustomProvider = async (draft: CustomProviderDraft) => {
    if (!customProviderToEdit) return;

    const provider = customProviderToEdit;
    setFormError(null);
    await runMutation(
      async () => {
        await modelCatalog.updateModelProvider({
          id: provider.id,
          type: provider.type,
          name: provider.name,
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey,
          models: draft.models,
        });
      },
      err => setFormError(getErrorMessage(err, 'Request failed')),
    );
    setTimeout(() => {
      toaster?.showSuccess({
        title: 'Model provider updated',
        description: `${provider.name} was updated successfully.`,
      });
    }, 0);
  };

  const customProviderInitialValues = customProviderToEdit
    ? {
        name: customProviderToEdit.name,
        baseUrl: customProviderToEdit.baseUrl ?? '',
        models: customProviderToEdit.models,
      }
    : undefined;

  // The key/endpoint editor is a single centered modal driven by which entry is being edited.
  const editingProvider =
    editingProviderId != null ? (configured.find(item => item.id === editingProviderId) ?? null) : null;
  const editingCatalogEntry =
    editingCatalogType != null ? (catalog.find(item => item.type === editingCatalogType) ?? null) : null;
  const keyModalOpen = editingProvider != null || editingCatalogEntry != null;

  return (
    <>
      <h3 className="text-xl font-semibold tracking-tight text-text-primary">Models</h3>
      <p className="mt-1 text-sm text-text-secondary">Connect providers and choose which models are available.</p>

      {error ? (
        <p className="mt-3 rounded-md border border-failure-bg/30 bg-failure-bg/10 px-3 py-2 text-sm text-failure-bg">
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
                setFormError(null);
                setCustomProviderToEdit(null);
                setCustomProviderOpen(true);
              }}
            >
              <Icon name="plus" size="1rem" className="mr-1" />
              Add Custom Provider
            </Button>
          </div>

          <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {loading ? <p className="py-8 text-center text-sm text-text-secondary">Loading…</p> : null}

            {!loading && matchingConfigured.length > 0 ? (
              <section aria-labelledby="configured-providers-heading">
                <div
                  id="configured-providers-heading"
                  className="mb-2 text-[0.8125rem] font-semibold uppercase text-text-secondary"
                >
                  Configured
                </div>

                <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
                  {matchingConfigured.map(provider => {
                    const catalogModels = catalogModelsByType.get(provider.type) ?? [];
                    const configuredIds = new Set(provider.models.map(model => model.id));
                    const availableModels = catalogModels.filter(model => !configuredIds.has(model.id));
                    const logoSrc = modelProviderIconMap[provider.name];

                    return (
                      <article key={provider.id} className="border-b border-border p-3 last:border-b-0">
                        <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-primary"
                              aria-hidden
                            >
                              {logoSrc ? (
                                <CatalogLogo src={logoSrc} alt={provider.name} className="size-4.5" />
                              ) : (
                                <Icon name="cpu" className="size-4.5" />
                              )}
                            </div>
                            <h5 className="truncate text-base font-medium text-text-primary">{provider.name}</h5>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                            <span className="flex items-center gap-1.5 rounded-full border border-border bg-secondary-bg/40 px-2 py-0.5 text-xs font-medium text-success-bg">
                              <span className="h-1.5 w-1.5 rounded-full bg-success-bg"></span>
                              Connected
                            </span>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="text-[0.8125rem]"
                              type="button"
                              aria-label={`Edit ${provider.name}`}
                              title={`Edit ${provider.name}`}
                              disabled={busy}
                              onClick={() => {
                                if (provider.type === 'custom') {
                                  closeKeyEditor();
                                  setFormError(null);
                                  setCustomProviderToEdit(provider);
                                  setCustomProviderOpen(true);
                                } else {
                                  setKeyError(null);
                                  setEditingCatalogType(null);
                                  setEditingProviderId(provider.id);
                                }
                              }}
                            >
                              <Icon name="wrench" className="size-3.5" />
                              Edit
                            </Button>
                            {modelCatalog.deleteModelProvider ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="transition-colors hover:bg-failure-bg/10 hover:text-failure-bg"
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

                        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-secondary-bg/30">
                          {provider.models.map(model => (
                            <div
                              key={model.id}
                              className="flex min-h-10 items-center gap-3 border-b border-border px-3 py-2 text-sm text-text-primary last:border-b-0"
                            >
                              <span className="min-w-0 flex-1 truncate">{model.name}</span>
                              <button
                                type="button"
                                aria-label={`Remove ${model.name}`}
                                disabled={busy}
                                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-ghost-button-hover hover:text-ghost-button-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring disabled:opacity-50"
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
                              <div className="border-b border-border bg-secondary-bg/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                                Available to add · {availableModels.length}
                              </div>
                              {availableModels.map(model => (
                                <div
                                  key={model.id}
                                  className="flex min-h-12 items-center gap-3 border-b border-border px-3 py-2 text-sm text-text-primary last:border-b-0"
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
                  className="mb-2 text-[0.8125rem] font-semibold uppercase text-text-secondary"
                >
                  Available
                </div>

                <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
                  {matchingAvailable.map(provider => {
                    const logoSrc = modelProviderIconMap[provider.name];
                    return (
                      <article key={provider.type} className="border-b border-border p-3 last:border-b-0">
                        <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span
                              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-primary"
                              aria-hidden
                            >
                              {logoSrc ? (
                                <CatalogLogo src={logoSrc} alt={provider.name} className="size-4.5" />
                              ) : (
                                <Icon name="cpu" className="size-4.5" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <h5 className="truncate text-base font-medium text-text-primary">{provider.name}</h5>
                              <p className="truncate text-sm text-text-secondary">
                                {provider.models.map(model => model.name).join(' · ')}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="secondary"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setKeyError(null);
                              setEditingProviderId(null);
                              setEditingCatalogType(provider.type);
                            }}
                          >
                            <Icon name="wrench" className="size-4" />
                            Configure
                          </Button>
                        </header>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {!loading && matchingConfigured.length === 0 && matchingAvailable.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm text-text-secondary">
                {normalizedQuery ? `No providers match “${query.trim()}”.` : 'No model providers yet.'}
              </div>
            ) : null}
          </div>

          <ConfigureModelProviderForm
            open={keyModalOpen}
            onOpenChange={open => {
              if (!open) closeKeyEditor();
            }}
            onSave={draft => {
              if (editingProvider) return handleReplaceKey(editingProvider, draft);
              if (editingCatalogEntry) return handleCreateFromCatalog(editingCatalogEntry, draft);
            }}
            title={editingProvider ? 'Edit Provider Details' : 'Configure Provider Details'}
            initialBaseUrl={
              editingProvider
                ? (editingProvider.baseUrl ?? '')
                : editingCatalogEntry
                  ? catalogBaseUrl(editingCatalogEntry)
                  : ''
            }
            requireApiKey={editingProvider == null}
            submitLabel={editingProvider ? 'Save' : 'Create'}
            busy={busy}
            error={keyError}
          />

          <CustomModelProviderForm
            key={customProviderToEdit?.id ?? 'add-custom-provider'}
            open={customProviderOpen}
            onOpenChange={open => {
              setCustomProviderOpen(open);
              if (!open) {
                setFormError(null);
                setCustomProviderToEdit(null);
              }
            }}
            isEditMode={customProviderToEdit !== null}
            initialValues={customProviderInitialValues}
            onSubmit={customProviderToEdit ? handleUpdateCustomProvider : handleAddCustomProvider}
            reasoningEffortOptions={supportedReasoningEfforts}
            busy={busy}
            error={formError}
          />
        </div>
      </div>
    </>
  );
};

export default ModelSettings;
