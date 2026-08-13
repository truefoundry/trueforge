'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '../../atoms/lib/cn.js';
import { Button } from '../../atoms/primitives/Button.js';
import { useMCPAuth } from '../../hooks/useMcpAuth.js';
import { Icon } from '../../icons/Icon.js';
import { useCatalogServer } from '../../server/ServerContext.js';
import type { ConnectorBase, ToolBase } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { AUTH_TYPE_LABELS } from './authTypeLabels.js';

type ConnectorDetailsProps = {
  connector: ConnectorBase;
  onBack: () => void;
  onConnectorRefreshed: (connector: ConnectorBase) => void;
  onDisconnect: () => void;
  busy?: boolean;
};

/** One-line clamp with animated expand; toggle only when content actually overflows. */
function ExpandableDescription({ text }: { text: string }) {
  const contentRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [maxHeight, setMaxHeight] = useState(16);

  useLayoutEffect(() => {
    setExpanded(false);
    setMaxHeight(16);
  }, [text]);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (!expanded) {
      setMaxHeight(16);
      setCanExpand(el.scrollWidth > el.clientWidth + 1);
      return;
    }

    // Keep collapsed height for one frame (wrap enabled), then grow so max-height can transition.
    setMaxHeight(16);
    const frame = requestAnimationFrame(() => {
      setMaxHeight(el.scrollHeight);
    });
    return () => cancelAnimationFrame(frame);
  }, [text, expanded]);

  if (!text) return null;

  return (
    <div className="relative min-w-0">
      <p
        ref={contentRef}
        style={{ maxHeight }}
        className={cn(
          'mt-0.5 overflow-hidden font-mono text-xs leading-4 text-text-secondary transition-[max-height] duration-300 ease-in-out',
          !expanded && 'whitespace-nowrap',
          !expanded && canExpand && 'pr-[5.75rem]',
        )}
      >
        {text}
        {expanded && canExpand ? (
          <>
            {' '}
            <button
              type="button"
              className="cursor-pointer font-mono text-xs font-medium text-text-primary/80 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
              aria-expanded
              onClick={() => setExpanded(false)}
            >
              Show less
            </button>
          </>
        ) : null}
      </p>
      {!expanded && canExpand ? (
        <button
          type="button"
          className="absolute top-0.5 right-0 cursor-pointer bg-card-bg pl-1.5 font-mono text-xs font-medium leading-4 text-text-primary/80 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          <span aria-hidden className="text-text-secondary">
            …
          </span>
          <span className="ml-1">Read more</span>
        </button>
      ) : null}
    </div>
  );
}

const ConnectorDetails = ({
  connector,
  onBack,
  onConnectorRefreshed,
  onDisconnect,
  busy = false,
}: ConnectorDetailsProps) => {
  const { connectorCatalog } = useCatalogServer();
  const { handleAuthorize, isOAuthLoading } = useMCPAuth();
  const [tools, setTools] = useState<ToolBase[]>([]);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [refreshingAfterAuth, setRefreshingAfterAuth] = useState(false);

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
          setToolsError(getErrorMessage(err, 'Failed to load connector tools'));
        }
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connector.authenticated, connector.id, connectorCatalog]);

  const refreshAfterAuthentication = async () => {
    setRefreshingAfterAuth(true);
    setToolsError(null);

    try {
      const refreshedConnector = await connectorCatalog.getConnector({ id: connector.id });
      onConnectorRefreshed(refreshedConnector);
    } catch (err: unknown) {
      setToolsError(getErrorMessage(err, 'Failed to refresh connector details'));
    } finally {
      setRefreshingAfterAuth(false);
    }
  };

  const connecting = isOAuthLoading || refreshingAfterAuth;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex w-fit items-center gap-1 rounded-md py-1 pr-2 text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
      >
        <Icon name="chevron-left" className="size-3.5" />
        Connectors
      </button>

      <div className="flex flex-1 flex-col overflow-y-auto pb-1">
        <header className="flex items-start gap-3">
          <span
            className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary-bg"
            aria-hidden
          >
            <Icon name="mcp-server" className="size-5 text-text-primary" />
          </span>

          <div className="min-w-0 flex-1">
            <h4 className="text-lg font-semibold text-text-primary">{connector.name}</h4>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span
                className={cn(
                  'flex items-center gap-1.5 text-xs font-medium',
                  connector.authenticated ? 'text-success-bg' : 'text-text-primary',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    connector.authenticated ? 'bg-success-bg' : 'bg-primary-button-bg',
                  )}
                ></span>
                {connector.authenticated ? 'Connected' : 'Not authenticated'}
              </span>
              <span className="text-text-secondary">· {connector.description}</span>
            </div>
            <span className="mt-2 inline-flex items-center rounded-full border border-border bg-secondary-bg/40 px-2 py-0.5 text-xs font-medium text-text-secondary">
              {AUTH_TYPE_LABELS[connector.auth.type] ?? AUTH_TYPE_LABELS.none}
            </span>
          </div>

          {connector.auth.type === 'dcr' && !connector.authenticated ? (
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={busy || connecting}
              onClick={() => {
                void handleAuthorize(connector.id, isSuccess => {
                  if (isSuccess) void refreshAfterAuthentication();
                });
              }}
            >
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          ) : connector.auth.type === 'dcr' && !connector.requiresAuth ? (
            <Button variant="outline" size="sm" type="button" disabled={busy} onClick={onDisconnect}>
              Disconnect
            </Button>
          ) : null}
        </header>

        <section className="mt-6" aria-labelledby="connector-tools-heading">
          {toolsLoading ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-text-secondary">
              Loading tools…
            </div>
          ) : toolsError ? (
            <div className="rounded-xl border border-failure-bg/30 bg-failure-bg/10 p-6 text-center text-sm text-failure-bg">
              {toolsError}
              {connector.auth.type === 'dcr' && !connector.authenticated && (
                <div className="font-bold mt-1">Click Connect and authenticate successfully to view tools.</div>
              )}
            </div>
          ) : tools.length > 0 ? (
            <>
              <h5 id="connector-tools-heading" className="mb-2 text-[0.8125rem] font-semibold text-text-primary">
                Tools <span className="font-normal text-text-secondary">· {tools.length}</span>
              </h5>
              <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
                {tools.map(tool => (
                  <article
                    key={tool.id}
                    className="flex min-h-12 items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <h6 className="text-sm font-medium text-text-primary">{tool.name}</h6>
                      <ExpandableDescription text={tool.description} />
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-text-secondary">
              No tools reported for this connector.
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ConnectorDetails;
