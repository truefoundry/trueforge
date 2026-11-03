'use client';

import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { useResourcePermissions } from '../../hooks/useResourcePermissions.js';
import { Icon } from '../../icons/Icon.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { isSessionsChromeEnabled } from '../../server/serverChrome.js';
import { useOptionalAgentSessionsServer, useScheduleServer, useServer } from '../../server/ServerContext.js';
import { libraryAgentId, useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { Schedule, ScheduleRun, ScheduleStatus } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { hasCreatedBySubject } from '../../utils/createdBySubject.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { readScheduleShareSearch, replaceScheduleShareSearch } from '../../utils/scheduleShareUrl.js';
import { replaceSessionShareSearch, sessionTimeRangeFromCreatedAt } from '../../utils/sessionShareUrl.js';
import { AgentSearchPicker } from '../AgentSearchPicker.js';
import { CreatedByCell } from '../CreatedByCell.js';
import { EmptyScreen } from '../EmptyScreen.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { PageHeader } from '../PageHeader.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../primitives/Dialog.js';
import { DropdownMenu, DropdownMenuItem } from '../primitives/DropdownMenu.js';
import { PopoverSelect } from '../primitives/PopoverSelect.js';
import SearchInput from '../primitives/SearchInput.js';
import { Skeleton } from '../primitives/Skeleton.js';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableTokenPagination,
} from '../primitives/Table.js';
import { Tooltip } from '../primitives/Tooltip.js';
import { formatCadenceSummary } from './cadence.js';
import { ScheduleFormDrawer } from './ScheduleFormDrawer.js';
import { ScheduleLastRunsCell } from './ScheduleLastRunsCell.js';
import { ScheduleStatusBadge } from './ScheduleStatusBadge.js';

type DrawerState = { kind: 'closed' } | { kind: 'create'; agentId?: string } | { kind: 'edit'; schedule: Schedule };

export type SchedulesPageProps = {
  /** Lock the page to one agent when embedded in Agent Details. */
  agentId?: string;
};

const STATUS_FILTER_OPTIONS: Array<{ value: 'all' | ScheduleStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
];

/** API max page size for schedules list. */
const SCHEDULES_PAGE_SIZE_OPTIONS = [10, 25] as const;
const EMPTY_SCHEDULES: Schedule[] = [];
const EMPTY_RUNS: ScheduleRun[] = [];

function clampPageSize(size: number): number {
  return Math.min(Math.max(size, 1), 25);
}

function nonEmptyToken(token: string | undefined): string | undefined {
  return token === undefined || token === '' ? undefined : token;
}

function filtersFromSearch(search: string): {
  nameQuery: string;
  statusFilter: 'all' | ScheduleStatus;
  agentFilter: string;
  scheduleId: string | null;
} {
  const share = readScheduleShareSearch(search);
  return {
    nameQuery: share.q ?? '',
    statusFilter: share.status ?? 'all',
    agentFilter: share.agent ?? 'all',
    scheduleId: share.scheduleId,
  };
}

function initialDrawerState(agentId?: string): DrawerState {
  const share = readScheduleShareSearch(window.location.search);
  if (!share.isNew) return { kind: 'closed' };
  const initialAgentId = agentId ?? share.agent;
  return {
    kind: 'create',
    ...(initialAgentId == null ? {} : { agentId: initialAgentId }),
  };
}

function ScheduleRowActions({
  schedule,
  running,
  canManage,
  canDelete,
  onRunNow,
  onEdit,
  onTogglePause,
  onDelete,
}: {
  schedule: Schedule;
  running: boolean;
  canManage: boolean;
  canDelete: boolean;
  onRunNow: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  const PermissionGuard = useSlot('PermissionGuard');
  return (
    <div className="inline-flex items-center justify-end gap-1.5">
      <PermissionGuard allowed={canManage}>
        <Button.Secondary
          type="button"
          disabled={running}
          aria-label={`Run now ${schedule.name}`}
          size="large"
          onClick={onRunNow}
        >
          <Icon name={running ? 'loader' : 'play'} className={cn('size-3.5', running && 'animate-spin')} />
          Run now
        </Button.Secondary>
      </PermissionGuard>
      <DropdownMenu
        align="end"
        trigger={
          <button
            type="button"
            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
            aria-label={`Actions for ${schedule.name}`}
          >
            <Icon name="ellipsis" />
          </button>
        }
      >
        <PermissionGuard allowed={canManage}>
          <DropdownMenuItem onClick={onEdit}>
            <Icon name="pencil" className="size-3.5" />
            Edit
          </DropdownMenuItem>
        </PermissionGuard>
        <PermissionGuard allowed={canManage}>
          <DropdownMenuItem onClick={onTogglePause}>
            <Icon name={schedule.status === 'active' ? 'pause' : 'play'} className="size-3.5" />
            {schedule.status === 'active' ? 'Pause' : 'Resume'}
          </DropdownMenuItem>
        </PermissionGuard>
        <PermissionGuard allowed={canDelete}>
          <DropdownMenuItem className="text-failure-bg focus:text-failure-bg" onClick={onDelete}>
            <Icon name="trash" className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </PermissionGuard>
      </DropdownMenu>
    </div>
  );
}

export function SchedulesPage({ agentId }: SchedulesPageProps) {
  const scheduleServer = useScheduleServer();
  const queryClient = useServerQueryClient();
  const invalidateScheduleQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all() });
  }, [queryClient]);
  const server = useServer();
  const toaster = useToasterOptional();
  const track = useTrackAnalytics();
  const shell = useOptionalShellMode();
  const sessionsServer = useOptionalAgentSessionsServer();
  const canOpenRunSession = shell != null && isSessionsChromeEnabled({ sessions: sessionsServer });

  const [runningScheduleIds, setRunningScheduleIds] = useState<ReadonlySet<string>>(() => new Set());
  /** Names learned from picker picks; no mount-time catalog drain. */
  const [agentLabelById, setAgentLabelById] = useState<Record<string, string>>({});
  const [nameQuery, setNameQuery] = useState(() => filtersFromSearch(window.location.search).nameQuery);
  const [statusFilter, setStatusFilter] = useState<'all' | ScheduleStatus>(
    () => filtersFromSearch(window.location.search).statusFilter,
  );
  const [agentFilter, setAgentFilter] = useState(
    () => agentId ?? filtersFromSearch(window.location.search).agentFilter,
  );
  const [scheduleId, setScheduleId] = useState<string | null>(
    () => filtersFromSearch(window.location.search).scheduleId,
  );
  // Specific agent (filter or embedded): gate Create on USE. Filter "all": enable and let the drawer enforce USE.
  const permissionAgentId = agentId ?? (agentFilter === 'all' ? null : agentFilter);
  const { allows: allowsAgent } = useResourcePermissions({
    resourceType: 'agent',
    resourceIds: permissionAgentId == null ? [] : [permissionAgentId],
  });
  const canCreateSchedule =
    server.permissions == null || permissionAgentId == null || allowsAgent(permissionAgentId, 'USE');
  const [drawer, setDrawer] = useState<DrawerState>(() => initialDrawerState(agentId));
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null);
  const [pageSize, setPageSize] = useState(() => clampPageSize(DEFAULT_TABLE_PAGE_SIZE));
  const pageScope = JSON.stringify([pageSize, agentFilter]);
  const [pageCursor, setPageCursor] = useState<{ scope: string; token: string | undefined }>(() => ({
    scope: pageScope,
    token: undefined,
  }));
  if (pageCursor.scope !== pageScope) {
    setPageCursor({ scope: pageScope, token: undefined });
  }
  const pageToken = pageCursor.scope === pageScope ? pageCursor.token : undefined;
  const didConsumeIsNewRef = useRef(false);

  const listParams = useMemo(
    () => ({
      limit: pageSize,
      ...(pageToken === undefined ? {} : { pageToken }),
      ...(agentFilter === 'all' ? {} : { agentIds: [agentFilter] }),
    }),
    [agentFilter, pageSize, pageToken],
  );
  const pinned = scheduleId != null;

  const detailQuery = useQuery(
    {
      queryKey: queryKeys.schedules.detail(scheduleId ?? ''),
      queryFn: () => {
        if (scheduleId == null) {
          return Promise.reject(new Error('Pinned schedule id is required.'));
        }
        return scheduleServer.getSchedule({ id: scheduleId });
      },
      enabled: pinned,
      placeholderData: keepPreviousData,
    },
    queryClient,
  );
  const listQuery = useQuery(
    {
      queryKey: queryKeys.schedules.list(listParams),
      queryFn: () => scheduleServer.listSchedules(listParams),
      enabled: !pinned,
      placeholderData: keepPreviousData,
    },
    queryClient,
  );

  const schedules = useMemo(() => {
    if (pinned) {
      return detailQuery.data != null ? [detailQuery.data] : EMPTY_SCHEDULES;
    }
    return listQuery.data?.data ?? EMPTY_SCHEDULES;
  }, [detailQuery.data, listQuery.data?.data, pinned]);
  const nextPageToken = pinned ? undefined : nonEmptyToken(listQuery.data?.nextPageToken);
  const previousPageToken = pinned ? undefined : nonEmptyToken(listQuery.data?.previousPageToken);
  const activeQuery = pinned ? detailQuery : listQuery;
  const loading = activeQuery.isPending || activeQuery.isPlaceholderData;
  const error =
    activeQuery.error != null && schedules.length === 0
      ? getErrorMessage(activeQuery.error, 'Check your connection and try again.')
      : null;
  const showSkeleton = loading && schedules.length === 0;

  const { allows } = useResourcePermissions({
    resourceType: 'schedule',
    resourceIds: schedules.map(schedule => schedule.id),
  });

  const scheduleIds = schedules.map(schedule => schedule.id);
  const runsQueries = useQueries(
    {
      queries: scheduleIds.map(id => ({
        queryKey: queryKeys.schedules.runs(id),
        queryFn: async (): Promise<ScheduleRun[]> => {
          try {
            return await scheduleServer.listScheduleRuns({ scheduleId: id });
          } catch {
            return EMPTY_RUNS;
          }
        },
        placeholderData: keepPreviousData,
      })),
    },
    queryClient,
  );
  const runsByScheduleId = useMemo(() => {
    const map = new Map<string, { runs: ScheduleRun[]; pending: boolean }>();
    for (let index = 0; index < scheduleIds.length; index += 1) {
      const id = scheduleIds[index];
      if (id === undefined) continue;
      const query = runsQueries[index];
      map.set(id, {
        runs: query?.data ?? EMPTY_RUNS,
        pending: query?.isPending === true && query.data === undefined,
      });
    }
    return map;
  }, [runsQueries, scheduleIds]);

  const resetToFirstPage = useCallback(() => {
    setScheduleId(null);
    setPageCursor({ scope: pageScope, token: undefined });
  }, [pageScope]);

  const handleOpenRunSession = ({ run, schedule }: { run: ScheduleRun; schedule: Schedule }) => {
    if (!canOpenRunSession || shell == null || run.sessionId == null) return;
    track(AnalyticsEvents.Schedule.RUN_SESSION_OPENED, { schedule_id: schedule.id, agent_id: schedule.agentId });
    const pinnedRange = sessionTimeRangeFromCreatedAt(run.triggeredAt ?? run.scheduledFor);
    replaceSessionShareSearch({
      sessionId: run.sessionId,
      view: 'sessions',
      ...(pinnedRange == null ? {} : { timeRange: pinnedRange }),
    });
    shell.setSessionsOpen(true);
  };

  // Keep filters in the URL so deep links and Agents → Schedules work.
  useEffect(() => {
    replaceScheduleShareSearch({
      agent: agentId === undefined && agentFilter !== 'all' ? agentFilter : null,
      status: statusFilter === 'all' ? null : statusFilter,
      q: nameQuery.trim().length === 0 ? null : nameQuery,
      scheduleId,
    });
  }, [agentFilter, agentId, statusFilter, nameQuery, scheduleId]);

  useEffect(() => {
    if (agentId === undefined) return;
    setAgentFilter(current => (current === agentId ? current : agentId));
  }, [agentId]);

  // One-shot: the initial state opens create synchronously; then strip the URL flag.
  useEffect(() => {
    if (didConsumeIsNewRef.current) return;
    const share = readScheduleShareSearch(window.location.search);
    if (!share.isNew) return;
    didConsumeIsNewRef.current = true;
    replaceScheduleShareSearch({ isNew: null });
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      const next = filtersFromSearch(window.location.search);
      setNameQuery(next.nameQuery);
      setStatusFilter(next.statusFilter);
      setScheduleId(current => (current === next.scheduleId ? current : next.scheduleId));
      setAgentFilter(current => {
        const nextAgentFilter = agentId ?? next.agentFilter;
        return current === nextAgentFilter ? current : nextAgentFilter;
      });
    };
    window.addEventListener('popstate', syncFromUrl);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
    };
  }, [agentId]);

  // A bare scheduleId link has no name in the URL. Fill the search once the row arrives.
  useEffect(() => {
    if (scheduleId == null || nameQuery.trim().length > 0) return;
    const pinnedSchedule = schedules.find(schedule => schedule.id === scheduleId);
    if (pinnedSchedule == null) return;
    setNameQuery(pinnedSchedule.name);
  }, [nameQuery, scheduleId, schedules]);

  // Name + status are client-side on the current server page only.
  // A pinned schedule is the whole table, so those filters do not hide it.
  const filtered = useMemo(() => {
    if (scheduleId != null) return schedules;
    const q = nameQuery.trim().toLowerCase();
    return schedules.filter(schedule => {
      if (statusFilter !== 'all' && schedule.status !== statusFilter) return false;
      if (q.length > 0 && !schedule.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [schedules, nameQuery, statusFilter, scheduleId]);

  // Key off page data, not client filters — filtering must not toggle the column.
  const showCreatedByColumn = hasCreatedBySubject(schedules);
  const hasPageNav = previousPageToken != null || nextPageToken != null;

  const handleTogglePause = async (schedule: Schedule) => {
    if (!allows(schedule.id, 'MANAGE')) return;
    const nextStatus: ScheduleStatus = schedule.status === 'active' ? 'paused' : 'active';
    try {
      await scheduleServer.updateSchedule({ ...schedule, status: nextStatus });
      invalidateScheduleQueries();
      track(AnalyticsEvents.Schedule.TOGGLED, {
        schedule_id: schedule.id,
        agent_id: schedule.agentId,
        next_status: nextStatus,
      });
    } catch (caught) {
      toaster?.showError(caught);
    }
  };

  const handleRunNow = async (schedule: Schedule) => {
    if (!allows(schedule.id, 'MANAGE')) return;
    setRunningScheduleIds(prev => new Set(prev).add(schedule.id));
    try {
      await scheduleServer.createScheduleRun({ scheduleId: schedule.id });
      track(AnalyticsEvents.Schedule.RUN_NOW, { schedule_id: schedule.id, agent_id: schedule.agentId });
      toaster?.showSuccess({ title: 'Run started' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedules.runs(schedule.id) });
      if (scheduleId != null) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.schedules.detail(scheduleId) });
      }
    } catch (caught) {
      toaster?.showError(caught);
    } finally {
      setRunningScheduleIds(prev => {
        const next = new Set(prev);
        next.delete(schedule.id);
        return next;
      });
    }
  };

  const handleDelete = async (schedule: Schedule) => {
    if (!allows(schedule.id, 'DELETE')) return;
    setPendingDelete(null);
    try {
      await scheduleServer.deleteSchedule({ id: schedule.id });
      invalidateScheduleQueries();
      track(AnalyticsEvents.Schedule.DELETED, { schedule_id: schedule.id, agent_id: schedule.agentId });
      resetToFirstPage();
    } catch (caught) {
      toaster?.showError(caught);
    }
  };

  const goNext = () => {
    if (nextPageToken == null) return;
    setPageCursor({ scope: pageScope, token: nextPageToken });
  };

  const goPrev = () => {
    if (previousPageToken == null) return;
    setPageCursor({ scope: pageScope, token: previousPageToken });
  };

  const releaseSchedulePin = () => {
    if (scheduleId == null) return;
    setScheduleId(null);
    setPageCursor({ scope: pageScope, token: undefined });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg">
      <PageHeader
        title={agentId === undefined ? 'Agent Schedules' : undefined}
        end={
          <>
            <div className="w-full sm:w-60">
              <SearchInput
                query={nameQuery}
                setQuery={next => {
                  setNameQuery(next);
                  releaseSchedulePin();
                }}
                placeholder="Search schedules by name"
              />
            </div>
            <PopoverSelect
              value={statusFilter}
              onValueChange={next => {
                setStatusFilter(next);
                releaseSchedulePin();
              }}
              options={STATUS_FILTER_OPTIONS}
              className="sm:w-40"
              aria-label="Filter by status"
            />
            {agentId === undefined ? (
              <AgentSearchPicker
                value={agentFilter}
                selectedLabel={agentFilter === 'all' ? 'All agents' : (agentLabelById[agentFilter] ?? agentFilter)}
                onValueChange={value => {
                  setAgentFilter(value);
                  releaseSchedulePin();
                }}
                onAgentPicked={agent => {
                  setAgentLabelById(current => ({
                    ...current,
                    [libraryAgentId(agent)]: agent.name,
                  }));
                }}
                allOption={{ value: 'all', label: 'All agents' }}
                className="sm:w-48"
                aria-label="Filter by agent"
                placeholder="Search agent"
              />
            ) : null}
            <Button.Primary
              type="button"
              disabled={!canCreateSchedule}
              onClick={() =>
                canCreateSchedule &&
                setDrawer({
                  kind: 'create',
                  agentId: agentFilter !== 'all' ? agentFilter : undefined,
                })
              }
            >
              <Icon name="plus" className="size-3.5" />
              New Schedule
            </Button.Primary>
          </>
        }
      />

      <div className={cn('min-h-0 flex-1 overflow-auto px-4 py-4', error != null ? 'flex flex-col' : undefined)}>
        {showSkeleton ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading schedules">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : error != null ? (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center">
            <EmptyScreen
              title="Couldn't load schedules"
              description={error}
              className="h-auto min-h-0 flex-none py-0"
            />
          </div>
        ) : schedules.length === 0 ? (
          <EmptyScreen title="No Schedules Found" description="Create one to get started." className="min-h-full" />
        ) : filtered.length === 0 ? (
          <div className="flex min-h-full flex-col">
            <EmptyScreen title="No Schedules Found" description="No schedules match your filters." className="flex-1" />
            {hasPageNav ? (
              <TableTokenPagination
                pageSize={pageSize}
                rowCount={0}
                canPrev={previousPageToken != null}
                canNext={nextPageToken != null}
                onPrev={goPrev}
                onNext={goNext}
                pageSizeOptions={SCHEDULES_PAGE_SIZE_OPTIONS}
                onPageSizeChange={size => {
                  setPageSize(clampPageSize(size));
                }}
              />
            ) : null}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table className="min-w-240">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Schedule Name</TableHead>
                  <TableHead>Task</TableHead>
                  {showCreatedByColumn ? <TableHead>Created by</TableHead> : null}
                  <TableHead>Frequency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last 5 runs</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(schedule => {
                  const cadence = formatCadenceSummary({ cron: schedule.cron, timezone: schedule.timezone });
                  const agentLabel = schedule.agentName ?? agentLabelById[schedule.agentId] ?? schedule.agentId;
                  const runsState = runsByScheduleId.get(schedule.id);
                  return (
                    <TableRow key={schedule.id}>
                      <TableCell className="w-48 max-w-48">
                        <span className="text-text-primary block truncate font-medium">{schedule.name}</span>
                        <span className="mt-1 flex min-w-0 items-center gap-1 text-xs">
                          <Icon name="agent-2" className="size-3 shrink-0" />
                          <span className="truncate">{agentLabel}</span>
                        </span>
                      </TableCell>
                      <TableCell className="w-64 max-w-64">
                        <Tooltip
                          content={schedule.task}
                          className="max-w-sm whitespace-normal text-left"
                          triggerClassName="block min-w-0 w-full max-w-full"
                        >
                          <span className="block truncate">{schedule.task}</span>
                        </Tooltip>
                      </TableCell>
                      {showCreatedByColumn ? (
                        <TableCell>
                          <CreatedByCell subject={schedule.createdBySubject} />
                        </TableCell>
                      ) : null}
                      <TableCell>{cadence}</TableCell>
                      <TableCell>
                        <ScheduleStatusBadge status={schedule.status} />
                      </TableCell>
                      <TableCell>
                        {runsState?.pending === true ? (
                          <span className="text-text-secondary text-sm">…</span>
                        ) : (
                          <ScheduleLastRunsCell
                            runs={runsState?.runs ?? EMPTY_RUNS}
                            {...(!canOpenRunSession
                              ? {}
                              : { onOpenSession: run => handleOpenRunSession({ run, schedule }) })}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <ScheduleRowActions
                          schedule={schedule}
                          running={runningScheduleIds.has(schedule.id)}
                          canManage={allows(schedule.id, 'MANAGE')}
                          canDelete={allows(schedule.id, 'DELETE')}
                          onRunNow={() => void handleRunNow(schedule)}
                          onEdit={() => {
                            if (allows(schedule.id, 'MANAGE')) setDrawer({ kind: 'edit', schedule });
                          }}
                          onTogglePause={() => void handleTogglePause(schedule)}
                          onDelete={() => {
                            if (allows(schedule.id, 'DELETE')) setPendingDelete(schedule);
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {(filtered.length > 0 || hasPageNav) && (
              <TableTokenPagination
                pageSize={pageSize}
                rowCount={filtered.length}
                canPrev={previousPageToken != null}
                canNext={nextPageToken != null}
                onPrev={goPrev}
                onNext={goNext}
                pageSizeOptions={SCHEDULES_PAGE_SIZE_OPTIONS}
                onPageSizeChange={size => {
                  setPageSize(clampPageSize(size));
                }}
              />
            )}
          </div>
        )}
      </div>

      {drawer.kind === 'create' ? (
        <ScheduleFormDrawer
          open
          mode="create"
          initialAgentId={drawer.agentId ?? ''}
          onOpenChange={open => {
            if (!open) setDrawer({ kind: 'closed' });
          }}
          onSaved={() => {
            invalidateScheduleQueries();
            resetToFirstPage();
          }}
        />
      ) : null}
      {drawer.kind === 'edit' ? (
        <ScheduleFormDrawer
          open
          mode="edit"
          schedule={drawer.schedule}
          onOpenChange={open => {
            if (!open) setDrawer({ kind: 'closed' });
          }}
          onSaved={() => {
            invalidateScheduleQueries();
          }}
        />
      ) : null}
      {pendingDelete != null ? (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setPendingDelete(null);
          }}
          aria-label="Delete schedule"
          className="max-w-md"
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete schedule</DialogTitle>
              <p className="text-text-secondary text-sm">
                “{pendingDelete.name}” will stop running. This cannot be undone.
              </p>
            </DialogHeader>
          </DialogContent>
          <DialogFooter>
            <Button.Secondary type="button" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button.Secondary>
            <Button.Destructive
              type="button"
              disabled={!allows(pendingDelete.id, 'DELETE')}
              onClick={() => void handleDelete(pendingDelete)}
            >
              Delete
            </Button.Destructive>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    SchedulesPage: ComponentType<SchedulesPageProps>;
  }
}
