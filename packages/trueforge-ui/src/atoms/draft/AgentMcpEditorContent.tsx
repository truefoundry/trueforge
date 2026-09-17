'use client';

import { useEffect, useRef, useState } from 'react';

import { useMCPAuth } from '../../hooks/useMcpAuth.js';
import { Icon } from '../../icons/Icon.js';
import type { AgentSpec, ConnectorState, McpToolSelection } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { Button } from '../primitives/Button.js';
import { CatalogLogo } from '../primitives/CatalogLogo.js';
import { Checkbox } from '../primitives/Checkbox.js';
import { Spinner } from '../primitives/Spinner.js';
import { Switch } from '../primitives/Switch.js';
import { Tooltip } from '../primitives/Tooltip.js';
import {
  approvalSelectorsFromMount,
  editableMountsFromSpec,
  enabledToolsFromMount,
  withApprovalSelectors,
  withEnabledTools,
  type EditableMount,
} from './agentConfigMounts.js';
import { connectorsWithSelectedStubs } from './mcpConnectorStubs.js';
import {
  approvalSelectorsAfterEnabling,
  approvalSelectorsFor,
  approvedToolNames,
  DEFAULT_APPROVAL_SELECTORS,
  namedToolRequiresApproval,
  sameSelectors,
} from './mcpToolApprovals.js';
import {
  MCP_TOOL_SECTION_ENABLE_ALL_LABELS,
  MCP_TOOL_SECTION_LABELS,
  MCP_TOOL_SECTION_ORDER,
  partitionMcpToolsBySection,
  type McpToolSectionId,
} from './mcpToolSections.js';
import { TOOL_TAG_DESTRUCTIVE, TOOL_TAG_WRITE, toolMatchesSelectors } from './mcpToolSelectors.js';

/** Pre-change harness default; still present on mounts materialized before approval became destructive-only. */
const LEGACY_APPROVAL_SELECTORS = [TOOL_TAG_WRITE, TOOL_TAG_DESTRUCTIVE] as const;

export type AgentMcpEditorContentProps = {
  spec: AgentSpec;
  connectors: ConnectorState[];
  query: string;
  activeConnectorId: string | null;
  tools: McpToolSelection[];
  /** Tools already loaded per connector id, so selected servers can show approval state. */
  toolsByConnector?: Record<string, McpToolSelection[]>;
  connectorLoading: boolean;
  connectorError: string | null;
  toolsLoading: boolean;
  toolsError: string | null;
  onQueryChange: (query: string) => void;
  onSelectConnector: (connectorId: string) => void;
  onRetryTools: () => void;
  onRefreshConnector?: () => void;
  onChange: (spec: AgentSpec) => void;
};

function ConnectorIcon({ connector }: { connector: ConnectorState }) {
  const logo = Reflect.get(connector, 'logo');
  if (typeof logo === 'string' && logo.trim() !== '') {
    return <CatalogLogo src={logo} alt="" className="size-4 shrink-0 object-contain" aria-hidden />;
  }
  return <Icon name="mcp-server" className="text-text-secondary size-4 shrink-0" />;
}

function selectedToolsLabel(mcpMounts: readonly EditableMount[]): string {
  if (mcpMounts.length === 0) return '0';
  if (mcpMounts.every(mount => enabledToolsFromMount(mount.value) === 'all')) return 'All';
  const count = mcpMounts.reduce((total, mount) => {
    const enabled = enabledToolsFromMount(mount.value);
    return enabled === 'all' ? total : total + enabled.length;
  }, 0);
  return `${count}`;
}

function ApprovalBadge() {
  return (
    <span className="border-warning-bg/40 bg-warning-bg/10 text-warning-bg inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.625rem] font-medium">
      <Icon name="shield-check" className="size-2.5" />
      approval
    </span>
  );
}

function ToolApprovalToggle({
  approvalRequired,
  toolName,
  onToggle,
}: {
  approvalRequired: boolean;
  toolName: string;
  onToggle: () => void;
}) {
  return (
    <Tooltip
      side="bottom"
      dismissOnClick={false}
      className="w-64 whitespace-normal p-3 text-left shadow-lg"
      content={
        <span className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between gap-3">
            <span className="font-semibold">Require approval</span>
            <span className="text-primary-button-bg text-[0.625rem] font-semibold tracking-wide uppercase">
              {approvalRequired ? 'ON' : 'OFF'}
            </span>
          </span>
          <span className="text-text-secondary text-xs leading-snug">
            {approvalRequired
              ? 'This tool will ask for your approval before running — click to auto-run'
              : 'This tool runs without asking — click to require your approval'}
          </span>
        </span>
      }
    >
      <button
        type="button"
        aria-pressed={approvalRequired}
        aria-label={`Require approval for ${toolName}`}
        className={auiButtonClass({
          variant: 'secondary',
          size: 'small',
          className: cn(
            'size-6 px-0 [&_svg]:size-3.5',
            approvalRequired
              ? 'border-warning-bg/50 bg-warning-bg/10 text-warning-bg hover:bg-warning-bg/20'
              : 'text-text-secondary',
          ),
        })}
        onClick={onToggle}
      >
        <Icon name={approvalRequired ? 'shield-check' : 'shield'} />
      </button>
    </Tooltip>
  );
}

function ConnectNowButton({ connectorId, onConnected }: { connectorId: string; onConnected: () => void }) {
  const { handleAuthorize, isOAuthLoading } = useMCPAuth();
  return (
    <Button.Primary
      type="button"
      className="min-w-44"
      disabled={isOAuthLoading}
      onClick={() => {
        void handleAuthorize(connectorId, isSuccess => {
          if (isSuccess) onConnected();
        });
      }}
    >
      {isOAuthLoading ? 'Connecting...' : 'Connect Now'}
    </Button.Primary>
  );
}

export function AgentMcpEditorContent({
  spec,
  connectors,
  query,
  activeConnectorId,
  tools,
  toolsByConnector = {},
  connectorLoading,
  connectorError,
  toolsLoading,
  toolsError,
  onQueryChange,
  onSelectConnector,
  onRetryTools,
  onRefreshConnector,
  onChange,
}: AgentMcpEditorContentProps) {
  const [toolQuery, setToolQuery] = useState('');
  const [collapsedMountIds, setCollapsedMountIds] = useState<ReadonlySet<string>>(() => new Set());
  // Freeze open-time selected MCPs at the top; live picks must not reshuffle the list.
  const [openSelectedKeys] = useState(() => {
    const keys = new Set<string>();
    for (const mount of editableMountsFromSpec(spec.mcpServers)) {
      keys.add(mount.id);
      keys.add(mount.name);
    }
    return keys;
  });
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
  const filteredConnectors = catalogConnectors
    .filter(item => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      const leftPinned = openSelectedKeys.has(left.id) || openSelectedKeys.has(left.name);
      const rightPinned = openSelectedKeys.has(right.id) || openSelectedKeys.has(right.name);
      return Number(rightPinned) - Number(leftPinned);
    });
  const normalizedToolQuery = toolQuery.trim().toLowerCase();
  const filteredTools =
    normalizedToolQuery === '' ? tools : tools.filter(tool => tool.name.toLowerCase().includes(normalizedToolQuery));
  const toolSections = partitionMcpToolsBySection(filteredTools);
  const allSections = partitionMcpToolsBySection(tools);
  const approvalSelectors = activeMount
    ? approvalSelectorsFromMount(activeMount.value)
    : [...DEFAULT_APPROVAL_SELECTORS];
  const approvedNames = approvedToolNames({ tools, selectors: approvalSelectors });
  const knownTools: Record<string, McpToolSelection[]> = {
    ...toolsByConnector,
    ...(activeConnectorId !== null && tools.length > 0 ? { [activeConnectorId]: tools } : {}),
  };

  const toolsForMount = (mount: EditableMount): McpToolSelection[] => {
    const connectorId = catalogConnectors.find(item => item.id === mount.id || item.name === mount.name)?.id;
    return knownTools[mount.id] ?? (connectorId === undefined ? undefined : knownTools[connectorId]) ?? [];
  };

  const approvalCount = mcpMounts.reduce((total, mount) => {
    const selectors = approvalSelectorsFromMount(mount.value);
    const mountTools = toolsForMount(mount);
    const enabled = enabledToolsFromMount(mount.value);
    if (enabled === 'all') return total + approvedToolNames({ tools: mountTools, selectors }).size;
    return (
      total + enabled.filter(toolName => namedToolRequiresApproval({ toolName, tools: mountTools, selectors })).length
    );
  }, 0);

  const updateMount = (mountId: string, value: object) => {
    onChange({
      ...spec,
      mcpServers: mcpMounts.map(item => (item.id === mountId ? value : item.value)),
    });
  };

  // Specs saved under the old default still carry `@write`+`@destructive`. Rewrite once tools are
  // known so Other tools show (and run) without approval unless the user opts in.
  const migratedLegacyApprovalRef = useRef(new Set<string>());
  useEffect(() => {
    if (!activeMount || tools.length === 0) return;
    if (migratedLegacyApprovalRef.current.has(activeMount.id)) return;
    const selectors = approvalSelectorsFromMount(activeMount.value);
    if (!sameSelectors(selectors, LEGACY_APPROVAL_SELECTORS)) {
      migratedLegacyApprovalRef.current.add(activeMount.id);
      return;
    }
    migratedLegacyApprovalRef.current.add(activeMount.id);
    const enabled = enabledToolsFromMount(activeMount.value);
    const names = enabled === 'all' ? tools.map(tool => tool.name) : enabled;
    onChange({
      ...spec,
      mcpServers: mcpMounts.map(item =>
        item.id === activeMount.id
          ? withApprovalSelectors(
              activeMount.value,
              approvalSelectorsAfterEnabling({ tools, selectors, newlyEnabledNames: names }),
            )
          : item.value,
      ),
    });
  }, [activeMount, tools, mcpMounts, onChange, spec]);

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

  const commitEnabledTools = ({
    next,
    newlyEnabledNames,
    baseValue,
  }: {
    next: string[];
    newlyEnabledNames: readonly string[];
    baseValue: object;
  }) => {
    let value = withEnabledTools(baseValue, next);
    if (newlyEnabledNames.length > 0 && tools.length > 0) {
      value = withApprovalSelectors(
        value,
        approvalSelectorsAfterEnabling({
          tools,
          selectors: approvalSelectorsFromMount(value),
          newlyEnabledNames,
        }),
      );
    }
    return value;
  };

  const setEnabledToolNames = ({
    next,
    newlyEnabledNames = [],
  }: {
    next: string[];
    newlyEnabledNames?: readonly string[];
  }) => {
    if (!selectedConnector) return;
    if (next.length === 0) {
      if (activeMount) removeMount(activeMount.id);
      return;
    }
    if (activeMount) {
      updateMount(activeMount.id, commitEnabledTools({ next, newlyEnabledNames, baseValue: activeMount.value }));
      return;
    }
    if (!canAddActiveConnector) return;
    onChange({
      ...spec,
      mcpServers: [
        ...(spec.mcpServers ?? []),
        commitEnabledTools({
          next,
          newlyEnabledNames,
          baseValue: { id: selectedConnector.id, name: selectedConnector.name },
        }),
      ],
    });
  };

  const toggleTool = (toolName: string) => {
    if (!selectedConnector) return;
    if (!activeMount) {
      if (!canAddActiveConnector) return;
      setEnabledToolNames({ next: [toolName], newlyEnabledNames: [toolName] });
      return;
    }
    const current = enabledTools === 'all' ? tools.map(tool => tool.name) : enabledTools;
    const checked = current.includes(toolName);
    const next = checked ? current.filter(name => name !== toolName) : [...current, toolName];
    setEnabledToolNames({ next, newlyEnabledNames: checked ? [] : [toolName] });
  };

  const setSectionTools = ({ sectionId, enabled }: { sectionId: McpToolSectionId; enabled: boolean }) => {
    const sectionNames = allSections[sectionId].map(tool => tool.name);
    if (!selectedConnector || sectionNames.length === 0) return;
    if (enabled) {
      if (enabledTools === 'all') return;
      const merged = activeMount ? [...enabledTools] : [];
      const newlyEnabledNames: string[] = [];
      for (const name of sectionNames) {
        if (!merged.includes(name)) {
          merged.push(name);
          newlyEnabledNames.push(name);
        }
      }
      setEnabledToolNames({ next: merged, newlyEnabledNames });
      return;
    }
    const current = enabledTools === 'all' ? tools.map(tool => tool.name) : enabledTools;
    setEnabledToolNames({ next: current.filter(name => !sectionNames.includes(name)) });
  };

  const setToolsApproval = ({ toolNames, required }: { toolNames: readonly string[]; required: boolean }) => {
    // Selectors are rebuilt from the server's tool list, so never rewrite them before it loads.
    if (!activeMount || toolNames.length === 0 || tools.length === 0) return;
    const approved = new Set(approvedNames);
    for (const name of toolNames) {
      if (required) approved.add(name);
      else approved.delete(name);
    }
    updateMount(activeMount.id, withApprovalSelectors(activeMount.value, approvalSelectorsFor({ tools, approved })));
  };

  const connectDuringChat = () => {
    if (!selectedConnector || activeMount !== undefined) return;
    onChange({
      ...spec,
      mcpServers: [
        ...(spec.mcpServers ?? []),
        withApprovalSelectors(
          withEnabledTools({ id: selectedConnector.id, name: selectedConnector.name }, 'all'),
          DEFAULT_APPROVAL_SELECTORS,
        ),
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
            className={auiInputClass('h-8 w-full pl-7')}
          />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
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
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-border md:border-r md:border-b-0">
        {selectedConnector ? (
          connectorLoading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-3" aria-label="Loading MCP server">
              <Spinner size={20} className="text-text-secondary" />
            </div>
          ) : connectorError ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center">
              <p className="text-failure-bg text-sm">{connectorError}</p>
              <Button.Secondary type="button" size="small" className="mt-2" onClick={onRetryTools}>
                Retry
              </Button.Secondary>
            </div>
          ) : needsAuth ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              <Icon name="lock" className="text-text-secondary size-10" />
              <p className="text-text-primary text-sm font-semibold">You&apos;re not connected to this MCP Server</p>
              {onRefreshConnector ? (
                <ConnectNowButton connectorId={selectedConnector.id} onConnected={onRefreshConnector} />
              ) : null}
              <div className="text-text-secondary flex w-full max-w-xs items-center gap-3 text-xs">
                <span className="bg-border h-px flex-1" />
                OR
                <span className="bg-border h-px flex-1" />
              </div>
              <Button.Secondary
                type="button"
                className="min-w-44"
                disabled={activeMount !== undefined}
                onClick={connectDuringChat}
              >
                Connect During Chat
              </Button.Secondary>
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
                  className={auiInputClass('h-8 w-full pl-7')}
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
                    <Button.Secondary type="button" size="small" className="mt-2" onClick={onRetryTools}>
                      Retry
                    </Button.Secondary>
                  </div>
                ) : null}
                {!toolsLoading
                  ? MCP_TOOL_SECTION_ORDER.map(sectionId => {
                      const sectionTools = toolSections[sectionId];
                      if (sectionTools.length === 0) return null;
                      const onlyOthers =
                        toolSections['read-only'].length === 0 && toolSections.destructive.length === 0;
                      const showSectionHeader = sectionId !== 'others' || !onlyOthers;
                      const sectionNames = allSections[sectionId].map(tool => tool.name);
                      const sectionEnabled =
                        sectionNames.length > 0 &&
                        (enabledTools === 'all' || sectionNames.every(name => enabledTools.includes(name)));
                      // Approval only applies to tools the agent can call, so bulk gating follows the enabled set.
                      const sectionEnabledNames =
                        enabledTools === 'all'
                          ? sectionNames
                          : sectionNames.filter(name => enabledTools.includes(name));
                      const sectionApproved =
                        sectionEnabledNames.length > 0 && sectionEnabledNames.every(name => approvedNames.has(name));
                      return (
                        <div key={sectionId} className="mb-3">
                          {showSectionHeader ? (
                            <div className="flex items-center justify-between gap-2 px-2 py-2">
                              <p
                                className={cn(
                                  'min-w-0 truncate text-sm font-semibold',
                                  sectionId === 'destructive' ? 'text-failure-bg' : 'text-text-primary',
                                )}
                              >
                                {MCP_TOOL_SECTION_LABELS[sectionId]}
                              </p>
                              <div className="flex shrink-0 items-center gap-3">
                                {sectionId !== 'destructive' || sectionEnabledNames.length === 0 ? null : (
                                  <label className="text-text-secondary flex shrink-0 cursor-pointer items-center gap-2 text-xs">
                                    Approval required
                                    <Switch
                                      checked={sectionApproved}
                                      onCheckedChange={required =>
                                        setToolsApproval({ toolNames: sectionEnabledNames, required })
                                      }
                                      aria-label="Require approval for all destructive tools"
                                    />
                                  </label>
                                )}
                                <label className="text-text-secondary flex shrink-0 cursor-pointer items-center gap-2 text-xs has-[:disabled]:cursor-not-allowed">
                                  Enable all
                                  <Switch
                                    checked={sectionEnabled}
                                    disabled={!canAddActiveConnector && activeMount === undefined}
                                    onCheckedChange={enabled => setSectionTools({ sectionId, enabled })}
                                    aria-label={MCP_TOOL_SECTION_ENABLE_ALL_LABELS[sectionId]}
                                  />
                                </label>
                              </div>
                            </div>
                          ) : null}
                          {sectionTools.map(tool => {
                            const checked = enabledTools === 'all' || enabledTools.includes(tool.name);
                            const approvalRequired = toolMatchesSelectors({ tool, selectors: approvalSelectors });
                            return (
                              <div
                                key={tool.id}
                                className="hover:bg-ghost-button-hover flex w-full items-center gap-1 rounded-md pr-2"
                              >
                                <button
                                  type="button"
                                  role="menuitemcheckbox"
                                  aria-checked={checked}
                                  aria-label={tool.name}
                                  disabled={!canAddActiveConnector && activeMount === undefined}
                                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
                                  onClick={() => toggleTool(tool.name)}
                                >
                                  <Checkbox checked={checked} />
                                  <span className="min-w-0 flex-1">
                                    <span className="text-text-primary block truncate text-sm font-medium">
                                      {tool.name}
                                    </span>
                                    {tool.description ? (
                                      <span className="text-text-secondary line-clamp-1 text-xs">
                                        {tool.description}
                                      </span>
                                    ) : null}
                                  </span>
                                </button>
                                {checked ? (
                                  <ToolApprovalToggle
                                    approvalRequired={approvalRequired}
                                    toolName={tool.name}
                                    onToggle={() =>
                                      setToolsApproval({ toolNames: [tool.name], required: !approvalRequired })
                                    }
                                  />
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                  : null}
              </div>
            </>
          )
        ) : (
          <p className="text-text-secondary p-4 text-sm">Select an MCP server to configure its tools.</p>
        )}
      </div>

      <div className="flex max-h-44 min-h-0 min-w-0 flex-col md:max-h-none">
        <div className="shrink-0 border-b border-border p-3">
          <p className="text-sm font-semibold">Selected Tools ({selectedToolsLabel(mcpMounts)})</p>
          {mcpMounts.length ? (
            <p className="text-text-secondary mt-0.5 text-xs">
              {selectedToolsLabel(mcpMounts)} selected · {approvalCount} need approval
            </p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {mcpMounts.length ? (
            <div className="space-y-1">
              {mcpMounts.map(mount => {
                const selected = enabledToolsFromMount(mount.value);
                const mountSelectors = approvalSelectorsFromMount(mount.value);
                const mountTools = toolsForMount(mount);
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
                        className="text-text-secondary hover:bg-ghost-button-hover flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 pl-7 text-left text-[0.6875rem] font-medium tracking-wide uppercase"
                        onClick={() => openMountConnector(mount)}
                      >
                        <Icon name="wrench" className="size-3 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">ALL TOOLS ENABLED</span>
                        {approvedToolNames({ tools: mountTools, selectors: mountSelectors }).size > 0 ? (
                          <ApprovalBadge />
                        ) : null}
                      </button>
                    ) : selected.length ? (
                      selected.map(toolName => (
                        <button
                          key={`${mount.id}:${toolName}`}
                          type="button"
                          aria-label={`Open ${mount.name} for ${toolName}`}
                          className="text-text-primary hover:bg-ghost-button-hover flex w-full h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 pl-7 text-left text-[0.6875rem]"
                          onClick={() => openMountConnector(mount)}
                        >
                          <Icon name="wrench" className="text-text-secondary size-3 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{toolName}</span>
                          {namedToolRequiresApproval({ toolName, tools: mountTools, selectors: mountSelectors }) ? (
                            <ApprovalBadge />
                          ) : null}
                        </button>
                      ))
                    ) : (
                      <p className="text-text-secondary px-2 py-1.5 pl-7 text-[0.6875rem]">No tools selected.</p>
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
