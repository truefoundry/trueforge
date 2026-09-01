'use client';

import { useEffect, type ReactNode } from 'react';

import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { Icon } from '../../icons/Icon.js';
import { useOptionalCatalogServer } from '../../server/ServerContext.js';
import type { ConnectorState, Schedule } from '../../server/types.js';
import { useDraftCatalog } from '../draft/DraftCatalogProvider.js';
import { ConnectorConnectButton } from '../draft/DraftCompositeSelector.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { formatCadenceSummary } from './cadence.js';
import { ScheduleStatusBadge } from './ScheduleStatusBadge.js';

export type ScheduleMcpMount = {
  name: string;
};

export type TestScheduleScreenProps = {
  schedule: Schedule;
  agentName: string;
  mcpMounts: readonly ScheduleMcpMount[];
  onEditConfiguration: () => void;
};

function mountConnector(connectors: ConnectorState[], name: string): ConnectorState | null {
  return connectors.find(connector => connector.name === name || connector.id === name) ?? null;
}

function ScheduleMcpConnect({
  connector,
  onConnected,
}: {
  connector: ConnectorState;
  onConnected: () => Promise<void>;
}) {
  const catalog = useOptionalCatalogServer();
  if (catalog == null) return null;
  return <ConnectorConnectButton connector={connector} onConnected={onConnected} />;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
      <span className="text-text-secondary shrink-0 text-[10px] font-semibold tracking-wide uppercase">{label}</span>
      <div className="min-w-0 text-right text-sm text-text-primary">{children}</div>
    </div>
  );
}

export function TestScheduleScreen({ schedule, agentName, mcpMounts, onEditConfiguration }: TestScheduleScreenProps) {
  const toaster = useToasterOptional();
  const { connectors, ensureLoaded, refreshConnectors, loading, error } = useDraftCatalog();
  const cadence = formatCadenceSummary({ cron: schedule.cron, timezone: schedule.timezone });

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  useEffect(() => {
    if (error != null) toaster?.showError(error);
  }, [error, toaster]);

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <section className="overflow-hidden rounded-lg border border-border bg-card-bg">
        <DetailRow label="Agent">{agentName}</DetailRow>
        <DetailRow label="Name">{schedule.name}</DetailRow>
        <DetailRow label="Task">
          <span className="whitespace-pre-wrap break-words">{schedule.task}</span>
        </DetailRow>
        <DetailRow label="Cadence">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <span>{cadence}</span>
            <code className="text-text-secondary font-mono text-xs">{schedule.cron}</code>
          </div>
        </DetailRow>
        <DetailRow label="Status">
          <ScheduleStatusBadge status={schedule.status} />
        </DetailRow>
        <div className="flex justify-end px-3 py-2.5">
          <Button type="button" variant="outline" size="sm" onClick={onEditConfiguration}>
            <Icon name="pencil" className="size-3.5" />
            Edit Configuration
          </Button>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card-bg">
        <div className="border-b border-border px-3 py-2">
          <h3 className="text-text-secondary text-[10px] font-semibold tracking-wide uppercase">Tool Authorization</h3>
        </div>
        {mcpMounts.length === 0 ? (
          <p className="text-text-secondary px-3 py-3 text-sm">No MCP connectors configured for this agent.</p>
        ) : (
          <ul className="divide-y divide-border">
            {mcpMounts.map(mount => {
              const connector = mountConnector(connectors, mount.name);
              const authenticated = connector?.authenticated === true;
              const unavailable = connector == null && !loading;
              return (
                <li key={mount.name} className="flex items-center gap-2 px-3 py-2.5">
                  <span
                    className={cn(
                      'inline-flex size-4 shrink-0 items-center justify-center rounded-full border',
                      authenticated
                        ? 'border-emerald-600/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'border-border text-transparent',
                    )}
                    aria-hidden
                  >
                    {authenticated ? <Icon name="check" className="size-3" /> : null}
                  </span>
                  <span className="text-text-primary min-w-0 flex-1 truncate text-sm">{mount.name}</span>
                  {authenticated ? (
                    <span className="text-success-bg text-xs font-medium">Connected</span>
                  ) : unavailable ? (
                    <span className="text-text-secondary text-xs">Unavailable</span>
                  ) : connector != null && connector.authenticated === false ? (
                    <ScheduleMcpConnect connector={connector} onConnected={refreshConnectors} />
                  ) : loading ? (
                    <span className="text-text-secondary text-xs">Loading…</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card-bg">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h3 className="text-text-secondary text-[10px] font-semibold tracking-wide uppercase">Test Run</h3>
          <button
            type="button"
            disabled
            title="Test runs are not available yet"
            className={auiButtonClass({ variant: 'default', size: 'sm', className: 'opacity-60' })}
          >
            <Icon name="play" className="size-3.5" />
            Run Test
          </button>
        </div>
        <p className="text-text-secondary px-3 py-3 text-sm">
          Schedule test runs are not wired yet. You can still connect tools and activate the schedule.
        </p>
      </section>
    </div>
  );
}
