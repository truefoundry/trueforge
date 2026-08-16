'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { cn } from '@/atoms/lib/cn.js';
import { auiInputClass } from '@/atoms/lib/inputClasses.js';
import { Button } from '@/atoms/primitives/Button.js';
import { CatalogLogo } from '@/atoms/primitives/CatalogLogo.js';
import { CenteredModal } from '@/atoms/primitives/CenteredModal.js';
import SearchInput from '@/atoms/primitives/SearchInput.js';
import { Icon } from '@/icons/Icon.js';
import { useCatalogServer } from '@/server/ServerContext.js';
import type { ConnectorAuth, ConnectorBase, ConnectorCatalogEntry } from '@/server/types.js';
import { getErrorMessage } from '@/utils/getErrorMessage.js';
import { useToasterOptional } from '../ToasterContainer.js';
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
  const toaster = useToasterOptional();

  const [query, setQuery] = useState('');
  const [connectors, setConnectors] = useState<ConnectorsState>({
    ordered: [],
    authStatusById: new Map(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
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
        result.push(
          authenticated === item.connector.authenticated ? item.connector : { ...item.connector, authenticated },
        );
      }
    }
    return result;
  }, [connectors.authStatusById, matchingConnectors]);

  const availableConnectors = useMemo(() => {
    const result: ConnectorCatalogEntry[] = [];
    for (const item of matchingConnectors) {
      if (!item.isConfigured) result.push(item.connector);
    }
    return result;
  }, [matchingConnectors]);

  const runMutation = async (fn: () => Promise<void>, setMutationError = setError) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setMutationError(getErrorMessage(err, 'Request failed'));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const closeApiKeyModal = () => {
    setConnectorAwaitingKey(null);
    setApiKey('');
    setFormError(null);
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
    await connectorCatalog.createConnector({
      name: entry.name,
      description: entry.description ?? entry.url,
      url: entry.url,
      auth,
    });
  };

  const handleConnect = (entry: ConnectorCatalogEntry) => {
    if (entry.auth.type === 'header') {
      setApiKey('');
      setFormError(null);
      setConnectorAwaitingKey(entry);
      return;
    }

    void runMutation(async () => {
      await createFromCatalog(entry);
    }).catch(() => {});
  };

  const handleApiKeySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!connectorAwaitingKey || !apiKey.trim()) return;

    const entry = connectorAwaitingKey;
    setFormError(null);
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
          description: existingConnector.description,
          url: existingConnector.url,
          auth,
        });
      } else {
        await createFromCatalog(entry, auth);
      }
      closeApiKeyModal();
      setTimeout(() => {
        toaster?.showSuccess({
          title: `${entry.name} ${existingConnector ? 'updated' : 'connected'}`,
        });
      }, 100);
    }, setFormError).catch(() => {});
  };

  const handleAddMcpServer = async (draft: AddMcpServerDraft) => {
    setFormError(null);
    await runMutation(async () => {
      await connectorCatalog.createConnector({ ...draft });
    }, setFormError);
    setTimeout(() => {
      toaster?.showSuccess({ title: `${draft.name} added` });
    }, 0);
  };

  const handleDisconnect = (connector: ConnectorBase) => {
    void runMutation(async () => {
      await connectorCatalog.disconnectConnector({ id: connector.id });
      setSelectedConnector(null);
    }).catch(() => {});
  };

  const handleConnectorRefreshed = (refreshedConnector: ConnectorBase) => {
    setSelectedConnector(current => (current?.id === refreshedConnector.id ? refreshedConnector : current));
    setConnectors(current => {
      const authStatusById = new Map(current.authStatusById);
      authStatusById.set(refreshedConnector.id, refreshedConnector.authenticated);

      return {
        ordered: current.ordered.map(item =>
          item.isConfigured && item.connector.id === refreshedConnector.id
            ? { connector: refreshedConnector, isConfigured: true }
            : item,
        ),
        authStatusById,
      };
    });
  };

  const renderConnector = (connector: ConnectorBase, isConnected: boolean) => {
    const logoSrc = connectorIconMap[connector.name];
    const content = (
      <>
        <span
          className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary-bg"
          aria-hidden
        >
          {logoSrc ? (
            <CatalogLogo src={logoSrc} alt={connector.name} className="size-4.5" />
          ) : (
            <Icon name="mcp-server" className="size-4.5 text-text-primary" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h5 className="truncate text-sm font-medium text-text-primary">{connector.name}</h5>
          <p className="mt-0.5 line-clamp-2 text-sm text-text-secondary sm:truncate">{connector.description}</p>
        </div>
      </>
    );

    const rowClassName = 'flex min-h-16 w-full items-center gap-3 border-b border-border p-3 text-left last:border-b-0';

    if (isConnected) {
      return (
        <article
          key={connector.id}
          className={`${rowClassName} cursor-pointer transition-colors hover:bg-ghost-button-hover/60`}
          onClick={() => {
            setSelectedConnector(connector);
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-full border border-border bg-secondary-bg/40 px-2 py-0.5 text-xs font-medium',
                  connector.authenticated ? 'text-success-bg' : 'text-text-primary',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    connector.authenticated ? 'bg-success-bg' : 'bg-primary-button-bg',
                  )}
                ></span>
                {connector.authenticated ? 'Connected' : 'Added'}
              </span>
            </div>
            {connector.auth.type === 'header' ? (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={busy}
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
            <Icon name="chevron-right" className="size-4" />
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

  const renderCatalogEntry = (entry: ConnectorCatalogEntry) => {
    const logoSrc = connectorIconMap[entry.name];
    return (
      <article
        key={entry.id}
        className="flex min-h-16 w-full items-center gap-3 border-b border-border p-3 text-left last:border-b-0"
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary-bg"
          aria-hidden
        >
          {logoSrc ? (
            <CatalogLogo src={logoSrc} alt={entry.name} className="size-4.5" />
          ) : (
            <Icon name="mcp-server" className="size-4.5 text-text-primary" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h5 className="truncate text-sm font-medium text-text-primary">{entry.name}</h5>
          <p className="mt-0.5 line-clamp-2 text-sm text-text-secondary sm:truncate">
            {entry.description ?? entry.url}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-xs text-text-secondary sm:inline">
            {AUTH_TYPE_LABELS[entry.auth.type] ?? AUTH_TYPE_LABELS.none}
          </span>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={busy}
            onClick={() => {
              handleConnect(entry);
            }}
          >
            {entry.auth.type === 'dcr' ? 'Add' : 'Connect'}
          </Button>
        </div>
      </article>
    );
  };

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
        onConnectorRefreshed={handleConnectorRefreshed}
        onDisconnect={() => {
          handleDisconnect(selectedConnector);
        }}
      />
    );
  }

  const hasMatches = matchingConnected.length > 0 || availableConnectors.length > 0;

  return (
    <>
      <h3 className="text-xl font-semibold tracking-tight text-text-primary">Connectors</h3>
      <p className="mt-1 text-sm text-text-secondary">Connect tools your agents can use.</p>

      {error ? (
        <p className="mt-3 rounded-md border border-failure-bg/30 bg-failure-bg/10 px-3 py-2 text-sm text-failure-bg">
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
                setFormError(null);
                setAddMcpServerFormOpen(true);
              }}
            >
              <Icon name="plus" size="1rem" className="mr-1" />
              Add MCP Server
            </Button>
          </div>

          <div className="flex flex-1 flex-col gap-5 overflow-y-auto pb-1">
            {loading ? <p className="py-8 text-center text-sm text-text-secondary">Loading…</p> : null}

            {!loading && matchingConnected.length > 0 ? (
              <section aria-labelledby="connected-connectors-heading">
                <h4
                  id="connected-connectors-heading"
                  className="mb-2 text-[0.8125rem] font-semibold uppercase text-text-secondary"
                >
                  Configured · {matchingConnected.length}
                </h4>
                <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
                  {matchingConnected.map(connector => renderConnector(connector, true))}
                </div>
              </section>
            ) : null}

            {!loading && availableConnectors.length > 0 ? (
              <section aria-labelledby="available-connectors-heading">
                <h4
                  id="available-connectors-heading"
                  className="mb-2 text-[0.8125rem] font-semibold uppercase text-text-secondary"
                >
                  Available · {availableConnectors.length}
                </h4>
                <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
                  {availableConnectors.map(entry => renderCatalogEntry(entry))}
                </div>
              </section>
            ) : null}

            {!loading && !hasMatches ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm text-text-secondary">
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
                    className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary-bg"
                    aria-hidden
                  >
                    <Icon name="mcp-server" className="size-6 text-text-primary" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary">{connectorAwaitingKey?.name}</p>
                    <p className="truncate text-sm text-text-secondary">{connectorAwaitingKey?.description}</p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="connector-api-key"
                    className="mb-2 block text-xs font-semibold uppercase tracking-wide text-text-secondary"
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
                    className={auiInputClass('h-11')}
                  />
                </div>
                {formError ? <p className="text-failure-bg text-sm">{formError}</p> : null}
              </div>

              <footer className="flex justify-end gap-2 border-t border-border px-5 py-4">
                <Button variant="ghost" type="button" onClick={closeApiKeyModal} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!apiKey.trim() || busy}>
                  {isReplacingKey ? 'Replace Key' : 'Connect'}
                </Button>
              </footer>
            </form>
          </CenteredModal>

          <AddMcpServerForm
            open={addMcpServerFormOpen}
            onOpenChange={open => {
              setAddMcpServerFormOpen(open);
              if (!open) setFormError(null);
            }}
            onAdd={handleAddMcpServer}
            busy={busy}
            error={formError}
          />
        </div>
      </div>
    </>
  );
};

export default ConnectorSettings;
