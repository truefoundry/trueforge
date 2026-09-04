'use client';

import { useState } from 'react';

import { useMCPAuth } from '../../hooks/useMcpAuth.js';
import { Icon } from '../../icons/Icon.js';
import type { AgentSpec, ConnectorState, McpToolSelection } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { useInfiniteScrollSentinel } from '../lib/useInfiniteScrollSentinel.js';
import { CatalogLogo } from '../primitives/CatalogLogo.js';
import { Spinner } from '../primitives/Spinner.js';
import { Switch } from '../primitives/Switch.js';
import { Tooltip } from '../primitives/Tooltip.js';
import {
  editableMountsFromSpec,
  enabledToolsFromMount,
  preloadFromMount,
  withEnabledTools,
  withPreload,
} from './agentConfigMounts.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';
import { connectorsWithSelectedStubs } from './mcpConnectorStubs.js';

export type AgentMcpEditorContentProps = {
  spec: AgentSpec;
  connectors: ConnectorState[];
  query: string;
  activeConnectorId: string | null;
  tools: McpToolSelection[];
  toolsLoading: boolean;
  toolsError: string | null;
  onQueryChange: (query: string) => void;
  onSelectConnector: (connectorId: string) => void;
  onRetryTools: () => void;
  onRefreshConnectors?: () => Promise<void>;
  onChange: (spec: AgentSpec) => void;
};

function ToolCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border',
        checked
          ? 'border-primary-button-bg bg-primary-button-bg text-primary-button-text'
          : 'border-input-border bg-input-box-bg',
      )}
      aria-hidden
    >
      {checked ? <Icon name="check" className="size-3" /> : null}
    </span>
  );
}

function ConnectorIcon({ connector }: { connector: ConnectorState }) {
  const logo = Reflect.get(connector, 'logo');
  if (typeof logo === 'string' && logo.trim() !== '') {
    return <CatalogLogo src={logo} alt="" className="size-4 shrink-0 object-contain" aria-hidden />;
  }
  return <Icon name="mcp-server" className="text-text-secondary size-4 shrink-0" />;
}

function selectedToolsHeaderLabel(mcpMounts: ReturnType<typeof editableMountsFromSpec>): string {
  if (mcpMounts.length === 0) return 'Selected Tools (0)';
  const everyAll = mcpMounts.every(mount => enabledToolsFromMount(mount.value) === 'all');
  if (everyAll) return 'Selected Tools (All)';
  const count = mcpMounts.reduce((total, mount) => {
    const enabled = enabledToolsFromMount(mount.value);
    return enabled === 'all' ? total : total + enabled.length;
  }, 0);
  return `Selected Tools (${count})`;
}

function ConnectNowButton({ connectorId, onConnected }: { connectorId: string; onConnected: () => Promise<void> }) {
  const { handleAuthorize, isOAuthLoading } = useMCPAuth();
  return (
    <button
      type="button"
      className={auiButtonClass({ className: 'min-w-44' })}
      disabled={isOAuthLoading}
      onClick={() => {
        void handleAuthorize(connectorId, isSuccess => {
          if (isSuccess) void onConnected();
        });
      }}
    >
      {isOAuthLoading ? 'Connecting...' : 'Connect Now'}
    </button>
  );
}

export function AgentMcpEditorContent({
  spec,
  connectors,
  query,
  activeConnectorId,
  tools,
  toolsLoading,
  toolsError,
  onQueryChange,
  onSelectConnector,
  onRetryTools,
  onRefreshConnectors,
  onChange,
}: AgentMcpEditorContentProps) {
  const { connectorsHasMore, connectorsLoadingMore, loading, loadMoreConnectors } = useDraftCatalog();
  const [toolQuery, setToolQuery] = useState('');
  const [collapsedMountIds, setCollapsedMountIds] = useState<ReadonlySet<string>>(() => new Set());
  const mcpMounts = editableMountsFromSpec(spec.mcpServers);
  const catalogConnectors = connectorsWithSelectedStubs({ connectors, selected: mcpMounts });
  const selectedConnector = catalogConnectors.find(item => item.id === activeConnectorId);
  const activeMount = selectedConnector
    ? mcpMounts.find(item => item.id === selectedConnector.id || item.name === selectedConnector.name)
    : undefined;
  const needsAuth = selectedConnector?.authenticated === false;
  const canAddActiveConnector = selectedConnector !== undefined && selectedConnector.authenticated === true;
  const enabledTools = activeMount ? enabledToolsFromMount(activeMount.value) : [];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredConnectors = catalogConnectors.filter(item =>
    `${item.name} ${item.description ?? ''}`.toLowerCase().includes(normalizedQuery),
  );
  const normalizedToolQuery = toolQuery.trim().toLowerCase();
  const filteredTools =
    normalizedToolQuery === '' ? tools : tools.filter(tool => tool.name.toLowerCase().includes(normalizedToolQuery));

  const { listRef: connectorsListRef, sentinelRef: connectorsSentinelRef } = useInfiniteScrollSentinel({
    enabled: true,
    hasMore: connectorsHasMore,
    loading: connectorsLoadingMore || loading,
    onLoadMore: loadMoreConnectors,
  });
  const updateMount = (mountId: string, value: object) => {
    onChange({
      ...spec,
      mcpServers: mcpMounts.map(item => (item.id === mountId ? value : item.value)),
    });
  };

  const removeMount = (mountId: string) => {
    onChange({
      ...spec,
      mcpServers: mcpMounts.filter(item => item.id !== mountId).map(item => item.value),
    });
  };

  const openMountConnector = (mount: (typeof mcpMounts)[number]) => {
    const match = catalogConnectors.find(item => item.id === mount.id || item.name === mount.name);
    onSelectConnector(match?.id ?? mount.id);
  };

  const toggleTool = (toolName: string) => {
    if (!selectedConnector) return;
    if (!activeMount) {
      if (!canAddActiveConnector) return;
      onChange({
        ...spec,
        mcpServers: [
          ...(spec.mcpServers ?? []),
          withEnabledTools({ id: selectedConnector.id, name: selectedConnector.name }, [toolName]),
        ],
      });
      return;
    }
    const current = enabledTools === 'all' ? tools.map(tool => tool.name) : enabledTools;
    const checked = current.includes(toolName);
    const next = checked ? current.filter(name => name !== toolName) : [...current, toolName];
    if (next.length === 0) {
      removeMount(activeMount.id);
    } else {
      updateMount(activeMount.id, withEnabledTools(activeMount.value, next));
    }
  };

  const connectDuringChat = () => {
    if (!selectedConnector || activeMount !== undefined) return;
    onChange({
      ...spec,
      mcpServers: [
        ...(spec.mcpServers ?? []),
        withEnabledTools({ id: selectedConnector.id, name: selectedConnector.name }, 'all'),
      ],
    });
  };

  return (
    <div className="flex h-[min(36rem,calc(100dvh-10rem))] w-full min-w-0 flex-col overflow-hidden md:grid md:grid-cols-[14rem_minmax(0,1fr)_14rem]">
      <div className="flex max-h-44 min-h-0 min-w-0 flex-col border-b border-border md:max-h-none md:border-r md:border-b-0 bg-sidebar-bg">
        <label className="relative m-3 block shrink-0">
          <Icon name="search" className="text-text-secondary absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <input
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="Search MCP"
            className={auiInputClass('h-9 w-full pl-7')}
          />
        </label>
        <div ref={connectorsListRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {filteredConnectors.map(connector => {
            const mounted = mcpMounts.some(item => item.id === connector.id || item.name === connector.name);
            const active = connector.id === activeConnectorId;
            return (
              <button
                key={connector.id}
                type="button"
                aria-current={active ? 'true' : undefined}
                aria-label={connector.name}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left',
                  active ? 'bg-primary-button-bg/10' : 'hover:bg-ghost-button-hover',
                )}
                onClick={() => onSelectConnector(connector.id)}
              >
                <ConnectorIcon connector={connector} />
                <span className="text-text-primary min-w-0 flex-1 truncate text-sm font-medium">{connector.name}</span>
                {mounted ? (
                  <span
                    className="bg-success-bg text-success-text flex size-3 shrink-0 items-center justify-center rounded-full"
                    aria-label={`${connector.name} selected`}
                  >
                    <Icon name="check" className="size-2" />
                  </span>
                ) : null}
              </button>
            );
          })}
          {connectorsHasMore ? (
            <div ref={connectorsSentinelRef} className="flex h-8 items-center justify-center" aria-hidden>
              {connectorsLoadingMore ? <span className="text-text-secondary text-[10px]">Loading…</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-border md:border-r md:border-b-0">
        {selectedConnector ? (
          needsAuth ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              <Icon name="lock" className="text-text-secondary size-10" />
              <p className="text-text-primary text-sm font-semibold">You&apos;re not connected to this MCP Server</p>
              {onRefreshConnectors ? (
                <ConnectNowButton connectorId={selectedConnector.id} onConnected={onRefreshConnectors} />
              ) : null}
              <div className="text-text-secondary flex w-full max-w-xs items-center gap-3 text-xs">
                <span className="bg-border h-px flex-1" />
                OR
                <span className="bg-border h-px flex-1" />
              </div>
              <button
                type="button"
                className={auiButtonClass({ variant: 'outline', className: 'min-w-44' })}
                disabled={activeMount !== undefined}
                onClick={connectDuringChat}
              >
                Connect During Chat
              </button>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-3">
                <p className="min-w-0 truncate text-sm font-semibold">
                  {selectedConnector.name} Tools ({tools.length})
                </p>
                <label className="text-text-secondary flex shrink-0 cursor-pointer items-center gap-2 text-xs has-[:disabled]:cursor-not-allowed">
                  Enable All Tools
                  <Switch
                    checked={activeMount !== undefined && enabledTools === 'all'}
                    disabled={!canAddActiveConnector && activeMount === undefined}
                    onCheckedChange={enabled => {
                      if (activeMount) {
                        if (enabled) {
                          updateMount(activeMount.id, withEnabledTools(activeMount.value, 'all'));
                        } else {
                          removeMount(activeMount.id);
                        }
                      } else if (enabled && canAddActiveConnector) {
                        onChange({
                          ...spec,
                          mcpServers: [
                            ...(spec.mcpServers ?? []),
                            withEnabledTools({ id: selectedConnector.id, name: selectedConnector.name }, 'all'),
                          ],
                        });
                      }
                    }}
                    aria-label="Enable all tools"
                  />
                </label>
              </div>
              <label className="relative m-3 block shrink-0">
                <Icon name="search" className="text-text-secondary absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
                <input
                  value={toolQuery}
                  onChange={event => setToolQuery(event.target.value)}
                  placeholder="Search Tools"
                  className={auiInputClass('h-9 w-full pl-7')}
                />
              </label>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {toolsLoading ? (
                  <div className="flex h-full min-h-24 items-center justify-center p-3" aria-label="Loading tools">
                    <Spinner size={20} className="text-text-secondary" />
                  </div>
                ) : null}
                {toolsError ? (
                  <div className="p-3">
                    <p className="text-failure-bg text-sm">{toolsError}</p>
                    <button
                      type="button"
                      className={auiButtonClass({ variant: 'secondary', size: 'sm', className: 'mt-2' })}
                      onClick={onRetryTools}
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
                {!toolsLoading
                  ? filteredTools.map(tool => {
                      const checked = enabledTools === 'all' || enabledTools.includes(tool.name);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={checked}
                          aria-label={tool.name}
                          disabled={!canAddActiveConnector && activeMount === undefined}
                          className="hover:bg-ghost-button-hover flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                          onClick={() => toggleTool(tool.name)}
                        >
                          <ToolCheckbox checked={checked} />
                          <span className="min-w-0 flex-1">
                            <span className="text-text-primary block truncate text-sm font-medium">{tool.name}</span>
                            {tool.description ? (
                              <span className="text-text-secondary line-clamp-1 text-xs">{tool.description}</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })
                  : null}
              </div>
              <label className="text-text-secondary flex shrink-0 cursor-pointer items-center justify-end gap-2 border-t border-border p-3 text-xs has-[:disabled]:cursor-not-allowed">
                Preload tools
                <Switch
                  checked={activeMount !== undefined && preloadFromMount(activeMount.value)}
                  disabled={activeMount === undefined}
                  onCheckedChange={preload => {
                    if (activeMount) updateMount(activeMount.id, withPreload(activeMount.value, preload));
                  }}
                  aria-label="Preload tools"
                />
              </label>
            </>
          )
        ) : (
          <p className="text-text-secondary p-4 text-sm">Select an MCP server to configure its tools.</p>
        )}
      </div>

      <div className="flex max-h-44 min-h-0 min-w-0 flex-col md:max-h-none">
        <div className="shrink-0 border-b border-border p-3 text-sm font-semibold">
          {selectedToolsHeaderLabel(mcpMounts)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {mcpMounts.length ? (
            <div className="space-y-1">
              {mcpMounts.map(mount => {
                const selected = enabledToolsFromMount(mount.value);
                return (
                  <details
                    key={mount.id}
                    className="group/mount"
                    open={!collapsedMountIds.has(mount.id)}
                    onToggle={event => {
                      const nextOpen = event.currentTarget.open;
                      setCollapsedMountIds(prev => {
                        const next = new Set(prev);
                        if (nextOpen) next.delete(mount.id);
                        else next.add(mount.id);
                        return next;
                      });
                    }}
                  >
                    <summary
                      className="hover:bg-ghost-button-hover flex cursor-pointer list-none items-center gap-1 rounded-md [&::-webkit-details-marker]:hidden"
                      onClick={() => openMountConnector(mount)}
                    >
                      <Icon
                        name="chevron-down"
                        className="text-text-secondary size-3.5 shrink-0 -rotate-90 transition-transform group-open/mount:rotate-0"
                      />
                      <span className="text-text-primary min-w-0 flex-1 truncate text-xs font-semibold">
                        {mount.name}
                      </span>
                      <span className="relative flex size-6 shrink-0 items-center justify-center">
                        <span className="text-text-secondary text-xs font-medium group-hover/mount:invisible group-focus-within/mount:invisible">
                          {selected === 'all' ? 'All' : selected.length}
                        </span>
                        <Tooltip
                          content="Remove All Tools"
                          triggerClassName="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover/mount:pointer-events-auto group-hover/mount:opacity-100 group-focus-within/mount:pointer-events-auto group-focus-within/mount:opacity-100"
                        >
                          <button
                            type="button"
                            aria-label={`Remove all tools for ${mount.name}`}
                            className={auiButtonClass({
                              variant: 'ghost',
                              size: 'icon',
                              className: 'text-text-secondary size-6',
                            })}
                            onClick={event => {
                              event.preventDefault();
                              event.stopPropagation();
                              removeMount(mount.id);
                            }}
                          >
                            <Icon name="xmark" className="size-3.5" />
                          </button>
                        </Tooltip>
                      </span>
                    </summary>
                    {selected === 'all' ? (
                      <button
                        type="button"
                        className="text-text-secondary hover:bg-ghost-button-hover flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 pl-7 text-left text-[11px] font-medium tracking-wide uppercase"
                        onClick={() => openMountConnector(mount)}
                      >
                        <Icon name="wrench" className="size-3 shrink-0" />
                        ALL TOOLS ENABLED
                      </button>
                    ) : selected.length ? (
                      selected.map(toolName => (
                        <button
                          key={`${mount.id}:${toolName}`}
                          type="button"
                          aria-label={`Open ${mount.name} for ${toolName}`}
                          className="text-text-primary hover:bg-ghost-button-hover flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 pl-7 text-left text-[11px]"
                          onClick={() => openMountConnector(mount)}
                        >
                          <Icon name="wrench" className="text-text-secondary size-3 shrink-0" />
                          <span className="min-w-0 truncate">{toolName}</span>
                        </button>
                      ))
                    ) : (
                      <p className="text-text-secondary px-2 py-1.5 pl-7 text-[11px]">No tools selected.</p>
                    )}
                  </details>
                );
              })}
            </div>
          ) : (
            <p className="text-text-secondary p-4 text-center text-sm">No tools selected.</p>
          )}
        </div>
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentMcpEditorContent: typeof AgentMcpEditorContent;
  }
}
