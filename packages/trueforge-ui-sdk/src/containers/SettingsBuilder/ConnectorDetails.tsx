'use client';

import { useEffect, useState } from 'react';

import { Button } from '../../atoms/primitives/Button.js';
import { Icon } from '../../icons/Icon.js';
import { useCatalogServer } from '../../server/ServerContext.js';
import type { ConnectorBase, ToolBase } from '../../server/types.js';
import { AUTH_TYPE_LABELS } from './authTypeLabels.js';

type ConnectorDetailsProps = {
  connector: ConnectorBase;
  onBack: () => void;
  onDisconnect: () => void;
  busy?: boolean;
};

const ConnectorDetails = ({ connector, onBack, onDisconnect, busy = false }: ConnectorDetailsProps) => {
  const { connectorCatalog } = useCatalogServer();
  const [tools, setTools] = useState<ToolBase[]>([]);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsError, setToolsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTools([]);
    setToolsError(null);
    setToolsLoading(true);

    void connectorCatalog
      .getToolsByConnectorId({ id: connector.id })
      .then(result => {
        if (!cancelled) setTools(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setToolsError(err instanceof Error ? err.message : 'Failed to load connector tools');
        }
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connector.id, connectorCatalog]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex w-fit items-center gap-1 rounded-md py-1 pr-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Icon name="chevron-left" className="size-3.5" />
        Connectors
      </button>

      <div className="flex flex-1 flex-col overflow-y-auto pb-1">
        <header className="flex items-start gap-3">
          <span
            className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted"
            aria-hidden
          >
            <Icon name="mcp-server" className="size-5 text-foreground" />
          </span>

          <div className="min-w-0 flex-1">
            <h4 className="text-lg font-semibold text-foreground">{connector.name}</h4>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary"></span>
                {connector.authenticated ? 'Connected' : 'Not authenticated'}
              </span>
              <span className="text-muted-foreground">· {connector.description}</span>
            </div>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{connector.url}</p>
            <span className="mt-2 inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {AUTH_TYPE_LABELS[connector.auth.type] ?? AUTH_TYPE_LABELS.none}
            </span>
          </div>

          {connector.auth.type === 'dcr' && !connector.requiresAuth ? (
            <Button variant="outline" size="sm" type="button" disabled={busy} onClick={onDisconnect}>
              Disconnect
            </Button>
          ) : null}
        </header>

        <section className="mt-6" aria-labelledby="connector-tools-heading">
          {toolsLoading ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Loading tools…
            </div>
          ) : toolsError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center text-sm text-destructive">
              {toolsError}
            </div>
          ) : tools.length > 0 ? (
            <>
              <h5 id="connector-tools-heading" className="mb-2 text-[0.8125rem] font-semibold text-foreground">
                Tools <span className="font-normal text-muted-foreground">· {tools.length}</span>
              </h5>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {tools.map(tool => (
                  <article
                    key={tool.id}
                    className="flex min-h-12 items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <h6 className="text-sm font-medium text-foreground">{tool.name}</h6>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">{tool.id}</p>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No tools reported for this connector.
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ConnectorDetails;
