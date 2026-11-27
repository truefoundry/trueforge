'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { Button } from '../../atoms/primitives/Button.js';
import SearchInput from '../../atoms/primitives/SearchInput.js';
import { useMCPAuth } from '../../hooks/useMcpAuth.js';
import { Icon } from '../../icons/Icon.js';
import { CATALOG_STALE_TIME_MS, useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useCatalogServer } from '../../server/ServerContext.js';
import type { ConnectorBase, ConnectorCatalogEntry } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { ConnectorApiKeyDialog } from '../SettingsBuilder/ConnectorApiKeyDialog.js';
import { createConnectorFromCatalog, headerAuthForCatalogEntry } from '../SettingsBuilder/connectorCatalogActions.js';

type ConnectMcpStepProps = {
  onBack: () => void;
  /** Leaves onboarding without connecting anything. */
  onSkip: () => void;
  onDone: () => void;
};

type ConnectorCreateInput = { entry: ConnectorCatalogEntry; apiKey?: string };

function matchesQuery({ entry, query }: { entry: ConnectorCatalogEntry; query: string }): boolean {
  return (
    entry.name.toLowerCase().includes(query) ||
    (entry.description?.toLowerCase().includes(query) ?? false) ||
    entry.url.toLowerCase().includes(query)
  );
}

/** Optional second step: connect MCP servers from the discovery catalog. */
export function ConnectMcpStep({ onBack, onSkip, onDone }: ConnectMcpStepProps) {
  const { connectorCatalog } = useCatalogServer();
  const queryClient = useServerQueryClient();
  const track = useTrackAnalytics();
  const { handleAuthorize } = useMCPAuth();
  const ConnectorRow = useSlot('OnboardingConnectorRow');
  const StepFooter = useSlot('OnboardingStepFooter');

  const catalogQuery = useQuery(
    {
      queryKey: queryKeys.catalog.connectorCatalog(),
      queryFn: () => connectorCatalog.getConnectorCatalog(),
      staleTime: CATALOG_STALE_TIME_MS,
    },
    queryClient,
  );
  const connectorsQuery = useQuery(
    {
      queryKey: queryKeys.settings.connectors(),
      queryFn: () => connectorCatalog.listConnectors(),
    },
    queryClient,
  );
  const configured = useMemo(
    () => new Map((connectorsQuery.data ?? []).map((connector): [string, ConnectorBase] => [connector.id, connector])),
    [connectorsQuery.data],
  );
  const failure = catalogQuery.error ?? connectorsQuery.error;
  const loadError = failure ? getErrorMessage(failure, 'Failed to load connectors') : null;

  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [entryAwaitingKey, setEntryAwaitingKey] = useState<ConnectorCatalogEntry | null>(null);

  const createMutation = useMutation(
    {
      mutationFn: ({ entry, apiKey }: ConnectorCreateInput) =>
        createConnectorFromCatalog({
          connectorCatalog,
          entry,
          ...(apiKey === undefined ? {} : { auth: headerAuthForCatalogEntry({ entry, apiKey }) }),
        }),
    },
    queryClient,
  );

  const refreshConfigured = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.settings.connectors() }),
    [queryClient],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      (catalogQuery.data ?? []).filter(
        entry => normalizedQuery === '' || matchesQuery({ entry, query: normalizedQuery }),
      ),
    [catalogQuery.data, normalizedQuery],
  );

  const authorize = useCallback(
    async (connectorId: string) => {
      setWorkingId(connectorId);
      try {
        // handleAuthorize resolves once the popup is open. A popup the user abandons never reports back
        // (its opener link can be severed by the provider), so only the setup request blocks the buttons.
        await handleAuthorize(connectorId, () => void refreshConfigured());
      } finally {
        setWorkingId(null);
      }
    },
    [handleAuthorize, refreshConfigured],
  );

  const create = async ({ entry, apiKey }: ConnectorCreateInput) => {
    setWorkingId(entry.id);
    setError(null);
    setFormError(null);
    try {
      const connector = await createMutation.mutateAsync({ entry, apiKey });
      track(AnalyticsEvents.Settings.CONNECTOR_SAVED, { connector_name: entry.name, mode: 'create' });
      setEntryAwaitingKey(null);
      await refreshConfigured();
      // An OAuth server is only usable after the user grants access, so continue straight into it.
      if (entry.auth.type === 'dcr') await authorize(connector.id);
    } catch (err) {
      const message = getErrorMessage(err, 'Request failed');
      if (apiKey === undefined) setError(message);
      else setFormError(message);
    }
    setWorkingId(null);
  };

  const handleConnect = (entry: ConnectorCatalogEntry) => {
    const existing = configured.get(entry.id);
    if (existing !== undefined) {
      void authorize(existing.id);
      return;
    }
    if (entry.auth.type === 'header') {
      setFormError(null);
      setEntryAwaitingKey(entry);
      return;
    }
    void create({ entry });
  };

  const renderAction = (entry: ConnectorCatalogEntry) => {
    const existing = configured.get(entry.id);
    if (existing?.authenticated === true) {
      return (
        <span className="text-success-bg flex items-center gap-1 text-xs font-medium">
          <Icon name="check" className="size-3.5" />
          Connected
        </span>
      );
    }
    if (existing !== undefined && existing.auth.type !== 'dcr') {
      return <span className="text-text-secondary text-xs font-medium">Added</span>;
    }
    return (
      <Button.Secondary
        size="small"
        type="button"
        disabled={workingId !== null}
        aria-label={`Connect ${entry.name}`}
        onClick={() => handleConnect(entry)}
      >
        {workingId === entry.id ? 'Connecting…' : 'Connect'}
      </Button.Secondary>
    );
  };

  const message = error ?? loadError;
  const catalogLoaded = catalogQuery.data !== undefined;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="text-text-primary text-xl leading-[1.875rem] font-medium">Give your agents tools</h2>
        <p className="text-text-secondary text-sm leading-[1.40625rem]">
          Connect an MCP server so agents can work in your apps. You can skip and add these later.
        </p>
      </header>

      <SearchInput query={query} setQuery={setQuery} placeholder="Search connectors" />

      <div
        className="border-border bg-card-bg flex h-48 flex-col overflow-y-auto rounded-xl border p-1"
        aria-label="Connectors"
      >
        {!catalogLoaded ? (
          <p className="text-text-secondary p-6 text-center text-sm">{loadError ?? 'Loading…'}</p>
        ) : visible.length === 0 ? (
          <p className="text-text-secondary p-6 text-center text-sm">
            {normalizedQuery ? `No connectors match “${query.trim()}”.` : 'No connectors available.'}
          </p>
        ) : (
          visible.map(entry => (
            <ConnectorRow
              key={entry.id}
              name={entry.name}
              action={renderAction(entry)}
              {...(entry.description ? { description: entry.description } : {})}
              {...(entry.logo ? { logoSrc: entry.logo } : {})}
            />
          ))
        )}
      </div>

      {message && catalogLoaded ? (
        <p role="alert" className="text-failure-bg text-sm">
          {message}
        </p>
      ) : null}

      <StepFooter
        start={
          <Button.Secondary type="button" onClick={onBack}>
            <Icon name="arrow-left" />
            Back
          </Button.Secondary>
        }
        end={
          <>
            <Button.Secondary type="button" onClick={onSkip}>
              Skip
            </Button.Secondary>
            <Button.Primary type="button" onClick={onDone}>
              Done
              <Icon name="check" />
            </Button.Primary>
          </>
        }
      />

      <ConnectorApiKeyDialog
        entry={entryAwaitingKey}
        busy={workingId !== null}
        error={formError}
        onSubmit={apiKey => {
          if (entryAwaitingKey !== null) void create({ entry: entryAwaitingKey, apiKey });
        }}
        onCancel={() => {
          setEntryAwaitingKey(null);
          setFormError(null);
        }}
      />
    </div>
  );
}
