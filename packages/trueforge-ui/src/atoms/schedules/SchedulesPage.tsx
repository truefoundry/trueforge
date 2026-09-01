'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import { useScheduleServer, useServer } from '../../server/ServerContext.js';
import { libraryAgentId } from '../../server/ShellModeContext.js';
import type { Schedule, ScheduleStatus } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { SEARCH_AGENTS_PAGE_SIZE } from '../lib/useSearchAgentsList.js';
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
  TablePagination,
  TableRow,
} from '../primitives/Table.js';
import { formatCadenceSummary, formatRelativeTime } from './cadence.js';
import { ScheduleFormDrawer } from './ScheduleFormDrawer.js';
import { ScheduleStatusBadge } from './ScheduleStatusBadge.js';

type AgentOption = { agentId: string; name: string };

type DrawerState = { kind: 'closed' } | { kind: 'create'; agentId?: string } | { kind: 'edit'; schedule: Schedule };

const STATUS_FILTER_OPTIONS: Array<{ value: 'all' | ScheduleStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
];

function ScheduleRowActions({
  schedule,
  onEdit,
  onTogglePause,
  onDelete,
}: {
  schedule: Schedule;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  return (
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
  );
}

export function SchedulesPage() {
  const scheduleServer = useScheduleServer();
  const server = useServer();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameQuery, setNameQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ScheduleStatus>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [drawer, setDrawer] = useState<DrawerState>({ kind: 'closed' });
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_TABLE_PAGE_SIZE);

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await scheduleServer.listSchedules();
      setSchedules(rows);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to load schedules';
      setError(message);
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, [scheduleServer]);

  useEffect(() => {
    const agentId = new URLSearchParams(window.location.search).get('agentId');
    if (agentId != null && agentId !== '') setAgentFilter(agentId);
  }, []);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    let cancelled = false;
    void server
      .searchAgents({ limit: SEARCH_AGENTS_PAGE_SIZE })
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

  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    return schedules.filter(schedule => {
      if (statusFilter !== 'all' && schedule.status !== statusFilter) return false;
      if (agentFilter !== 'all' && schedule.agentId !== agentFilter) return false;
      if (q.length > 0 && !schedule.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [schedules, nameQuery, statusFilter, agentFilter]);

  useEffect(() => {
    setPage(0);
  }, [nameQuery, statusFilter, agentFilter, pageSize]);

  const pageRows = useMemo(() => {
    const start = page * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const handleTogglePause = async (schedule: Schedule) => {
    const nextStatus: ScheduleStatus = schedule.status === 'active' ? 'paused' : 'active';
    try {
      await scheduleServer.updateSchedule({ ...schedule, status: nextStatus });
      await loadSchedules();
    } catch {
      // ponytail: surface via toast when the shell has one; for now list refresh is enough
    }
  };

  const handleDelete = async (schedule: Schedule) => {
    setPendingDelete(null);
    try {
      await scheduleServer.deleteSchedule({ id: schedule.id });
      await loadSchedules();
    } catch {
      // ponytail: same as pause — host can wire toast later
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="calendar-clock" className="text-text-primary size-4" />
          <h1 className="text-text-primary truncate text-md font-semibold">Scheduled Agents</h1>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
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
            onValueChange={setAgentFilter}
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
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {loading ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading schedules">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : error != null ? (
          <p className="text-failure-bg px-3 py-8 text-center text-sm">{error}</p>
        ) : filtered.length === 0 ? (
          <div className="bg-secondary-bg/50 text-text-secondary flex items-center justify-center rounded-lg border border-border px-4 py-16 text-sm">
            {schedules.length === 0
              ? 'No schedules yet. Create one to get started.'
              : 'No schedules match your filters.'}
          </div>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map(schedule => {
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
                      <TableCell>{formatRelativeTime(schedule.lastRunAt)}</TableCell>
                      <TableCell className="text-right">
                        <ScheduleRowActions
                          schedule={schedule}
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
            <TablePagination
              page={page}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
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
          onSaved={() => void loadSchedules()}
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
          onSaved={() => void loadSchedules()}
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
