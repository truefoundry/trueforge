'use client';

import { useCallback, useEffect, useState } from 'react';

import { useSessionShareSearch } from '../hooks/useSessionShareSearch.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalAgentSessionsServer, useOptionalScheduleServer } from '../server/ServerContext.js';
import { libraryAgentId, useShellMode } from '../server/ShellModeContext.js';
import type { AgentLibraryEntry, AgentSpec, Schedule } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { writeScheduleShareSearch } from '../utils/scheduleShareUrl.js';
import { writeSessionShareSearch } from '../utils/sessionShareUrl.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { mountName } from './lib/mountName.js';
import { useSearchAgentsList } from './lib/useSearchAgentsList.js';
import { DropdownMenu, DropdownMenuItem } from './primitives/DropdownMenu.js';
import SearchInput from './primitives/SearchInput.js';
import { Skeleton } from './primitives/Skeleton.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './primitives/Table.js';
import { Tooltip } from './primitives/Tooltip.js';

export type AgentsLibraryProps = {
  onSelectAgent?: (agentName: string) => void;
};

export type AgentScheduleSummary = {
  count: number;
  hasPaused: boolean;
};

export type AgentLibraryRowProps = {
  agent: AgentLibraryEntry;
  showEdit: boolean;
  scheduleSummary?: AgentScheduleSummary | null;
  onOpenSchedules?: () => void;
  onCreateSchedule?: () => void;
  onOpen?: () => void;
  onTry: () => void;
  onEdit: () => void;
};

/** Short label for model fqns like `provider/gpt-4.1` → `gpt-4.1`. */
function displayModelLabel(modelName: string): string {
  const slash = modelName.lastIndexOf('/');
  return slash >= 0 ? modelName.slice(slash + 1) : modelName;
}

function AgentSchedulesEmptyState({ agentName, onOpen }: { agentName: string; onOpen?: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Add schedule for ${agentName}`}
      className="text-text-secondary hover:text-primary-button-bg cursor-pointer text-sm font-medium"
      onClick={onOpen}
    >
      <span aria-hidden className="md:group-hover:hidden">
        -
      </span>
      <span aria-hidden className="hidden items-center gap-1 md:group-hover:inline-flex">
        <Icon name="plus" className="size-3.5 shrink-0" />
        Schedule
      </span>
    </button>
  );
}

function AgentSchedulesBadge({
  summary,
  agentName,
  onOpen,
}: {
  summary: AgentScheduleSummary;
  agentName: string;
  onOpen?: () => void;
}) {
  const warning = summary.hasPaused;
  return (
    <button
      type="button"
      aria-label={`${String(summary.count)} schedules for ${agentName}${warning ? ' (has paused)' : ''}`}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        warning
          ? 'border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
          : 'border-border bg-secondary-bg text-text-secondary',
      )}
      onClick={onOpen}
    >
      <Icon name="calendar-clock" className="size-3.5 shrink-0" />
      <span>{summary.count}</span>
      {warning ? <Icon name="triangle-exclamation" className="size-3.5 shrink-0" /> : null}
    </button>
  );
}

export function AgentLibraryRow({
  agent,
  showEdit,
  scheduleSummary,
  onOpenSchedules,
  onCreateSchedule,
  onOpen,
  onTry,
  onEdit,
}: AgentLibraryRowProps) {
  const spec = agent.agentSpec;
  const modelName = spec?.model.name;
  const skillsCount = spec?.skills?.length ?? 0;
  const mcpCount = spec?.mcpServers?.length ?? 0;
  const skillNames = (spec?.skills ?? []).map(mountName).filter((name: string | null): name is string => name != null);
  const mcpNames = (spec?.mcpServers ?? [])
    .map(mountName)
    .filter((name: string | null): name is string => name != null);
  const connectorsTitle = mcpNames.length ? `Connectors: ${mcpNames.join(', ')}` : `${mcpCount} connectors`;
  const skillsTitle = skillNames.length ? `Skills: ${skillNames.join(', ')}` : `${skillsCount} skills`;

  const hasNoSchedules = scheduleSummary != null && scheduleSummary.count === 0;

  return (
    <TableRow className={hasNoSchedules ? 'group' : undefined}>
      <TableCell className="text-text-primary font-medium">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="bg-primary-bg text-text-secondary inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
            <Icon name="robot" className="size-4" />
          </span>
          <div className="min-w-0">
            {onOpen == null ? (
              <span className="block truncate">{agent.name}</span>
            ) : (
              <button
                type="button"
                className="hover:text-primary-button-bg block max-w-full cursor-pointer truncate text-left hover:underline"
                aria-label={`Open ${agent.name}`}
                onClick={onOpen}
              >
                {agent.name}
              </button>
            )}
            {spec != null ? (
              <div className="text-text-secondary mt-1 flex min-w-0 items-center gap-2">
                {modelName ? (
                  <span className="bg-primary-button-bg/10 text-primary-button-bg inline-flex max-w-[8rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-medium">
                    <Icon name="cpu" className="size-3.5 shrink-0" />
                    <span className="truncate">{displayModelLabel(modelName)}</span>
                  </span>
                ) : null}
                {mcpCount > 0 ? (
                  <Tooltip content={connectorsTitle}>
                    <span className="inline-flex items-center gap-1 text-xs" aria-label={connectorsTitle}>
                      <Icon name="plug" className="size-3.5" />
                      {mcpCount}
                    </span>
                  </Tooltip>
                ) : null}
                {skillsCount > 0 ? (
                  <Tooltip content={skillsTitle}>
                    <span className="inline-flex items-center gap-1 text-xs" aria-label={skillsTitle}>
                      <Icon name="lightbulb" className="size-3.5" />
                      {skillsCount}
                    </span>
                  </Tooltip>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </TableCell>
      {scheduleSummary !== undefined ? (
        <TableCell>
          {scheduleSummary != null && scheduleSummary.count > 0 ? (
            <AgentSchedulesBadge summary={scheduleSummary} agentName={agent.name} onOpen={onOpenSchedules} />
          ) : scheduleSummary != null ? (
            <AgentSchedulesEmptyState agentName={agent.name} onOpen={onCreateSchedule} />
          ) : (
            <span className="text-text-secondary text-sm" aria-label={`Schedule count unavailable for ${agent.name}`}>
              —
            </span>
          )}
        </TableCell>
      ) : null}
      <TableCell className="w-px">
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            aria-label={`Try agent ${agent.name}`}
            className={auiButtonClass({
              variant: 'outline',
              size: 'sm',
            })}
            onClick={onTry}
          >
            <Icon name="play" className="size-3.5" />
            Try
          </button>
          {showEdit ? (
            <DropdownMenu
              align="end"
              trigger={
                <button
                  type="button"
                  className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                  aria-label={`Actions for ${agent.name}`}
                >
                  <Icon name="ellipsis" className="size-4" />
                </button>
              }
            >
              <DropdownMenuItem onClick={onEdit}>
                <Icon name="pencil" className="size-3.5" />
                Edit
              </DropdownMenuItem>
            </DropdownMenu>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function summarizeSchedulesByAgent(schedules: readonly Schedule[]): Map<string, AgentScheduleSummary> {
  const map = new Map<string, AgentScheduleSummary>();
  for (const schedule of schedules) {
    const id = schedule.agentId;
    const prev = map.get(id) ?? { count: 0, hasPaused: false };
    const next = {
      count: prev.count + 1,
      hasPaused: prev.hasPaused || schedule.status === 'paused',
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

  const canEdit = shell.isComposerEnabled === true;
  const agentsListEpoch = shell.agentsListEpoch;
  const showSchedulesColumn = scheduleServer != null;

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
    const url = new URL(window.location.href);
    writeSessionShareSearch(url.searchParams, {
      sessionId: null,
      agentId: null,
      tab: null,
      view: null,
      timeRange: null,
    });
    writeScheduleShareSearch(url.searchParams, {
      agent: agentId,
      status: null,
      q: null,
      isNew: isNew === true ? true : null,
    });
    window.history.replaceState(window.history.state, '', url);
    shell.setLibraryOpen(false);
    shell.setSchedulesOpen(true);
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
      agentId: libraryAgentId(agent),
      agentName: agent.name,
      agentSpec,
    });
  };

  if (!open) return null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-primary-bg">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="bot" className="text-text-primary size-4" />
          <h1 className="text-text-primary truncate text-md font-semibold">Agents</h1>
        </div>
        <div className="ml-auto w-56 shrink-0">
          <SearchInput query={query} setQuery={setQuery} placeholder="Search agents" />
          {isSearching ? (
            <p className="sr-only" role="status">
              Searching…
            </p>
          ) : null}
        </div>
      </header>

      <div className="bg-secondary-bg/40 flex min-h-0 flex-1 flex-col">
        <div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label="Agents">
          {isInitialLoading ? (
            <div className="flex flex-col gap-2 p-1" role="status" aria-label="Loading agents">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-11 w-full rounded-md" />
              ))}
            </div>
          ) : error ? (
            <p className="text-failure-bg px-3 py-8 text-center text-sm">{error}</p>
          ) : agents.length === 0 ? (
            <p className="text-text-secondary px-3 py-8 text-center text-sm">
              {query.trim()
                ? `No agents match "${query.trim()}".`
                : 'No agents yet. Build one in a chat, then save it as an agent.'}
            </p>
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Agent name</TableHead>
                      {showSchedulesColumn ? <TableHead className="w-[8rem]">Schedules</TableHead> : null}
                      <TableHead className="w-px">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agents.map(agent => {
                      const agentSpec = agent.agentSpec;
                      const agentId = agent.agentId;
                      const id = libraryAgentId(agent);
                      const showEdit = canEdit && agentSpec != null;
                      const summary = showSchedulesColumn
                        ? (scheduleByAgent?.get(id) ??
                          scheduleByAgent?.get(agent.name) ??
                          (scheduleByAgent == null ? null : { count: 0, hasPaused: false }))
                        : undefined;
                      return (
                        <SlottedAgentLibraryRow
                          key={id}
                          agent={agent}
                          showEdit={showEdit}
                          {...(summary !== undefined ? { scheduleSummary: summary } : {})}
                          {...(showSchedulesColumn
                            ? {
                                onOpenSchedules: () => openSchedulesForAgent({ agentId: id }),
                                onCreateSchedule: () => openSchedulesForAgent({ agentId: id, isNew: true }),
                              }
                            : {})}
                          {...(sessionsServer != null && agentId != null
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
                          onTry={() => handleTry(agent)}
                          onEdit={() => {
                            if (agentSpec != null) handleEdit(agent, agentSpec);
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
