'use client';

import { useEffect, useMemo, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import { useOptionalServer } from '../../server/ServerContext.js';
import type { McpToolSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import {
  approvalSelectorsFromMount,
  editableMountsFromSpec,
  enabledToolsFromMount,
} from '../draft/agentConfigMounts.js';
import { namedToolRequiresApproval } from '../draft/mcpToolApprovals.js';
import { mcpToolKind, type McpToolKind } from '../draft/mcpToolSections.js';
import { cn } from '../lib/cn.js';
import { Tooltip } from '../primitives/Tooltip.js';

const KIND_CLASSES: Record<McpToolKind, string> = {
  read: 'border-border bg-secondary-bg text-text-secondary',
  write: 'border-border bg-secondary-bg text-text-primary',
  destructive: 'border-failure-bg/30 bg-failure-bg/10 text-failure-bg',
};

/** Read-only tools first and destructive last, mirroring the tool picker's sections. */
const KIND_ORDER: Record<McpToolKind | 'unknown', number> = {
  read: 0,
  write: 1,
  unknown: 2,
  destructive: 3,
};

function toolCountLabel({ count, unknown }: { count: number; unknown: boolean }): string {
  if (unknown) return 'All tools';
  return count === 1 ? '1 tool' : `${count} tools`;
}

function ApprovalCountBadge({ count }: { count: number }) {
  return (
    <span
      className="border-warning-bg/40 bg-warning-bg/10 text-warning-bg inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.625rem] font-medium"
      aria-label={`${count} ${count === 1 ? 'tool needs' : 'tools need'} approval`}
    >
      <Icon name="shield-check" className="size-2.5" />
      {count}
    </span>
  );
}

function ToolKindPill({ kind }: { kind: McpToolKind }) {
  return (
    <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[0.625rem] font-medium', KIND_CLASSES[kind])}>
      {kind}
    </span>
  );
}

function ApprovalIndicator({ approvalRequired, toolName }: { approvalRequired: boolean; toolName: string }) {
  return (
    <Tooltip
      content={approvalRequired ? 'Asks for approval before running' : 'Runs without asking for approval'}
      triggerClassName="shrink-0"
    >
      <span
        role="img"
        aria-label={`${toolName} ${approvalRequired ? 'requires approval' : 'runs without approval'}`}
        className={cn(
          'flex size-5 items-center justify-center rounded-md border',
          approvalRequired
            ? 'border-warning-bg/50 bg-warning-bg/10 text-warning-bg'
            : 'border-border text-text-secondary',
        )}
      >
        <Icon name={approvalRequired ? 'shield-check' : 'shield'} className="size-3" />
      </span>
    </Tooltip>
  );
}

/** Attached MCP servers, each expanding into the tools the agent can call. */
export function AgentOverviewMcpServers({ mcpServers }: { mcpServers: unknown }) {
  const AgentOverviewCard = useSlot('AgentOverviewCard');
  const server = useOptionalServer();
  const getMcpTools = server?.getMcpTools;
  const mounts = useMemo(() => editableMountsFromSpec(mcpServers), [mcpServers]);
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpToolSelection[]>>({});
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());

  // Tool metadata drives the counts, kinds, and approval state; a failing server just shows less.
  useEffect(() => {
    if (getMcpTools === undefined) return;
    let cancelled = false;
    for (const mount of mounts) {
      void getMcpTools({ connectorId: mount.name }).then(
        tools => {
          if (!cancelled) setToolsByServer(prev => ({ ...prev, [mount.name]: tools }));
        },
        () => {},
      );
    }
    return () => {
      cancelled = true;
    };
  }, [getMcpTools, mounts]);

  if (mounts.length === 0) {
    return (
      <AgentOverviewCard title="MCP Servers & Tools" icon="plug" count={0}>
        <p className="text-text-secondary text-xs">No connectors attached.</p>
      </AgentOverviewCard>
    );
  }

  return (
    <AgentOverviewCard title="MCP Servers & Tools" icon="plug" count={mounts.length}>
      <ul className="space-y-1.5">
        {mounts.map(mount => {
          const tools = toolsByServer[mount.name] ?? [];
          const selectors = approvalSelectorsFromMount(mount.value);
          const enabled = enabledToolsFromMount(mount.value);
          const toolNames = (enabled === 'all' ? tools.map(tool => tool.name) : enabled)
            .map(toolName => {
              const tool = tools.find(item => item.name === toolName);
              const kind = tool === undefined ? undefined : mcpToolKind(tool);
              return {
                toolName,
                kind,
                approvalRequired: namedToolRequiresApproval({ toolName, tools, selectors }),
              };
            })
            .sort((left, right) => KIND_ORDER[left.kind ?? 'unknown'] - KIND_ORDER[right.kind ?? 'unknown']);
          const approvalCount = toolNames.filter(tool => tool.approvalRequired).length;
          const expanded = expandedIds.has(mount.id);
          return (
            <li key={mount.id} className="overflow-hidden rounded-md border border-border">
              <button
                type="button"
                aria-expanded={expanded}
                disabled={toolNames.length === 0}
                className="flex w-full cursor-pointer items-center gap-2 bg-secondary-bg px-2.5 py-2 text-left text-xs hover:bg-ghost-button-hover disabled:cursor-default disabled:hover:bg-secondary-bg"
                onClick={() =>
                  setExpandedIds(prev => {
                    const next = new Set(prev);
                    if (expanded) next.delete(mount.id);
                    else next.add(mount.id);
                    return next;
                  })
                }
              >
                <Icon
                  name="chevron-down"
                  className={cn(
                    'size-3 shrink-0 text-text-secondary transition-transform',
                    expanded ? undefined : '-rotate-90',
                    toolNames.length === 0 && 'invisible',
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{mount.name}</span>
                <span className="shrink-0 text-text-secondary">
                  {toolCountLabel({ count: toolNames.length, unknown: enabled === 'all' && tools.length === 0 })}
                </span>
                {approvalCount > 0 ? <ApprovalCountBadge count={approvalCount} /> : null}
              </button>
              {expanded ? (
                <ul className="divide-y divide-border border-t border-border">
                  {toolNames.map(({ toolName, kind, approvalRequired }) => (
                    <li key={toolName} className="flex items-center gap-2 px-2.5 py-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem]" title={toolName}>
                        {toolName}
                      </span>
                      {kind ? <ToolKindPill kind={kind} /> : null}
                      <ApprovalIndicator approvalRequired={approvalRequired} toolName={toolName} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </AgentOverviewCard>
  );
}
