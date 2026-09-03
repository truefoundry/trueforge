'use client';

import { useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import type { AgentSpec, ConnectorState, McpToolSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { Switch } from '../primitives/Switch.js';
import { isUnauthenticatedDcrConnector } from './DraftCompositeSelector.js';
import { editableMountsFromSpec, enabledToolsFromMount, withEnabledTools, withPreload } from './agentConfigMounts.js';

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
  const CatalogRow = useSlot('CatalogRow');
  const ConnectorConnectButton = useSlot('ConnectorConnectButton');
  const [toolQuery, setToolQuery] = useState('');
  const mcpMounts = editableMountsFromSpec(spec.mcpServers);
  const selectedConnector = connectors.find(item => item.id === activeConnectorId);
  const activeMount = selectedConnector
    ? mcpMounts.find(item => item.id === selectedConnector.id || item.name === selectedConnector.name)
    : undefined;
  const canAddActiveConnector =
    selectedConnector !== undefined &&
    (selectedConnector.authenticated === true || isUnauthenticatedDcrConnector(selectedConnector));
  const enabledTools = activeMount ? enabledToolsFromMount(activeMount.value) : [];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredConnectors = connectors
    .filter(item => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      const leftSelected = mcpMounts.some(item => item.id === left.id || item.name === left.name);
      const rightSelected = mcpMounts.some(item => item.id === right.id || item.name === right.name);
      return Number(rightSelected) - Number(leftSelected);
    });
  const filteredTools = tools.filter(tool =>
    `${tool.name} ${tool.description ?? ''}`.toLowerCase().includes(toolQuery.trim().toLowerCase()),
  );
  const activeToolsByName = new Map(tools.map(tool => [tool.name, tool]));

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

  const toggleSelectedTool = (mountId: string, toolName: string) => {
    const mount = mcpMounts.find(item => item.id === mountId);
    if (!mount) return;
    const enabled = enabledToolsFromMount(mount.value);
    if (enabled === 'all') return;
    const next = enabled.filter(name => name !== toolName);
    if (next.length === 0) {
      removeMount(mount.id);
    } else {
      updateMount(mount.id, withEnabledTools(mount.value, next));
    }
  };

  return (
    <div className="grid h-[min(36rem,calc(100dvh-8rem))] w-full min-w-0 grid-cols-1 overflow-hidden md:grid-cols-[14rem_minmax(0,1fr)_14rem]">
      <div className="flex min-h-0 min-w-0 flex-col border-r border-border">
        <label className="relative m-3 block shrink-0">
          <Icon name="search" className="text-text-secondary absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <input
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="Search MCP"
            className={auiInputClass('h-9 w-full pl-7')}
          />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filteredConnectors.map(connector => {
            const mount = mcpMounts.find(item => item.id === connector.id || item.name === connector.name);
            const needsConnect = isUnauthenticatedDcrConnector(connector);
            return (
              <CatalogRow
                key={connector.id}
                title={connector.name}
                description={connector.description}
                checked={mount !== undefined}
                disabled={!connector.authenticated && !needsConnect && mount === undefined}
                onActivate={() => onSelectConnector(connector.id)}
                onToggle={() => {
                  if (mount === undefined) {
                    onChange({
                      ...spec,
                      mcpServers: [...(spec.mcpServers ?? []), { id: connector.id, name: connector.name }],
                    });
                    onSelectConnector(connector.id);
                  } else {
                    onChange({
                      ...spec,
                      mcpServers: mcpMounts.filter(item => item !== mount).map(item => item.value),
                    });
                  }
                }}
                action={
                  needsConnect && onRefreshConnectors ? (
                    <ConnectorConnectButton connector={connector} onConnected={onRefreshConnectors} />
                  ) : undefined
                }
              />
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col border-r border-border">
        {selectedConnector ? (
          <>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-3">
              <p className="min-w-0 truncate text-sm font-semibold">
                {selectedConnector.name} Tools ({tools.length})
              </p>
              <label className="text-text-secondary flex shrink-0 items-center gap-2 text-xs">
                Enable all tools
                <Switch
                  checked={activeMount !== undefined && enabledTools === 'all'}
                  disabled={activeMount === undefined && !canAddActiveConnector}
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
                placeholder="Search tools"
                className={auiInputClass('h-9 w-full pl-7')}
              />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {toolsLoading ? <p className="text-text-secondary p-3 text-sm">Loading tools…</p> : null}
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
              {filteredTools.map(tool => (
                <CatalogRow
                  key={tool.id}
                  title={tool.name}
                  description={tool.description}
                  checked={enabledTools === 'all' || enabledTools.includes(tool.name)}
                  disabled={activeMount === undefined && !canAddActiveConnector}
                  onToggle={() => toggleTool(tool.name)}
                />
              ))}
            </div>
            <label className="text-text-secondary flex shrink-0 items-center justify-end gap-2 border-t border-border p-3 text-xs">
              Preload tools
              <Switch
                checked={activeMount !== undefined && Reflect.get(activeMount.value, 'preload') === true}
                disabled={activeMount === undefined}
                onCheckedChange={preload => {
                  if (activeMount) updateMount(activeMount.id, withPreload(activeMount.value, preload));
                }}
                aria-label="Preload tools"
              />
            </label>
          </>
        ) : (
          <p className="text-text-secondary p-4 text-sm">Select an MCP server to configure its tools.</p>
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="shrink-0 border-b border-border p-3 text-sm font-semibold">Selected Tools</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {mcpMounts.length ? (
            <div className="space-y-3">
              {mcpMounts.map(mount => {
                const selected = enabledToolsFromMount(mount.value);
                return (
                  <section key={mount.id}>
                    <h3 className="text-text-primary px-2 py-1 text-xs font-semibold">{mount.name}</h3>
                    {selected === 'all' ? (
                      <p className="text-text-secondary px-2 py-2 text-xs">All tools enabled</p>
                    ) : selected.length ? (
                      selected.map(toolName => {
                        const description =
                          mount.id === activeMount?.id ? activeToolsByName.get(toolName)?.description : undefined;
                        return (
                          <div
                            key={`${mount.id}:${toolName}`}
                            className="hover:bg-ghost-button-hover flex w-full items-center gap-2 rounded-md px-2 py-2"
                          >
                            <span className="bg-secondary-bg text-text-secondary mt-0.5 flex size-7 shrink-0 items-center justify-center rounded text-xs font-semibold">
                              {toolName.charAt(0).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="text-text-primary block truncate text-sm font-medium">{toolName}</span>
                              {description ? (
                                <span className="text-text-secondary line-clamp-1 text-xs">{description}</span>
                              ) : null}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${toolName} from ${mount.name}`}
                              className={auiButtonClass({
                                variant: 'ghost',
                                size: 'icon',
                                className: 'size-6 shrink-0',
                              })}
                              onClick={() => toggleSelectedTool(mount.id, toolName)}
                            >
                              <Icon name="xmark" className="size-3.5" />
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-text-secondary px-2 py-2 text-xs">No tools selected.</p>
                    )}
                  </section>
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
