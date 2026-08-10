'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/atoms/primitives/Button.js';
import { CenteredModal } from '@/atoms/primitives/CenteredModal.js';
import SearchInput from '@/atoms/primitives/SearchInput.js';
import { useMCPAuth } from '@/hooks/useMcpAuth.js';
import { Icon } from '@/icons/Icon.js';
import { useCatalogServer } from '@/server/ServerContext.js';
import type { ConnectorAuth, ConnectorBase, ConnectorCatalogEntry } from '@/server/types.js';
import { getErrorMessage } from '@/utils/getErrorMessage.js';
import AddMcpServerForm, { type AddMcpServerDraft } from './AddMcpServerForm.js';
import { AUTH_TYPE_LABELS } from './authTypeLabels.js';
import ConnectorDetails from './ConnectorDetails.js';

type ConnectorListItem =
  { connector: ConnectorBase; isConfigured: true } | { connector: ConnectorCatalogEntry; isConfigured: false };

type ConnectorsState = {
  ordered: ConnectorListItem[];
  authStatusById: Map<string, boolean>;
};

const ConnectorSettings = () => {
  const { connectorCatalog } = useCatalogServer();
  const { handleAuthorize, isOAuthLoading } = useMCPAuth();

  const [query, setQuery] = useState('');
  const [connectors, setConnectors] = useState<ConnectorsState>({
    ordered: [],
    authStatusById: new Map(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [catalog, setCatalog] = useState<ConnectorCatalogEntry[]>([]);
  const [addMcpServerFormOpen, setAddMcpServerFormOpen] = useState(false);
  const [connectorAwaitingKey, setConnectorAwaitingKey] = useState<ConnectorCatalogEntry | null>(null);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorBase | null>(null);
  const [apiKey, setApiKey] = useState('');

  const connectorIconMap = useMemo(() => {
    return (catalog ?? []).reduce(
      (acc, entry) => {
        acc[entry.name] = entry.logo ?? '';
        return acc;
      },
      {} as Record<string, string>,
    );
  }, [catalog]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listed, available] = await Promise.all([
        connectorCatalog.listConnectors(),
        connectorCatalog.getConnectorCatalog(),
      ]);
      setCatalog(available);
      const configured = listed ?? [];
      const seenIds = new Set(configured.map(connector => connector.id));
      const ordered: ConnectorListItem[] = [
        ...configured.map<ConnectorListItem>(connector => ({ connector, isConfigured: true })),
        ...available
          .filter(connector => !seenIds.has(connector.id))
          .map<ConnectorListItem>(connector => ({ connector, isConfigured: false })),
      ];
      setConnectors({
        ordered,
        authStatusById: new Map(
          ordered.map(item => [item.connector.id, item.isConfigured ? item.connector.authenticated : false]),
        ),
      });
      setSelectedConnector(current => (current ? (listed.find(item => item.id === current.id) ?? null) : null));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load connectors'));
    } finally {
      setLoading(false);
    }
  }, [connectorCatalog]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const normalizedQuery = query.trim().toLowerCase();

  const matchingConnectors = useMemo(() => {
    if (!normalizedQuery) return connectors.ordered;
    return connectors.ordered.filter(({ connector }) => {
      return (
        connector.name.toLowerCase().includes(normalizedQuery) ||
        (connector.description?.toLowerCase().includes(normalizedQuery) ?? false) ||
        connector.url.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [connectors.ordered, normalizedQuery]);

  const matchingConnected = useMemo(() => {
    const result: ConnectorBase[] = [];
    for (const item of matchingConnectors) {
      if (item.isConfigured) {
        const authenticated = connectors.authStatusById.get(item.connector.id) ?? item.connector.authenticated;
        if (authenticated || !item.connector.requiresAuth) {
          result.push(
            authenticated === item.connector.authenticated ? item.connector : { ...item.connector, authenticated },
          );
        }
      }
    }
    return result;
  }, [connectors.authStatusById, matchingConnectors]);

  const availableConnectors = useMemo(() => {
    const connectedIds = new Set(matchingConnected.map(connector => connector.id));
    return matchingConnectors
      .filter(({ connector }) => !connectedIds.has(connector.id))
      .map(({ connector }) => connector);
  }, [matchingConnected, matchingConnectors]);

  const runMutation = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(getErrorMessage(err, 'Request failed'));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const closeApiKeyModal = () => {
    setConnectorAwaitingKey(null);
    setApiKey('');
  };

  const authorizeOAuthConnector = async (integrationId: string) => {
    await handleAuthorize(integrationId, isSuccess => {
      if (isSuccess) {
        void connectorCatalog
          .getConnector({ id: integrationId })
          .then(connector => {
            setConnectors(current => {
              const updated = new Map(current.authStatusById);
              updated.set(connector.id, connector.authenticated);
              return { ...current, authStatusById: updated };
            });
          })
          .catch(err => {
            setError(getErrorMessage(err, 'Failed to load connector'));
          });
      }
    });
  };

  const createFromCatalog = async (entry: ConnectorCatalogEntry, authOverride?: ConnectorAuth) => {
    const auth: ConnectorAuth =
      authOverride ??
      (entry.auth.type === 'header'
        ? {
            type: 'header',
            ...(entry.auth.headerName ? { headerName: entry.auth.headerName } : {}),
          }
        : entry.auth.type === 'dcr'
          ? { type: 'dcr' }
          : { type: 'none' });
    const created = await connectorCatalog.createConnector({
      name: entry.name,
      url: entry.url,
      auth,
    });
    if (auth.type === 'dcr') {
      await authorizeOAuthConnector(created.id);
    }
  };

  const handleConnect = (entry: ConnectorCatalogEntry) => {
    if (entry.auth.type === 'header') {
      setApiKey('');
      setConnectorAwaitingKey(entry);
      return;
    }

    void runMutation(async () => {
      const existing = connectors.ordered.find(({ connector }) => connector.id === entry.id);
      const existingConnector = existing?.isConfigured ? existing.connector : undefined;
      if (existingConnector) {
        await authorizeOAuthConnector(existingConnector.id);
      } else {
        await createFromCatalog(entry);
      }
    }).catch(() => {});
  };

  const handleApiKeySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connectorAwaitingKey || !apiKey.trim()) return;

    const entry = connectorAwaitingKey;
    void runMutation(async () => {
      const auth: ConnectorAuth = {
        type: 'header',
        apiKey: apiKey.trim(),
        ...(entry.auth.type === 'header' && entry.auth.headerName ? { headerName: entry.auth.headerName } : {}),
      };
      const existing = connectors.ordered.find(({ connector }) => connector.id === entry.id);
      const existingConnector = existing?.isConfigured ? existing.connector : undefined;
      if (existingConnector) {
        await connectorCatalog.updateConnector({
          id: existingConnector.id,
          name: existingConnector.name,
          url: existingConnector.url,
          auth,
        });
      } else {
        await createFromCatalog(entry, auth);
      }
      closeApiKeyModal();
    }).catch(() => {});
  };

  const handleAddMcpServer = async (draft: AddMcpServerDraft) => {
    await runMutation(async () => {
      const created = await connectorCatalog.createConnector({
        name: draft.name,
        url: draft.url,
        auth: draft.auth,
      });
      if (draft.auth.type === 'dcr') {
        await authorizeOAuthConnector(created.id);
      }
    });
  };

  const handleDisconnect = (connector: ConnectorBase) => {
    void runMutation(async () => {
      await connectorCatalog.disconnectConnector({ id: connector.id });
      setSelectedConnector(null);
    }).catch(() => {});
  };

  const renderConnector = (connector: ConnectorBase, isConnected: boolean) => {
    const content = (
      <>
        <span
          className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted"
          aria-hidden
        >
          {connectorIconMap[connector.name] ? (
            <img src={connectorIconMap[connector.name]} alt={connector.name} className="size-4.5" />
          ) : (
            <Icon name="mcp-server" className="size-4.5 text-foreground" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h5 className="truncate text-sm font-medium text-foreground">{connector.name}</h5>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground sm:truncate">{connector.description}</p>
        </div>
      </>
    );

    const rowClassName = 'flex min-h-16 w-full items-center gap-3 border-b border-border p-3 text-left last:border-b-0';

    if (isConnected) {
      return (
        <article
          key={connector.id}
          className={`${rowClassName} cursor-pointer transition-colors hover:bg-accent/40`}
          onClick={() => {
            setSelectedConnector(connector);
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary"></span>
                {connector.authenticated ? 'Connected' : 'Added'}
              </span>
              <Icon name="chevron-right" className="size-4" />
            </div>
            {connector.auth.type === 'header' ? (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={busy || isOAuthLoading}
                onClick={event => {
                  event.stopPropagation();
                  setApiKey('');
                  setConnectorAwaitingKey(connector);
                }}
              >
                <Icon name="wrench" className="size-3" />
                Replace Key
              </Button>
            ) : null}
          </div>
        </article>
      );
    }

    return (
      <article key={connector.id} className={rowClassName}>
        {content}
      </article>
    );
  };

  const renderCatalogEntry = (entry: ConnectorCatalogEntry) => (
    <article
      key={entry.id}
      className="flex min-h-16 w-full items-center gap-3 border-b border-border p-3 text-left last:border-b-0"
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted"
        aria-hidden
      >
        {connectorIconMap[entry.name] ? (
          <img src={connectorIconMap[entry.name]} alt={entry.name} className="size-4.5" />
        ) : (
          <Icon name="mcp-server" className="size-4.5 text-foreground" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <h5 className="truncate text-sm font-medium text-foreground">{entry.name}</h5>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground sm:truncate">
          {entry.description ?? entry.url}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {AUTH_TYPE_LABELS[entry.auth.type] ?? AUTH_TYPE_LABELS.none}
        </span>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={busy || isOAuthLoading}
          onClick={() => {
            handleConnect(entry);
          }}
        >
          Connect
        </Button>
      </div>
    </article>
  );
  const isReplacingKey = useMemo(() => {
    return (
      connectorAwaitingKey !== null &&
      connectors.ordered.some(
        (item: ConnectorListItem) => item.isConfigured && item.connector.id === connectorAwaitingKey.id,
      )
    );
  }, [connectorAwaitingKey, connectors.ordered]);

  if (selectedConnector) {
    return (
      <ConnectorDetails
        connector={selectedConnector}
        busy={busy}
        onBack={() => {
          setSelectedConnector(null);
        }}
        onDisconnect={() => {
          handleDisconnect(selectedConnector);
        }}
      />
    );
  }

  const hasMatches = matchingConnected.length > 0 || availableConnectors.length > 0;

  return (
    <>
      <h3 className="text-xl font-semibold tracking-tight text-foreground">Connectors</h3>
      <p className="mt-1 text-sm text-muted-foreground">Connect tools your agents can use.</p>

      {error ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex-1 overflow-y-hidden">
        <div className="flex h-full flex-col gap-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <SearchInput query={query} setQuery={setQuery} placeholder="Search connectors" />
            </div>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setAddMcpServerFormOpen(true);
              }}
            >
              <Icon name="plus" size="1rem" className="mr-1" />
              Add MCP Server
            </Button>
          </div>

          <div className="flex flex-1 flex-col gap-5 overflow-y-auto pb-1">
            {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p> : null}

            {!loading && matchingConnected.length > 0 ? (
              <section aria-labelledby="connected-connectors-heading">
                <h4
                  id="connected-connectors-heading"
                  className="mb-2 text-[0.8125rem] font-semibold uppercase text-muted-foreground"
                >
                  Connected · {matchingConnected.length}
                </h4>
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {matchingConnected.map(connector => renderConnector(connector, true))}
                </div>
              </section>
            ) : null}

            {!loading && availableConnectors.length > 0 ? (
              <section aria-labelledby="available-connectors-heading">
                <h4
                  id="available-connectors-heading"
                  className="mb-2 text-[0.8125rem] font-semibold uppercase text-muted-foreground"
                >
                  Available · {availableConnectors.length}
                </h4>
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {availableConnectors.map(entry => renderCatalogEntry(entry))}
                </div>
              </section>
            ) : null}

            {!loading && !hasMatches ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {query.trim() ? `No connectors match “${query.trim()}”.` : 'No connectors yet.'}
              </div>
            ) : null}
          </div>

          <CenteredModal
            open={connectorAwaitingKey !== null}
            onOpenChange={open => {
              if (!open) closeApiKeyModal();
            }}
            title={`${isReplacingKey ? 'Replace key for' : 'Connect'} ${connectorAwaitingKey?.name ?? 'connector'}`}
            description={connectorAwaitingKey?.url}
            contentSized
            className="md:max-w-xl"
          >
            <form onSubmit={handleApiKeySubmit}>
              <div className="space-y-5 px-5 py-5">
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted"
                    aria-hidden
                  >
                    <Icon name="mcp-server" className="size-6 text-foreground" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{connectorAwaitingKey?.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{connectorAwaitingKey?.description}</p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="connector-api-key"
                    className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    API key / token
                  </label>
                  <input
                    id="connector-api-key"
                    type="password"
                    value={apiKey}
                    onChange={event => {
                      setApiKey(event.target.value);
                    }}
                    placeholder={`Paste the token from ${connectorAwaitingKey?.name ?? 'the provider'}`}
                    autoFocus
                    required
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>
              </div>

              <footer className="flex justify-end gap-2 border-t border-border px-5 py-4">
                <Button variant="ghost" type="button" onClick={closeApiKeyModal} disabled={busy || isOAuthLoading}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!apiKey.trim() || busy || isOAuthLoading}>
                  {isReplacingKey ? 'Replace Key' : 'Connect'}
                </Button>
              </footer>
            </form>
          </CenteredModal>

          <AddMcpServerForm
            open={addMcpServerFormOpen}
            onOpenChange={setAddMcpServerFormOpen}
            onAdd={handleAddMcpServer}
            busy={busy || isOAuthLoading}
          />
        </div>
      </div>
    </>
  );
};

export default ConnectorSettings;
