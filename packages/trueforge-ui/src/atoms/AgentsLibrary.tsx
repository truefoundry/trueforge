'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';

import { useResourcePermissions } from '../hooks/useResourcePermissions.js';
import { useSessionShareSearch } from '../hooks/useSessionShareSearch.js';
import { Icon } from '../icons/Icon.js';
import { isSchedulesChromeEnabled, isSessionsChromeEnabled } from '../server/serverChrome.js';
import { useOptionalAgentSessionsServer, useOptionalScheduleServer } from '../server/ServerContext.js';
import { libraryAgentId, useShellMode } from '../server/ShellModeContext.js';
import type { AgentLibraryEntry, AgentSpec, CreatedBySubject, Schedule } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { readLibraryShareSearch, replaceLibraryShareSearch } from '../utils/libraryShareUrl.js';
import { replaceScheduleShareSearch } from '../utils/scheduleShareUrl.js';
import {
  AgentLastRunCell,
  AgentLibrarySparklineCell,
  AgentSessionsCell,
  AgentSpendCell,
  agentLibraryUsageLabels,
} from './AgentLibraryUsage.js';
import { AgentOverflowMenu } from './AgentOverflowMenu.js';
import { CreatedByCell } from './CreatedByCell.js';
import { EmptyScreen, EmptyScreenQueryHighlight } from './EmptyScreen.js';
import { cn } from './lib/cn.js';
import { isMobileNavDrawerOpen } from './lib/isMobileNavDrawerOpen.js';
import { mountName } from './lib/mountName.js';
import { useAgentLibraryUsageStats, type AgentLibraryUsageStats } from './lib/useAgentLibraryUsageStats.js';
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
  scheduleSummary?: AgentScheduleSummary | null;
  usage?: AgentLibraryUsageStats;
  showMetricsColumns?: boolean;
  showLastRunColumn?: boolean;
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

/** Sectioned list tooltip for MCP / skill mounts (one name per line). */
function mountNamesTooltip({ title, names }: { title: string; names: readonly string[] }) {
  return (
    <span className="flex max-w-xs flex-col gap-1.5 text-left">
      <span className="text-[0.625rem] font-medium tracking-wide text-text-secondary uppercase">{title}</span>
      <span className="flex flex-col gap-0.5">
        {names.map(name => (
          <span key={name} className="break-all">
            {name}
          </span>
        ))}
      </span>
    </span>
  );
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
  createdBySubject,
  onOpen,
}: {
  name: string;
  description: string | null;
  createdBySubject?: CreatedBySubject;
  onOpen?: () => void;
}) {
  const nameNode =
    onOpen == null ? (
      <span className="text-text-primary block truncate font-medium">{name}</span>
    ) : (
      <button
        type="button"
        className="block max-w-full cursor-pointer text-left"
        aria-label={`Open ${name}`}
        onClick={onOpen}
      >
        <span className="text-text-primary block truncate font-medium">{name}</span>
      </button>
    );

  const titledName =
    description == null ? (
      nameNode
    ) : (
      <Tooltip
        content={description}
        className="max-w-sm whitespace-normal text-left"
        triggerClassName="block min-w-0 w-full max-w-full"
      >
        {nameNode}
      </Tooltip>
    );

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {titledName}
      {createdBySubject != null ? <CreatedByCell subject={createdBySubject} /> : null}
    </div>
  );
}

function AgentConfigurationSummary({
  agentName,
  modelLabel,
  modelTitle,
  skillNames,
  mcpNames,
  className,
}: {
  agentName: string;
  modelLabel: string | null;
  modelTitle: string;
  skillNames: readonly string[];
  mcpNames: readonly string[];
  className?: string;
}) {
  const skillsCount = skillNames.length;
  const mcpCount = mcpNames.length;
  const hasConfiguration = modelLabel != null || skillsCount > 0 || mcpCount > 0;
  if (!hasConfiguration) {
    return (
      <span className="text-text-secondary text-sm" aria-label={`Configuration unavailable for ${agentName}`}>
        —
      </span>
    );
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      {modelLabel != null ? (
        <Tooltip content={modelTitle}>
          <span className="truncate text-sm font-medium text-text-primary" aria-label={modelTitle}>
            {modelLabel}
          </span>
        </Tooltip>
      ) : (
        <span className="text-text-secondary text-sm">—</span>
      )}
      {mcpCount === 0 && skillsCount === 0 ? (
        <span className="text-text-secondary text-xs">no tools</span>
      ) : (
        <span className="text-text-secondary inline-flex min-w-0 flex-wrap items-center gap-x-1 text-xs">
          {mcpCount > 0 ? (
            <Tooltip
              content={mountNamesTooltip({ title: 'MCP', names: mcpNames })}
              className="max-w-xs whitespace-normal"
            >
              <span className="cursor-default" aria-label={`MCP: ${mcpNames.join(', ')}`}>
                {mcpCount} MCP
              </span>
            </Tooltip>
          ) : null}
          {mcpCount > 0 && skillsCount > 0 ? <span aria-hidden>•</span> : null}
          {skillsCount > 0 ? (
            <Tooltip
              content={mountNamesTooltip({
                title: skillsCount === 1 ? 'Skill' : 'Skills',
                names: skillNames,
              })}
              className="max-w-xs whitespace-normal"
            >
              <span className="cursor-default" aria-label={`Skills: ${skillNames.join(', ')}`}>
                {skillsCount} skill{skillsCount === 1 ? '' : 's'}
              </span>
            </Tooltip>
          ) : null}
        </span>
      )}
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
  scheduleSummary,
  usage,
  showMetricsColumns = false,
  showLastRunColumn = false,
  onOpenSchedules,
  onCreateSchedule,
  onOpen,
  onTry,
  onEdit,
  onManageSchedules,
  variant = 'row',
}: AgentLibraryRowProps) {
  const PermissionGuard = useSlot('PermissionGuard');
  const SlottedUsageCells = useSlot('AgentLibraryUsageCells');
  const spec = agent.agentSpec;
  const modelName = spec?.model.name;
  const skillNames = (spec?.skills ?? []).map(mountName).filter((name: string | null): name is string => name != null);
  const mcpNames = (spec?.mcpServers ?? [])
    .map(mountName)
    .filter((name: string | null): name is string => name != null);
  const modelLabel = modelName != null ? displayModelLabel(modelName) : null;
  const modelTitle = modelName ?? '';
  const hasNoSchedules = scheduleSummary != null && scheduleSummary.count === 0;
  const storedDescription = agent.description?.trim() || null;
  // Create falls back to name when description is missing; don't echo it under the title.
  const description = storedDescription != null && storedDescription !== agent.name ? storedDescription : null;
  const usageLoading = (showMetricsColumns || showLastRunColumn) && usage == null;
  const usageCells = (
    <SlottedUsageCells
      loading={usageLoading}
      agentName={agent.name}
      showMetrics={showMetricsColumns}
      showLastRun={showLastRunColumn}
      {...(usage !== undefined ? { usage } : {})}
    />
  );

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

  const configurationSummary = (
    <AgentConfigurationSummary
      agentName={agent.name}
      modelLabel={modelLabel}
      modelTitle={modelTitle}
      skillNames={skillNames}
      mcpNames={mcpNames}
    />
  );

  const nameContent = (
    <AgentNameContent
      name={agent.name}
      description={description}
      {...(agent.createdBySubject != null ? { createdBySubject: agent.createdBySubject } : {})}
      {...(onOpen != null ? { onOpen } : {})}
    />
  );

  if (variant === 'card') {
    return (
      <li className="flex flex-col gap-3 rounded-xl border border-border bg-card-bg p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">{nameContent}</div>
          {overflowMenu}
        </div>
        {configurationSummary}
        {usageCells}
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
      <TableCell className="w-72 max-w-72">{nameContent}</TableCell>
      <TableCell>{configurationSummary}</TableCell>
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
      {showMetricsColumns ? (
        <>
          <TableCell>
            <AgentSessionsCell usage={usage} loading={usageLoading} agentName={agent.name} />
          </TableCell>
          <TableCell>
            <AgentSpendCell usage={usage} loading={usageLoading} agentName={agent.name} />
          </TableCell>
          <TableCell className="w-28">
            <AgentLibrarySparklineCell points={usage?.dailyPoints} loading={usageLoading} agentName={agent.name} />
          </TableCell>
        </>
      ) : null}
      <TableCell className="w-px">
        <div className="flex items-center justify-end gap-3">
          {showLastRunColumn ? <AgentLastRunCell usage={usage} loading={usageLoading} agentName={agent.name} /> : null}
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
  const track = useTrackAnalytics();
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
    track(AnalyticsEvents.Library.CLOSED);
    shell.setLibraryOpen(false);
    setQuery('');
  }, [shell, track]);

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
  const permissionAgentIds = open ? agents.map(libraryAgentId) : [];
  const { allows } = useResourcePermissions({
    resourceType: 'agent',
    resourceIds: permissionAgentIds,
  });

  const {
    usageByAgentId,
    metricsEnabled: showMetricsColumns,
    lastRunEnabled: showLastRunColumn,
  } = useAgentLibraryUsageStats({
    agentIds: permissionAgentIds,
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
    track(AnalyticsEvents.Library.AGENT_SCHEDULES_OPENED, { agent_id: agentId });
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
    track(AnalyticsEvents.Library.AGENT_TRIED, { agent_id: libraryAgentId(agent), agent_name: agent.name });
    onSelectAgent?.(agent.name);
    shell.selectLibraryAgent({
      isMutable: false,
      agentId: libraryAgentId(agent),
      agentName: agent.name,
    });
  };

  const handleEdit = (agent: AgentLibraryEntry, agentSpec: AgentSpec) => {
    track(AnalyticsEvents.Library.AGENT_EDITED, { agent_id: libraryAgentId(agent), agent_name: agent.name });
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
    const usage = usageByAgentId.get(id);
    return (
      <SlottedAgentLibraryRow
        key={id}
        agent={agent}
        canMutate={canMutate}
        canUseAgent={allows(id, 'USE')}
        canManageAgent={allows(id, 'MANAGE')}
        canDeleteAgent={allows(id, 'DELETE')}
        canManageSchedules={canOpenAgentSchedules}
        showMetricsColumns={showMetricsColumns}
        showLastRunColumn={showLastRunColumn}
        variant={variant}
        {...(usage !== undefined ? { usage } : {})}
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
                track(AnalyticsEvents.Library.AGENT_DETAILS_OPENED, {
                  agent_id: agentId,
                  agent_name: agent.name,
                });
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
        <div
          className={cn('min-h-0 flex-1 overflow-y-auto p-4', error ? 'flex flex-col' : undefined)}
          aria-label="Agents"
        >
          {isInitialLoading ? (
            <div className="flex flex-col gap-2 p-1" role="status" aria-label="Loading agents">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className={cn('w-full rounded-md', isMobile ? 'h-32' : 'h-14')} />
              ))}
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-1 flex-col items-center justify-center">
              <EmptyScreen title="Couldn't load agents" description={error} className="h-auto min-h-0 flex-none py-0" />
            </div>
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
                    <TableHead className="w-72 min-w-72">Agent</TableHead>
                    <TableHead>Configuration</TableHead>
                    {showSchedulesColumn ? <TableHead className="w-[14rem]">Schedules</TableHead> : null}
                    {showMetricsColumns ? (
                      <>
                        <TableHead>{agentLibraryUsageLabels.sessions}</TableHead>
                        <TableHead>{agentLibraryUsageLabels.spend}</TableHead>
                        <TableHead className="w-28">{agentLibraryUsageLabels.daily}</TableHead>
                      </>
                    ) : null}
                    <TableHead className="w-px">
                      <span className={showLastRunColumn ? undefined : 'sr-only'}>
                        {showLastRunColumn ? 'Last run' : 'Actions'}
                      </span>
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
