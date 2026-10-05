'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useResourcePermissions } from '../hooks/useResourcePermissions.js';
import { useSessionShareSearch } from '../hooks/useSessionShareSearch.js';
import { Icon } from '../icons/Icon.js';
import { isSchedulesChromeEnabled, isSessionsChromeEnabled } from '../server/serverChrome.js';
import { useOptionalAgentSessionsServer, useOptionalScheduleServer } from '../server/ServerContext.js';
import { libraryAgentId, useShellMode } from '../server/ShellModeContext.js';
import type { AgentLibraryEntry, AgentSpec, Schedule } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { hasCreatedBySubject } from '../utils/createdBySubject.js';
import { readLibraryShareSearch, replaceLibraryShareSearch } from '../utils/libraryShareUrl.js';
import { replaceScheduleShareSearch } from '../utils/scheduleShareUrl.js';
import { AgentOverflowMenu } from './AgentOverflowMenu.js';
import { CreatedByCell } from './CreatedByCell.js';
import { EmptyScreen, EmptyScreenQueryHighlight } from './EmptyScreen.js';
import { cn } from './lib/cn.js';
import { isMobileNavDrawerOpen } from './lib/isMobileNavDrawerOpen.js';
import { mountName } from './lib/mountName.js';
import { useIsMobile } from './lib/useIsMobile.js';
import { useSearchAgentsList } from './lib/useSearchAgentsList.js';
import { PageHeader } from './PageHeader.js';
import { Button } from './primitives/Button.js';
import SearchInput from './primitives/SearchInput.js';
import { Skeleton } from './primitives/Skeleton.js';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableTokenPagination,
} from './primitives/Table.js';
import { Tooltip } from './primitives/Tooltip.js';

/** API max page size for agents list. */
const AGENTS_PAGE_SIZE_OPTIONS = [10, 25] as const;

export type AgentsLibraryProps = {
  onSelectAgent?: (agentName: string) => void;
  /** Leading chrome for the page header (e.g. mobile nav hamburger). */
  headerStart?: ReactNode;
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
  /** `card` is the mobile stacked layout; desktop keeps the table `row`. */
  variant?: 'row' | 'card';
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
  alwaysShowAdd = false,
}: {
  agentName: string;
  onOpen?: () => void;
  disabled: boolean;
  /** Touch has no hover — show the add button instead of the `-` placeholder. */
  alwaysShowAdd?: boolean;
}) {
  return (
    <>
      {alwaysShowAdd ? null : (
        <span aria-hidden className="text-text-secondary text-sm md:group-hover:hidden">
          -
        </span>
      )}
      <Button.Ghost
        type="button"
        size="small"
        disabled={disabled}
        aria-label={`Add schedule for ${agentName}`}
        className={alwaysShowAdd ? 'inline-flex' : 'hidden md:group-hover:inline-flex'}
        onClick={onOpen}
      >
        <Icon name="plus" className="size-3.5 shrink-0" />
        Schedule
      </Button.Ghost>
    </>
  );
}

function AgentNameContent({
  name,
  description,
  onOpen,
  descriptionMode = 'tooltip',
}: {
  name: string;
  description: string | null;
  onOpen?: () => void;
  descriptionMode?: 'tooltip' | 'clamp';
}) {
  const nameNode =
    onOpen == null ? (
      <span className="block truncate">{name}</span>
    ) : (
      <button
        type="button"
        className="block max-w-full cursor-pointer text-left"
        aria-label={`Open ${name}`}
        onClick={onOpen}
      >
        <span className="block truncate">{name}</span>
      </button>
    );

  if (description == null) {
    return <>{nameNode}</>;
  }

  if (descriptionMode === 'clamp') {
    return (
      <>
        {nameNode}
        <span className="text-text-secondary line-clamp-2 text-xs font-normal">{description}</span>
      </>
    );
  }

  return (
    <>
      {nameNode}
      <Tooltip
        content={description}
        className="max-w-sm whitespace-normal text-left"
        triggerClassName="block min-w-0 w-full max-w-full"
      >
        <span className="text-text-secondary block truncate text-xs font-normal">{description}</span>
      </Tooltip>
    </>
  );
}

function AgentConfigurationChips({
  agentName,
  modelLabel,
  modelTitle,
  skillsCount,
  skillsTitle,
  mcpCount,
  connectorsTitle,
  className,
}: {
  agentName: string;
  modelLabel: string | null;
  modelTitle: string;
  skillsCount: number;
  skillsTitle: string;
  mcpCount: number;
  connectorsTitle: string;
  className?: string;
}) {
  const hasConfiguration = modelLabel != null || skillsCount > 0 || mcpCount > 0;
  if (!hasConfiguration) {
    return (
      <span className="text-text-secondary text-sm" aria-label={`Configuration unavailable for ${agentName}`}>
        —
      </span>
    );
  }
  return (
    <div className={cn('text-text-secondary flex min-w-0 items-center gap-2', className)}>
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
  );
}

function AgentSchedulesContent({
  scheduleSummary,
  agentName,
  onOpenSchedules,
  onCreateSchedule,
  canUseAgent,
  alwaysShowAdd = false,
}: {
  scheduleSummary: AgentScheduleSummary | null | undefined;
  agentName: string;
  onOpenSchedules?: () => void;
  onCreateSchedule?: () => void;
  canUseAgent: boolean;
  alwaysShowAdd?: boolean;
}) {
  if (scheduleSummary === undefined) return null;
  if (scheduleSummary != null && scheduleSummary.count > 0) {
    return (
      <AgentSchedulesBadge
        summary={scheduleSummary}
        agentName={agentName}
        onOpen={onOpenSchedules}
        disabled={!canUseAgent}
      />
    );
  }
  if (scheduleSummary != null) {
    return (
      <AgentSchedulesEmptyState
        agentName={agentName}
        onOpen={onCreateSchedule}
        disabled={!canUseAgent}
        alwaysShowAdd={alwaysShowAdd}
      />
    );
  }
  return (
    <span className="text-text-secondary text-sm" aria-label={`Schedule count unavailable for ${agentName}`}>
      —
    </span>
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
  variant = 'row',
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
  const hasNoSchedules = scheduleSummary != null && scheduleSummary.count === 0;
  const storedDescription = agent.description?.trim() || null;
  // Create falls back to name when description is missing; don't echo it under the title.
  const description = storedDescription != null && storedDescription !== agent.name ? storedDescription : null;

  const overflowMenu = (
    <AgentOverflowMenu
      agentName={agent.name}
      {...(storedDescription != null ? { description: storedDescription } : {})}
      {...(spec != null ? { agentSpec: spec } : {})}
      canMutate={canMutate}
      canUse={canUseAgent}
      canManage={canManageAgent}
      canDelete={canDeleteAgent}
      canManageSchedules={canManageSchedules}
      onEdit={onEdit}
      {...(onManageSchedules != null ? { onManageSchedules } : {})}
    />
  );

  const tryButton = (
    <PermissionGuard allowed={canUseAgent}>
      <Button.Secondary type="button" aria-label={`Try agent ${agent.name}`} size="large" onClick={onTry}>
        <Icon name="play" className="size-3.5" />
        Try
      </Button.Secondary>
    </PermissionGuard>
  );

  const configurationChips = (
    <AgentConfigurationChips
      agentName={agent.name}
      modelLabel={modelLabel}
      modelTitle={modelTitle}
      skillsCount={skillsCount}
      skillsTitle={skillsTitle}
      mcpCount={mcpCount}
      connectorsTitle={connectorsTitle}
    />
  );

  if (variant === 'card') {
    return (
      <li className="flex flex-col gap-3 rounded-xl border border-border bg-card-bg p-3">
        <div className="flex items-start gap-2">
          <div className="text-text-primary min-w-0 flex-1 font-medium">
            <AgentNameContent
              name={agent.name}
              description={description}
              {...(onOpen != null ? { onOpen } : {})}
              descriptionMode="clamp"
            />
          </div>
          {overflowMenu}
        </div>
        <AgentConfigurationChips
          agentName={agent.name}
          modelLabel={modelLabel}
          modelTitle={modelTitle}
          skillsCount={skillsCount}
          skillsTitle={skillsTitle}
          mcpCount={mcpCount}
          connectorsTitle={connectorsTitle}
          className="flex-wrap"
        />
        {showCreatedBy ? <CreatedByCell subject={agent.createdBySubject} /> : null}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <AgentSchedulesContent
              scheduleSummary={scheduleSummary}
              agentName={agent.name}
              {...(onOpenSchedules != null ? { onOpenSchedules } : {})}
              {...(onCreateSchedule != null ? { onCreateSchedule } : {})}
              canUseAgent={canUseAgent}
              alwaysShowAdd
            />
          </div>
          {tryButton}
        </div>
      </li>
    );
  }

  return (
    <TableRow className={hasNoSchedules ? 'group' : undefined}>
      {/* Fixed width so truncate works; 24rem = 1.5× the prior min-w-64 name column. */}
      <TableCell className="text-text-primary w-96 max-w-96 font-medium">
        <AgentNameContent name={agent.name} description={description} {...(onOpen != null ? { onOpen } : {})} />
      </TableCell>
      <TableCell>{configurationChips}</TableCell>
      {showCreatedBy ? (
        <TableCell>
          <CreatedByCell subject={agent.createdBySubject} />
        </TableCell>
      ) : null}
      {scheduleSummary !== undefined ? (
        <TableCell>
          <AgentSchedulesContent
            scheduleSummary={scheduleSummary}
            agentName={agent.name}
            {...(onOpenSchedules != null ? { onOpenSchedules } : {})}
            {...(onCreateSchedule != null ? { onCreateSchedule } : {})}
            canUseAgent={canUseAgent}
          />
        </TableCell>
      ) : null}
      <TableCell className="w-px">
        <div className="flex items-center justify-end gap-1.5">
          {tryButton}
          {overflowMenu}
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

export function AgentsLibrary({ onSelectAgent, headerStart }: AgentsLibraryProps) {
  const shell = useShellMode();
  const isMobile = useIsMobile();
  const { updateShareSearch } = useSessionShareSearch();
  const sessionsServer = useOptionalAgentSessionsServer();
  const scheduleServer = useOptionalScheduleServer();
  const SlottedAgentLibraryRow = useSlot('AgentLibraryRow');
  const [query, setQuery] = useState(() => readLibraryShareSearch(window.location.search).agentName ?? '');
  const [scheduleByAgent, setScheduleByAgent] = useState<Map<string, AgentScheduleSummary> | null>(null);
  const skipNextLibraryShareSyncRef = useRef(false);
  const open = shell.libraryOpen;

  const canMutate = shell.isComposerEnabled === true;
  const agentsListEpoch = shell.agentsListEpoch;
  const showSchedulesColumn = isSchedulesChromeEnabled({ schedules: scheduleServer });
  const canOpenAgentDetails = isSessionsChromeEnabled({ sessions: sessionsServer });
  const canOpenAgentSchedules = showSchedulesColumn && canOpenAgentDetails;

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    // Re-seed when a stay-mounted library reopens; skip one sync so we don't wipe the URL.
    skipNextLibraryShareSyncRef.current = true;
    setQuery(readLibraryShareSearch(window.location.search).agentName ?? '');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (skipNextLibraryShareSyncRef.current) {
      skipNextLibraryShareSyncRef.current = false;
      return;
    }
    replaceLibraryShareSearch({
      agentName: query.trim().length === 0 ? null : query,
    });
  }, [open, query]);

  const closeLibrary = useCallback(() => {
    shell.setLibraryOpen(false);
    setQuery('');
  }, [shell]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Let the mobile nav drawer consume Escape when it is open on top.
      if (isMobileNavDrawerOpen()) return;
      event.stopImmediatePropagation();
      closeLibrary();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeLibrary, open]);

  const { agents, isInitialLoading, isSearching, error, pageSize, setPageSize, canPrev, canNext, goPrev, goNext } =
    useSearchAgentsList({
      enabled: open,
      query,
      refreshKey: agentsListEpoch,
      mode: 'paged',
      limit: DEFAULT_TABLE_PAGE_SIZE,
    });
  const hasPageNav = canPrev || canNext;
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

  const renderAgent = (agent: AgentLibraryEntry, variant: 'row' | 'card') => {
    const agentSpec = agent.agentSpec;
    const agentId = agent.agentId;
    const id = libraryAgentId(agent);
    const summary = showSchedulesColumn
      ? (scheduleByAgent?.get(id) ??
        scheduleByAgent?.get(agent.name) ??
        (scheduleByAgent == null ? null : { count: 0, pausedCount: 0, activeNames: [], pausedNames: [] }))
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
        variant={variant}
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
  };

  const pagination = (
    <TableTokenPagination
      pageSize={pageSize}
      rowCount={agents.length}
      canPrev={canPrev}
      canNext={canNext}
      onPrev={goPrev}
      onNext={goNext}
      pageSizeOptions={AGENTS_PAGE_SIZE_OPTIONS}
      onPageSizeChange={setPageSize}
    />
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-primary-bg">
      <PageHeader
        title="Agents"
        start={headerStart}
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
        <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-label="Agents">
          {isInitialLoading ? (
            <div className="flex flex-col gap-2 p-1" role="status" aria-label="Loading agents">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className={cn('w-full rounded-md', isMobile ? 'h-32' : 'h-11')} />
              ))}
            </div>
          ) : error ? (
            <p className="text-failure-bg px-3 py-8 text-center text-sm">{error}</p>
          ) : agents.length === 0 && !hasPageNav ? (
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
          ) : agents.length === 0 ? (
            <div className="flex min-h-full flex-col">
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
                className="flex-1"
              />
              <div className="overflow-hidden rounded-lg border border-border">
                <TableTokenPagination
                  pageSize={pageSize}
                  rowCount={0}
                  canPrev={canPrev}
                  canNext={canNext}
                  onPrev={goPrev}
                  onNext={goNext}
                  pageSizeOptions={AGENTS_PAGE_SIZE_OPTIONS}
                  onPageSizeChange={setPageSize}
                />
              </div>
            </div>
          ) : isMobile ? (
            <div className="flex flex-col gap-3">
              <ul aria-label="Agents" className="flex flex-col gap-3">
                {agents.map(agent => renderAgent(agent, 'card'))}
              </ul>
              <div className="overflow-hidden rounded-lg border border-border">{pagination}</div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-96 min-w-96">Agent name</TableHead>
                    <TableHead>Configuration</TableHead>
                    {showCreatedByColumn ? <TableHead>Created by</TableHead> : null}
                    {showSchedulesColumn ? <TableHead className="w-[14rem]">Schedules</TableHead> : null}
                    <TableHead className="w-px">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{agents.map(agent => renderAgent(agent, 'row'))}</TableBody>
              </Table>
              {pagination}
            </div>
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
