'use client';

import { useCallback, useEffect, useState } from 'react';

import { useResourcePermissions } from '../hooks/useResourcePermissions.js';
import { useSessionShareSearch } from '../hooks/useSessionShareSearch.js';
import { Icon } from '../icons/Icon.js';
import { isSchedulesChromeEnabled, isSessionsChromeEnabled } from '../server/serverChrome.js';
import { useOptionalAgentSessionsServer, useOptionalScheduleServer } from '../server/ServerContext.js';
import { libraryAgentId, useShellMode } from '../server/ShellModeContext.js';
import type { AgentLibraryEntry, AgentSpec, Schedule } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { hasCreatedBySubject } from '../utils/createdBySubject.js';
import { replaceScheduleShareSearch } from '../utils/scheduleShareUrl.js';
import { AgentOverflowMenu } from './AgentOverflowMenu.js';
import { CreatedByCell } from './CreatedByCell.js';
import { EmptyScreen, EmptyScreenQueryHighlight } from './EmptyScreen.js';
import { mountName } from './lib/mountName.js';
import { useSearchAgentsList } from './lib/useSearchAgentsList.js';
import { PageHeader } from './PageHeader.js';
import { Button } from './primitives/Button.js';
import SearchInput from './primitives/SearchInput.js';
import { Skeleton } from './primitives/Skeleton.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './primitives/Table.js';
import { Tooltip } from './primitives/Tooltip.js';

export type AgentsLibraryProps = {
  onSelectAgent?: (agentName: string) => void;
};

export type AgentScheduleSummary = {
  count: number;
  pausedCount: number;
  activeNames: string[];
  pausedNames: string[];
};

export type AgentLibraryRowProps = {
  agent: AgentLibraryEntry;
  canMutate: boolean;
  canUseAgent?: boolean;
  canManageAgent?: boolean;
  canDeleteAgent?: boolean;
  canManageSchedules: boolean;
  showCreatedBy?: boolean;
  scheduleSummary?: AgentScheduleSummary | null;
  onOpenSchedules?: () => void;
  onCreateSchedule?: () => void;
  onOpen?: () => void;
  onTry: () => void;
  onEdit: () => void;
  onManageSchedules?: () => void;
};

/** Short label for model fqns like `provider/gpt-4.1` → `gpt-4.1`. */
function displayModelLabel(modelName: string): string {
  const slash = modelName.lastIndexOf('/');
  return slash >= 0 ? modelName.slice(slash + 1) : modelName;
}

function AgentSchedulesEmptyState({
  agentName,
  onOpen,
  disabled,
}: {
  agentName: string;
  onOpen?: () => void;
  disabled: boolean;
}) {
  return (
    <>
      <span aria-hidden className="text-text-secondary text-sm md:group-hover:hidden">
        -
      </span>
      <Button.Ghost
        type="button"
        size="small"
        disabled={disabled}
        aria-label={`Add schedule for ${agentName}`}
        className="hidden md:group-hover:inline-flex"
        onClick={onOpen}
      >
        <Icon name="plus" className="size-3.5 shrink-0" />
        Schedule
      </Button.Ghost>
    </>
  );
}

function scheduleNamesTooltip(names: readonly string[]) {
  return (
    <span className="flex flex-col text-left">
      {names.map((name, index) => (
        <span key={name}>
          {name}
          {index < names.length - 1 ? ',' : ''}
        </span>
      ))}
    </span>
  );
}

function AgentSchedulesBadge({
  summary,
  agentName,
  onOpen,
  disabled,
}: {
  summary: AgentScheduleSummary;
  agentName: string;
  onOpen?: () => void;
  disabled: boolean;
}) {
  const pausedCount = summary.pausedCount;
  const activeCount = summary.count - pausedCount;
  const ariaParts = [
    ...(activeCount > 0 ? [`${activeCount} active`] : []),
    ...(pausedCount > 0 ? [`${pausedCount} paused`] : []),
  ];
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${ariaParts.join(', ')} schedules for ${agentName}`}
      className="inline-flex cursor-pointer items-center gap-1.5"
      onClick={onOpen}
    >
      {activeCount > 0 ? (
        <Tooltip content={scheduleNamesTooltip(summary.activeNames)} className="whitespace-normal">
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-600/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/15 dark:text-emerald-300">
            <Icon name="calendar-clock" className="size-3.5 shrink-0" />
            <span>{activeCount} Active</span>
          </span>
        </Tooltip>
      ) : null}
      {pausedCount > 0 ? (
        <Tooltip content={scheduleNamesTooltip(summary.pausedNames)} className="whitespace-normal">
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-600/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/15 dark:text-amber-300">
            {activeCount === 0 ? <Icon name="calendar-clock" className="size-3.5 shrink-0" /> : null}
            <span>{pausedCount} Paused</span>
            <Icon name="triangle-exclamation" className="size-3.5 shrink-0" />
          </span>
        </Tooltip>
      ) : null}
    </button>
  );
}

export function AgentLibraryRow({
  agent,
  canMutate,
  canUseAgent = true,
  canManageAgent = true,
  canDeleteAgent = true,
  canManageSchedules,
  showCreatedBy = false,
  scheduleSummary,
  onOpenSchedules,
  onCreateSchedule,
  onOpen,
  onTry,
  onEdit,
  onManageSchedules,
}: AgentLibraryRowProps) {
  const PermissionGuard = useSlot('PermissionGuard');
  const spec = agent.agentSpec;
  const modelName = spec?.model.name;
  const skillsCount = spec?.skills?.length ?? 0;
  const mcpCount = spec?.mcpServers?.length ?? 0;
  const skillNames = (spec?.skills ?? []).map(mountName).filter((name: string | null): name is string => name != null);
  const mcpNames = (spec?.mcpServers ?? [])
    .map(mountName)
    .filter((name: string | null): name is string => name != null);
  const modelLabel = modelName != null ? displayModelLabel(modelName) : null;
  const modelTitle = modelName ?? '';
  const connectorsTitle = mcpNames.length ? mcpNames.join(', ') : `${mcpCount} connectors`;
  const skillsTitle = skillNames.length ? skillNames.join(', ') : `${skillsCount} skills`;
  const hasConfiguration = modelLabel != null || skillsCount > 0 || mcpCount > 0;
  const hasNoSchedules = scheduleSummary != null && scheduleSummary.count === 0;
  const description = agent.description?.trim() ? agent.description : null;

  return (
    <TableRow className={hasNoSchedules ? 'group' : undefined}>
      <TableCell className="text-text-primary font-medium">
        {onOpen == null ? (
          <span className="block truncate">{agent.name}</span>
        ) : (
          <button
            type="button"
            className="block max-w-full cursor-pointer text-left"
            aria-label={`Open ${agent.name}`}
            onClick={onOpen}
          >
            <span className="block truncate">{agent.name}</span>
          </button>
        )}
        {description ? (
          <span className="text-text-secondary block truncate text-xs font-normal" title={description}>
            {description}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        {hasConfiguration ? (
          <div className="text-text-secondary flex min-w-0 items-center gap-2">
            {modelLabel != null ? (
              <Tooltip content={modelTitle}>
                <span
                  className="bg-secondary-bg text-text-secondary inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-medium"
                  aria-label={modelTitle}
                >
                  <Icon name="cpu" className="size-3.5 shrink-0" />
                  <span className="truncate">{modelLabel}</span>
                </span>
              </Tooltip>
            ) : null}
            {skillsCount > 0 ? (
              <Tooltip content={skillsTitle}>
                <span className="inline-flex items-center gap-1 text-xs" aria-label={`Skills: ${skillsTitle}`}>
                  <Icon name="lightbulb" className="size-3.5 shrink-0" />
                  {skillsCount}
                </span>
              </Tooltip>
            ) : null}
            {mcpCount > 0 ? (
              <Tooltip content={connectorsTitle}>
                <span className="inline-flex items-center gap-1 text-xs" aria-label={`Connectors: ${connectorsTitle}`}>
                  <Icon name="plug" className="size-3.5 shrink-0" />
                  {mcpCount}
                </span>
              </Tooltip>
            ) : null}
          </div>
        ) : (
          <span className="text-text-secondary text-sm" aria-label={`Configuration unavailable for ${agent.name}`}>
            —
          </span>
        )}
      </TableCell>
      {showCreatedBy ? (
        <TableCell>
          <CreatedByCell subject={agent.createdBySubject} />
        </TableCell>
      ) : null}
      {scheduleSummary !== undefined ? (
        <TableCell>
          {scheduleSummary != null && scheduleSummary.count > 0 ? (
            <AgentSchedulesBadge
              summary={scheduleSummary}
              agentName={agent.name}
              onOpen={onOpenSchedules}
              disabled={!canUseAgent}
            />
          ) : scheduleSummary != null ? (
            <AgentSchedulesEmptyState agentName={agent.name} onOpen={onCreateSchedule} disabled={!canUseAgent} />
          ) : (
            <span className="text-text-secondary text-sm" aria-label={`Schedule count unavailable for ${agent.name}`}>
              —
            </span>
          )}
        </TableCell>
      ) : null}
      <TableCell>
        <div className="flex items-center justify-end gap-1.5">
          <PermissionGuard allowed={canUseAgent}>
            <Button.Secondary type="button" aria-label={`Try agent ${agent.name}`} size="large" onClick={onTry}>
              <Icon name="play" className="size-3.5" />
              Try
            </Button.Secondary>
          </PermissionGuard>
          <AgentOverflowMenu
            agentName={agent.name}
            {...(description != null ? { description } : {})}
            {...(spec != null ? { agentSpec: spec } : {})}
            canMutate={canMutate}
            canUse={canUseAgent}
            canManage={canManageAgent}
            canDelete={canDeleteAgent}
            canManageSchedules={canManageSchedules}
            onEdit={onEdit}
            {...(onManageSchedules != null ? { onManageSchedules } : {})}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function summarizeSchedulesByAgent(schedules: readonly Schedule[]): Map<string, AgentScheduleSummary> {
  const map = new Map<string, AgentScheduleSummary>();
  for (const schedule of schedules) {
    const id = schedule.agentId;
    const prev = map.get(id) ?? { count: 0, pausedCount: 0, activeNames: [], pausedNames: [] };
    const isPaused = schedule.status === 'paused';
    const next: AgentScheduleSummary = {
      count: prev.count + 1,
      pausedCount: prev.pausedCount + (isPaused ? 1 : 0),
      activeNames: isPaused ? prev.activeNames : [...prev.activeNames, schedule.name],
      pausedNames: isPaused ? [...prev.pausedNames, schedule.name] : prev.pausedNames,
    };
    map.set(id, next);
    if (schedule.agentName != null && schedule.agentName !== '' && schedule.agentName !== id) {
      map.set(schedule.agentName, next);
    }
  }
  return map;
}

async function listAllSchedulesForAgents({
  listSchedules,
  agentIds,
}: {
  listSchedules: NonNullable<ReturnType<typeof useOptionalScheduleServer>>['listSchedules'];
  agentIds: string[];
}): Promise<Schedule[]> {
  if (agentIds.length === 0) return [];
  const rows: Schedule[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listSchedules({
      agentIds,
      limit: 25,
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    rows.push(...page.data);
    pageToken = page.nextPageToken;
  } while (pageToken != null && pageToken !== '');
  return rows;
}

export function AgentsLibrary({ onSelectAgent }: AgentsLibraryProps) {
  const shell = useShellMode();
  const { updateShareSearch } = useSessionShareSearch();
  const sessionsServer = useOptionalAgentSessionsServer();
  const scheduleServer = useOptionalScheduleServer();
  const SlottedAgentLibraryRow = useSlot('AgentLibraryRow');
  const [query, setQuery] = useState('');
  const [scheduleByAgent, setScheduleByAgent] = useState<Map<string, AgentScheduleSummary> | null>(null);
  const open = shell.libraryOpen;

  const canMutate = shell.isComposerEnabled === true;
  const agentsListEpoch = shell.agentsListEpoch;
  const showSchedulesColumn = isSchedulesChromeEnabled({ schedules: scheduleServer });
  const canOpenAgentDetails = isSessionsChromeEnabled({ sessions: sessionsServer });
  const canOpenAgentSchedules = showSchedulesColumn && canOpenAgentDetails;

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const closeLibrary = useCallback(() => {
    shell.setLibraryOpen(false);
    setQuery('');
  }, [shell]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      closeLibrary();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeLibrary, open]);

  const { agents, isInitialLoading, isSearching, loadingMore, error, hasMore, listRef, sentinelRef } =
    useSearchAgentsList({
      enabled: open,
      query,
      refreshKey: agentsListEpoch,
    });
  const showCreatedByColumn = hasCreatedBySubject(agents);
  const permissionAgentIds = open ? agents.map(libraryAgentId) : [];
  const { allows } = useResourcePermissions({
    resourceType: 'agent',
    resourceIds: permissionAgentIds,
  });

  useEffect(() => {
    if (!open || scheduleServer == null || agents.length === 0) {
      setScheduleByAgent(null);
      return;
    }
    let cancelled = false;
    setScheduleByAgent(null);
    const agentIds = agents.map(libraryAgentId);
    void listAllSchedulesForAgents({ listSchedules: scheduleServer.listSchedules, agentIds })
      .then(rows => {
        if (!cancelled) setScheduleByAgent(summarizeSchedulesByAgent(rows));
      })
      .catch(() => {
        if (!cancelled) setScheduleByAgent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [agents, open, scheduleServer, agentsListEpoch]);

  const openSchedulesForAgent = ({ agentId, isNew }: { agentId: string; isNew?: boolean }) => {
    replaceScheduleShareSearch({
      agent: null,
      status: null,
      q: null,
      isNew: isNew === true ? true : null,
    });
    updateShareSearch({
      agentId,
      tab: 'schedules',
      sessionId: null,
      view: null,
      timeRange: null,
    });
    shell.openLibraryAgent(agentId);
  };

  const handleTry = (agent: AgentLibraryEntry) => {
    closeLibrary();
    onSelectAgent?.(agent.name);
    shell.selectLibraryAgent({
      isMutable: false,
      agentId: libraryAgentId(agent),
      agentName: agent.name,
    });
  };

  const handleEdit = (agent: AgentLibraryEntry, agentSpec: AgentSpec) => {
    closeLibrary();
    onSelectAgent?.(agent.name);
    shell.selectLibraryAgent({
      isMutable: true,
      isCreateAgent: true,
      agentId: libraryAgentId(agent),
      agentName: agent.name,
      ...(agent.description === undefined ? {} : { description: agent.description }),
      agentSpec,
    });
  };

  if (!open) return null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-primary-bg">
      <PageHeader
        title="Agents"
        end={
          <div className="w-56 shrink-0">
            <SearchInput query={query} setQuery={setQuery} placeholder="Search agents" />
            {isSearching ? (
              <p className="sr-only" role="status">
                Searching…
              </p>
            ) : null}
          </div>
        }
      />

      <div className="bg-secondary-bg/40 flex min-h-0 flex-1 flex-col">
        {/* Not flex-col: overflow-hidden table chrome would clip instead of letting this scroll. */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-4" aria-label="Agents">
          {isInitialLoading ? (
            <div className="flex flex-col gap-2 p-1" role="status" aria-label="Loading agents">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-11 w-full rounded-md" />
              ))}
            </div>
          ) : error ? (
            <p className="text-failure-bg px-3 py-8 text-center text-sm">{error}</p>
          ) : agents.length === 0 ? (
            <EmptyScreen
              title="No Agents Found"
              description={
                query.trim() ? (
                  <>
                    No search results found for <EmptyScreenQueryHighlight>{query.trim()}</EmptyScreenQueryHighlight>
                  </>
                ) : (
                  'Build one in a chat, then save it as an agent.'
                )
              }
            />
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-border">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="min-w-64">Agent name</TableHead>
                      <TableHead className="w-64">Configuration</TableHead>
                      {showCreatedByColumn ? <TableHead className="w-56">Created by</TableHead> : null}
                      {showSchedulesColumn ? <TableHead className="w-64">Schedules</TableHead> : null}
                      <TableHead className="w-32">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agents.map(agent => {
                      const agentSpec = agent.agentSpec;
                      const agentId = agent.agentId;
                      const id = libraryAgentId(agent);
                      const summary = showSchedulesColumn
                        ? (scheduleByAgent?.get(id) ??
                          scheduleByAgent?.get(agent.name) ??
                          (scheduleByAgent == null
                            ? null
                            : { count: 0, pausedCount: 0, activeNames: [], pausedNames: [] }))
                        : undefined;
                      return (
                        <SlottedAgentLibraryRow
                          key={id}
                          agent={agent}
                          canMutate={canMutate}
                          canUseAgent={allows(id, 'USE')}
                          canManageAgent={allows(id, 'MANAGE')}
                          canDeleteAgent={allows(id, 'DELETE')}
                          canManageSchedules={canOpenAgentSchedules}
                          showCreatedBy={showCreatedByColumn}
                          {...(summary !== undefined ? { scheduleSummary: summary } : {})}
                          {...(canOpenAgentSchedules && agentId != null
                            ? {
                                onOpenSchedules: () => openSchedulesForAgent({ agentId }),
                                onCreateSchedule: () => openSchedulesForAgent({ agentId, isNew: true }),
                                onManageSchedules: () => openSchedulesForAgent({ agentId }),
                              }
                            : {})}
                          {...(canOpenAgentDetails && agentId != null
                            ? {
                                onOpen: () => {
                                  updateShareSearch({
                                    agentId,
                                    tab: 'overview',
                                    sessionId: null,
                                    view: null,
                                    timeRange: null,
                                  });
                                  shell.openLibraryAgent(agentId);
                                },
                              }
                            : {})}
                          onTry={() => {
                            if (allows(id, 'USE')) handleTry(agent);
                          }}
                          onEdit={() => {
                            if (agentSpec != null && allows(id, 'MANAGE')) handleEdit(agent, agentSpec);
                          }}
                        />
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {hasMore ? (
                <div ref={sentinelRef} className="flex h-8 shrink-0 items-center justify-center" aria-hidden>
                  {loadingMore ? (
                    <span className="text-text-secondary text-xs" role="status">
                      Loading more…
                    </span>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentsLibrary: typeof AgentsLibrary;
    AgentLibraryRow: typeof AgentLibraryRow;
  }
}
