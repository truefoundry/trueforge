'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '../../atoms/primitives/Button.js';
import { Icon } from '../../icons/Icon.js';
import { useCatalogServer } from '../../server/ServerContext.js';
import type { SandboxBase, SandboxCatalogEntry, SandboxConfig } from '../../server/types.js';
import ConfigureSandboxForm, { type SandboxConfigDraft } from './ConfigureSandboxForm.js';

const configFrom = ({
  snapshotName,
  execTimeoutMs,
  autoStopIntervalInMinutes,
  autoArchiveIntervalInMinutes,
  autoDeleteIntervalInMinutes,
}: SandboxConfig): SandboxConfig => ({
  snapshotName,
  execTimeoutMs,
  autoStopIntervalInMinutes,
  autoArchiveIntervalInMinutes,
  autoDeleteIntervalInMinutes,
});

const SandboxSettings = () => {
  const { sandboxCatalog } = useCatalogServer();

  const [sandboxes, setSandboxes] = useState<SandboxBase[]>([]);
  const [catalog, setCatalog] = useState<SandboxCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createEntry, setCreateEntry] = useState<SandboxCatalogEntry | null>(null);
  const [updateSandbox, setUpdateSandbox] = useState<SandboxBase | null>(null);

  const refresh = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (!sandboxCatalog) return;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const [listed, available] = await Promise.all([
          sandboxCatalog.listSandboxes(),
          sandboxCatalog.getSandboxCatalog(),
        ]);
        setSandboxes(listed);
        setCatalog(available);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sandboxes');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [sandboxCatalog],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const availableEntries = useMemo(() => {
    const connectedCatalogIds = new Set(sandboxes.map(sandbox => sandbox.catalogId));
    return catalog.filter(entry => !connectedCatalogIds.has(entry.id));
  }, [catalog, sandboxes]);

  const formInitialConfig = useMemo(
    () => (updateSandbox ? configFrom(updateSandbox) : createEntry ? configFrom(createEntry) : null),
    [updateSandbox, createEntry],
  );

  if (!sandboxCatalog) {
    return <p className="text-sm text-muted-foreground">Sandbox catalog is not available.</p>;
  }

  const runMutation = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (draft: SandboxConfigDraft) => {
    if (!createEntry) return;
    await runMutation(async () => {
      await sandboxCatalog.createSandbox({
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
    if (!updateSandbox) return;
    await runMutation(async () => {
      await sandboxCatalog.updateSandbox({
        id: updateSandbox.id,
        ...configFrom(draft),
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      });
    });
    setUpdateSandbox(null);
  };

  const handleRemove = (sandbox: SandboxBase) => {
    void runMutation(async () => {
      await sandboxCatalog.deleteSandbox({ id: sandbox.id });
    }).catch(() => {});
  };

  const formOpen = createEntry != null || updateSandbox != null;
  const isUpdate = updateSandbox != null;
  const formTitle = updateSandbox
    ? `Update ${updateSandbox.name}`
    : createEntry
      ? `Configure ${createEntry.name}`
      : 'Configure sandbox';

  return (
    <>
      <h3 className="text-xl font-semibold tracking-tight text-foreground">Sandbox</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        A secure, isolated environment for running code, files, and shell commands.
      </p>

      {error ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading sandboxes…</p>
        ) : (
          <div className="space-y-6">
            {sandboxes.length > 0 ? (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Connected · {sandboxes.length}
                </h4>
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {sandboxes.map(sandbox => (
                    <article
                      key={sandbox.id}
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
                          <h5 className="truncate text-sm font-medium text-foreground">{sandbox.name}</h5>
                          <p className="truncate text-[0.8125rem] text-muted-foreground">{sandbox.snapshotName}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                        {sandbox.isConnected ? (
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
                            setUpdateSandbox(sandbox);
                          }}
                        >
                          Update
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            handleRemove(sandbox);
                          }}
                        >
                          Remove
                        </Button>
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
                  {sandboxes.length > 0 ? 'All catalog sandboxes are configured.' : 'No sandboxes in the catalog.'}
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
                          setUpdateSandbox(null);
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
            setUpdateSandbox(null);
          }
        }}
        onSave={isUpdate ? handleUpdate : handleCreate}
        title={formTitle}
        description={
          isUpdate
            ? 'Update sandbox settings. Leave API key blank to keep the existing key.'
            : 'Managed sandbox settings. API key is never stored in the catalog.'
        }
        initialConfig={formInitialConfig}
        requireApiKey={!isUpdate}
        busy={busy}
      />
    </>
  );
};

export default SandboxSettings;
