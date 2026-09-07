'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { Icon } from '../../icons/Icon.js';
import { useScheduleServer, useServer } from '../../server/ServerContext.js';
import { libraryAgentId } from '../../server/ShellModeContext.js';
import type { Schedule, ScheduleRun, ScheduleStatus } from '../../server/types.js';
import { readScheduleShareSearch, replaceScheduleShareSearch } from '../../utils/scheduleShareUrl.js';
import { EmptyScreen } from '../EmptyScreen.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { searchAllAgents } from '../lib/useSearchAgentsList.js';
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
import { formatCadenceSummary } from './cadence.js';
import { ScheduleFormDrawer } from './ScheduleFormDrawer.js';
import { ScheduleLastRunsCell } from './ScheduleLastRunsCell.js';
import { ScheduleStatusBadge } from './ScheduleStatusBadge.js';

type AgentOption = { agentId: string; name: string };

type DrawerState = { kind: 'closed' } | { kind: 'create'; agentId?: string } | { kind: 'edit'; schedule: Schedule };

const STATUS_FILTER_OPTIONS: Array<{ value: 'all' | ScheduleStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
];

/** API max page size for schedules list. */
const SCHEDULES_PAGE_SIZE_OPTIONS = [10, 25] as const;

function clampPageSize(size: number): number {
  return Math.min(Math.max(size, 1), 25);
}

function filtersFromSearch(search: string): {
  nameQuery: string;
  statusFilter: 'all' | ScheduleStatus;
  agentFilter: string;
} {
  const share = readScheduleShareSearch(search);
  return {
    nameQuery: share.q ?? '',
    statusFilter: share.status ?? 'all',
    agentFilter: share.agent ?? 'all',
  };
}

function ScheduleRowActions({
  schedule,
  running,
  onRunNow,
  onEdit,
  onTogglePause,
  onDelete,
}: {
  schedule: Schedule;
  running: boolean;
  onRunNow: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="inline-flex items-center justify-end gap-1.5">
      <button
        type="button"
        disabled={running}
        aria-label={`Run now ${schedule.name}`}
        className={auiButtonClass({ variant: 'outline', size: 'sm' })}
        onClick={onRunNow}
      >
        <Icon name={running ? 'loader' : 'play'} className={cn('size-3.5', running && 'animate-spin')} />
        Run now
      </button>
      <DropdownMenu
        align="end"
        trigger={
          <button
            type="button"
            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
            aria-label={`Actions for ${schedule.name}`}
          >
            <Icon name="ellipsis" className="size-4" />
          </button>
        }
      >
        <DropdownMenuItem onClick={onEdit}>
          <Icon name="pencil" className="size-3.5" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onTogglePause}>
          <Icon name={schedule.status === 'active' ? 'pause' : 'play'} className="size-3.5" />
          {schedule.status === 'active' ? 'Pause' : 'Resume'}
        </DropdownMenuItem>
        <DropdownMenuItem className="text-failure-bg focus:text-failure-bg" onClick={onDelete}>
          <Icon name="trash" className="size-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}

export function SchedulesPage() {
  const scheduleServer = useScheduleServer();
  const server = useServer();
  const toaster = useToasterOptional();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runsByScheduleId, setRunsByScheduleId] = useState<Record<string, ScheduleRun[]>>({});
  const [runsLoading, setRunsLoading] = useState(false);
  const [runningScheduleIds, setRunningScheduleIds] = useState<ReadonlySet<string>>(() => new Set());
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameQuery, setNameQuery] = useState(() => filtersFromSearch(window.location.search).nameQuery);
  const [statusFilter, setStatusFilter] = useState<'all' | ScheduleStatus>(
    () => filtersFromSearch(window.location.search).statusFilter,
  );
  const [agentFilter, setAgentFilter] = useState(() => filtersFromSearch(window.location.search).agentFilter);
  const [drawer, setDrawer] = useState<DrawerState>({ kind: 'closed' });
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null);
  const [pageSize, setPageSize] = useState(() => clampPageSize(DEFAULT_TABLE_PAGE_SIZE));
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [prevTokenStack, setPrevTokenStack] = useState<string[]>([]);
  const loadGenRef = useRef(0);
  const didConsumeIsNewRef = useRef(false);

  const loadRunsForSchedules = useCallback(
    async ({ rows, gen }: { rows: Schedule[]; gen: number }) => {
      if (rows.length === 0) {
        if (gen === loadGenRef.current) setRunsByScheduleId({});
        return;
      }
      setRunsLoading(true);
      try {
        const results = await Promise.allSettled(
          rows.map(schedule => scheduleServer.listScheduleRuns({ scheduleId: schedule.id })),
        );
        if (gen !== loadGenRef.current) return;
        setRunsByScheduleId(
          Object.fromEntries(
            rows.map((schedule, index) => {
              const result = results[index];
              const runs = result?.status === 'fulfilled' ? result.value : [];
              return [schedule.id, runs] as const;
            }),
          ),
        );
      } finally {
        if (gen === loadGenRef.current) setRunsLoading(false);
      }
    },
    [scheduleServer],
  );

  const loadSchedules = useCallback(
    async ({ token, size, agentId }: { token: string | undefined; size: number; agentId: string }) => {
      const gen = ++loadGenRef.current;
      setLoading(true);
      setError(null);
      try {
        const page = await scheduleServer.listSchedules({
          limit: clampPageSize(size),
          ...(token === undefined || token === '' ? {} : { pageToken: token }),
          ...(agentId === 'all' ? {} : { agentIds: [agentId] }),
        });
        if (gen !== loadGenRef.current) return;
        setSchedules(page.data);
        setNextPageToken(page.nextPageToken);
        void loadRunsForSchedules({ rows: page.data, gen });
      } catch (caught) {
        if (gen !== loadGenRef.current) return;
        const message = caught instanceof Error ? caught.message : 'Failed to load schedules';
        setError(message);
        setSchedules([]);
        setRunsByScheduleId({});
        setNextPageToken(undefined);
      } finally {
        if (gen === loadGenRef.current) setLoading(false);
      }
    },
    [scheduleServer, loadRunsForSchedules],
  );

  const resetToFirstPage = useCallback(
    (next?: { size?: number; agentId?: string }) => {
      const size = next?.size ?? pageSize;
      const agentId = next?.agentId ?? agentFilter;
      setPageToken(undefined);
      setPrevTokenStack([]);
      void loadSchedules({ token: undefined, size, agentId });
    },
    [agentFilter, loadSchedules, pageSize],
  );

  // Keep filters in the URL so deep links and Agents → Schedules work.
  useEffect(() => {
    replaceScheduleShareSearch({
      agent: agentFilter === 'all' ? null : agentFilter,
      status: statusFilter === 'all' ? null : statusFilter,
      q: nameQuery.trim().length === 0 ? null : nameQuery,
    });
  }, [agentFilter, statusFilter, nameQuery]);

  // One-shot: Agents "+ Schedule" lands with isNew=true; open create then strip the flag.
  useEffect(() => {
    if (didConsumeIsNewRef.current) return;
    const share = readScheduleShareSearch(window.location.search);
    if (!share.isNew) return;
    didConsumeIsNewRef.current = true;
    setDrawer({
      kind: 'create',
      ...(share.agent != null ? { agentId: share.agent } : {}),
    });
    replaceScheduleShareSearch({ isNew: null });
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      const next = filtersFromSearch(window.location.search);
      setNameQuery(next.nameQuery);
      setStatusFilter(next.statusFilter);
      setAgentFilter(current => {
        if (current === next.agentFilter) return current;
        setPageToken(undefined);
        setPrevTokenStack([]);
        return next.agentFilter;
      });
    };
    window.addEventListener('popstate', syncFromUrl);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
    };
  }, []);

  useEffect(() => {
    void loadSchedules({ token: pageToken, size: pageSize, agentId: agentFilter });
  }, [agentFilter, pageSize, pageToken, loadSchedules]);

  useEffect(() => {
    let cancelled = false;
    void searchAllAgents(server)
      .then(rows => {
        if (cancelled) return;
        setAgentOptions(rows.map(agent => ({ agentId: libraryAgentId(agent), name: agent.name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [server]);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentOptions) {
      map.set(agent.agentId, agent.name);
    }
    return map;
  }, [agentOptions]);

  // Name + status are client-side on the current server page only.
  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    return schedules.filter(schedule => {
      if (statusFilter !== 'all' && schedule.status !== statusFilter) return false;
      if (q.length > 0 && !schedule.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [schedules, nameQuery, statusFilter]);

  const hasPageNav = prevTokenStack.length > 0 || nextPageToken != null;

  const handleTogglePause = async (schedule: Schedule) => {
    const nextStatus: ScheduleStatus = schedule.status === 'active' ? 'paused' : 'active';
    try {
      await scheduleServer.updateSchedule({ ...schedule, status: nextStatus });
      await loadSchedules({ token: pageToken, size: pageSize, agentId: agentFilter });
    } catch (caught) {
      toaster?.showError(caught);
    }
  };

  const handleRunNow = async (schedule: Schedule) => {
    setRunningScheduleIds(prev => new Set(prev).add(schedule.id));
    try {
      await scheduleServer.createScheduleRun({ scheduleId: schedule.id });
      toaster?.showSuccess({ title: 'Run started' });
      const runs = await scheduleServer.listScheduleRuns({ scheduleId: schedule.id });
      setRunsByScheduleId(prev => ({ ...prev, [schedule.id]: runs }));
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
    setPendingDelete(null);
    try {
      await scheduleServer.deleteSchedule({ id: schedule.id });
      resetToFirstPage();
    } catch (caught) {
      toaster?.showError(caught);
    }
  };

  const goNext = () => {
    if (nextPageToken == null) return;
    setPrevTokenStack(stack => [...stack, pageToken ?? '']);
    setPageToken(nextPageToken);
  };

  const goPrev = () => {
    if (prevTokenStack.length === 0) return;
    const stack = [...prevTokenStack];
    const prev = stack.pop();
    setPrevTokenStack(stack);
    setPageToken(prev === '' ? undefined : prev);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg">
      <PageHeader
        title="Scheduled Agents"
        end={
          <>
            <div className="w-full sm:w-56">
              <SearchInput query={nameQuery} setQuery={setNameQuery} placeholder="Search schedules by name" />
            </div>
            <PopoverSelect
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={STATUS_FILTER_OPTIONS}
              className="sm:w-40"
              aria-label="Filter by status"
            />
            <PopoverSelect
              value={agentFilter}
              onValueChange={value => {
                setAgentFilter(value);
                setPageToken(undefined);
                setPrevTokenStack([]);
              }}
              options={[
                { value: 'all', label: 'All agents' },
                ...agentOptions.map(agent => ({ value: agent.agentId, label: agent.name })),
              ]}
              className="sm:w-40"
              aria-label="Filter by agent"
            />
            <Button
              type="button"
              onClick={() =>
                setDrawer({
                  kind: 'create',
                  agentId: agentFilter !== 'all' ? agentFilter : undefined,
                })
              }
            >
              <Icon name="plus" className="size-3.5" />
              Create Schedule
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {loading ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading schedules">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : error != null ? (
          <p className="text-failure-bg px-3 py-8 text-center text-sm">{error}</p>
        ) : schedules.length === 0 ? (
          <EmptyScreen title="No Schedules Found" description="Create one to get started." className="min-h-full" />
        ) : filtered.length === 0 ? (
          <div className="flex min-h-full flex-col">
            <EmptyScreen title="No Schedules Found" description="No schedules match your filters." className="flex-1" />
            {hasPageNav ? (
              <TableTokenPagination
                pageSize={pageSize}
                rowCount={0}
                canPrev={prevTokenStack.length > 0}
                canNext={nextPageToken != null}
                onPrev={goPrev}
                onNext={goNext}
                pageSizeOptions={SCHEDULES_PAGE_SIZE_OPTIONS}
                onPageSizeChange={size => {
                  const next = clampPageSize(size);
                  setPageSize(next);
                  setPageToken(undefined);
                  setPrevTokenStack([]);
                }}
              />
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-border">
            <Table className="min-w-[48rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Cadence</TableHead>
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
                  const agentLabel = schedule.agentName ?? agentNameById.get(schedule.agentId) ?? schedule.agentId;
                  return (
                    <TableRow key={schedule.id}>
                      <TableCell className="text-text-primary font-medium">
                        <button
                          type="button"
                          className="text-primary-button-bg hover:underline text-left"
                          onClick={() => setDrawer({ kind: 'edit', schedule })}
                        >
                          {schedule.name}
                        </button>
                      </TableCell>
                      <TableCell>{agentLabel}</TableCell>
                      <TableCell>{cadence}</TableCell>
                      <TableCell>
                        <ScheduleStatusBadge status={schedule.status} />
                      </TableCell>
                      <TableCell>
                        {runsLoading ? (
                          <span className="text-text-secondary text-sm">…</span>
                        ) : (
                          <ScheduleLastRunsCell runs={runsByScheduleId[schedule.id] ?? []} />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <ScheduleRowActions
                          schedule={schedule}
                          running={runningScheduleIds.has(schedule.id)}
                          onRunNow={() => void handleRunNow(schedule)}
                          onEdit={() => setDrawer({ kind: 'edit', schedule })}
                          onTogglePause={() => void handleTogglePause(schedule)}
                          onDelete={() => setPendingDelete(schedule)}
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
                canPrev={prevTokenStack.length > 0}
                canNext={nextPageToken != null}
                onPrev={goPrev}
                onNext={goNext}
                pageSizeOptions={SCHEDULES_PAGE_SIZE_OPTIONS}
                onPageSizeChange={size => {
                  const next = clampPageSize(size);
                  setPageSize(next);
                  setPageToken(undefined);
                  setPrevTokenStack([]);
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
          onSaved={() => resetToFirstPage()}
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
          onSaved={() => void loadSchedules({ token: pageToken, size: pageSize, agentId: agentFilter })}
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
            <Button type="button" variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleDelete(pendingDelete)}>
              Delete
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}
