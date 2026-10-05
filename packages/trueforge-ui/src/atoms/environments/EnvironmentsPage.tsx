'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { Icon } from '../../icons/Icon.js';
import { useSandboxEnvironmentServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { SandboxEnvironment } from '../../server/types.js';
import {
  ENVIRONMENT_SHARE_CHANGE_EVENT,
  readEnvironmentShareSearch,
  replaceEnvironmentShareSearch,
} from '../../utils/environmentShareUrl.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { EmptyScreen, EmptyScreenQueryHighlight } from '../EmptyScreen.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { formatRelativeTime } from '../lib/dateFormat.js';
import { PageHeader } from '../PageHeader.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../primitives/Dialog.js';
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
import { formatNetworkingSummary, formatResourcesSummary, isEnvironmentReadOnly } from './environmentDisplay.js';
import { EnvironmentFormDrawer } from './EnvironmentFormDrawer.js';
import { EnvironmentStatusBadge } from './EnvironmentStatusBadge.js';

type DrawerState = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; environment: SandboxEnvironment };

const ENVIRONMENTS_PAGE_SIZE_OPTIONS = [10, 25] as const;
export const PENDING_ENVIRONMENTS_POLL_INTERVAL_MS = 10_000;

function clampPageSize(size: number): number {
  return Math.min(Math.max(size, 1), 25);
}

function initialDrawerState(): DrawerState {
  return readEnvironmentShareSearch(window.location.search).isNew ? { kind: 'create' } : { kind: 'closed' };
}

export type EnvironmentsPageProps = Record<string, never>;

export function EnvironmentsPage(_props: EnvironmentsPageProps) {
  const environmentServer = useSandboxEnvironmentServer();
  const shell = useOptionalShellMode();
  const toaster = useToasterOptional();

  const [environments, setEnvironments] = useState<SandboxEnvironment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameQuery, setNameQuery] = useState(() => readEnvironmentShareSearch(window.location.search).q ?? '');
  const [drawer, setDrawer] = useState<DrawerState>(() => initialDrawerState());
  const [pendingDelete, setPendingDelete] = useState<SandboxEnvironment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pageSize, setPageSize] = useState(() => clampPageSize(DEFAULT_TABLE_PAGE_SIZE));
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [previousPageToken, setPreviousPageToken] = useState<string | undefined>(undefined);
  const loadGenRef = useRef(0);
  const didConsumeIsNewRef = useRef(false);
  const wasSettingsOpenRef = useRef(shell?.settingsOpen ?? false);
  const settingsOpen = shell?.settingsOpen ?? false;

  const loadEnvironments = useCallback(
    async ({ token, size, silent = false }: { token: string | undefined; size: number; silent?: boolean }) => {
      const gen = ++loadGenRef.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const page = await environmentServer.listEnvironments({
          limit: clampPageSize(size),
          ...(token === undefined || token === '' ? {} : { pageToken: token }),
        });
        if (gen !== loadGenRef.current) return;
        setEnvironments(page.data);
        setNextPageToken(page.nextPageToken);
        setPreviousPageToken(page.previousPageToken);
      } catch (caught) {
        if (gen !== loadGenRef.current) return;
        if (!silent) {
          setError(getErrorMessage(caught, 'Failed to load environments'));
          setEnvironments([]);
          setNextPageToken(undefined);
          setPreviousPageToken(undefined);
        }
      } finally {
        if (gen === loadGenRef.current && !silent) setLoading(false);
      }
    },
    [environmentServer],
  );

  useEffect(() => {
    replaceEnvironmentShareSearch({
      q: nameQuery.trim().length === 0 ? null : nameQuery,
    });
  }, [nameQuery]);

  useEffect(() => {
    void loadEnvironments({ token: pageToken, size: pageSize });
  }, [loadEnvironments, pageSize, pageToken]);

  useEffect(() => {
    if (wasSettingsOpenRef.current && !settingsOpen) {
      void loadEnvironments({ token: pageToken, size: pageSize });
    }
    wasSettingsOpenRef.current = settingsOpen;
  }, [settingsOpen, loadEnvironments, pageToken, pageSize]);

  // Poll individual pending environments using single-environment get API
  useEffect(() => {
    const pendingEnvs = environments.filter(env => env.status === 'pending');
    if (pendingEnvs.length === 0) return;

    const intervalId = window.setInterval(async () => {
      try {
        const updates = await Promise.all(
          pendingEnvs.map(env => environmentServer.getEnvironment({ name: env.name }).catch(() => null)),
        );
        const resolved = updates.filter((u): u is SandboxEnvironment => u != null);
        if (resolved.length === 0) return;

        setEnvironments(prev =>
          prev.map(item => {
            const updated = resolved.find(u => u.name === item.name);
            return updated ?? item;
          }),
        );
        // Pending envs becoming ready (or failed) must refresh still-mounted pickers.
        if (resolved.some(u => u.status !== 'pending')) {
          shell?.invalidateEnvironmentsList();
        }
      } catch {
        // Silently preserve current list on network error
      }
    }, PENDING_ENVIRONMENTS_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [environments, environmentServer, shell]);

  useEffect(() => {
    if (didConsumeIsNewRef.current) return;
    if (!readEnvironmentShareSearch(window.location.search).isNew) return;
    didConsumeIsNewRef.current = true;
    setDrawer({ kind: 'create' });
    replaceEnvironmentShareSearch({ isNew: null });
  }, []);

  useEffect(() => {
    const onShareChange = () => {
      const share = readEnvironmentShareSearch(window.location.search);
      setNameQuery(share.q ?? '');
      if (share.isNew) setDrawer({ kind: 'create' });
    };
    window.addEventListener(ENVIRONMENT_SHARE_CHANGE_EVENT, onShareChange);
    return () => window.removeEventListener(ENVIRONMENT_SHARE_CHANGE_EVENT, onShareChange);
  }, []);

  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (q.length === 0) return environments;
    return environments.filter(env => env.name.toLowerCase().includes(q) || env.description.toLowerCase().includes(q));
  }, [environments, nameQuery]);

  const hasPageNav = nextPageToken != null || previousPageToken != null || environments.length > 0;

  const openCreate = () => {
    setDrawer({ kind: 'create' });
  };

  const handleDelete = async () => {
    if (pendingDelete == null) return;
    setDeleting(true);
    try {
      await environmentServer.deleteEnvironment({ name: pendingDelete.name });
      toaster?.showSuccess({ title: 'Environment deleted' });
      setPendingDelete(null);
      setPageToken(undefined);
      shell?.invalidateEnvironmentsList();
      void loadEnvironments({ token: undefined, size: pageSize });
    } catch (caught) {
      toaster?.showError(caught);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg">
      <PageHeader
        title="Environments"
        end={
          <>
            <div className="w-64">
              <SearchInput query={nameQuery} setQuery={setNameQuery} placeholder="Search environments by name" />
            </div>
            <Button.Primary type="button" onClick={openCreate}>
              <Icon name="plus" className="size-3.5" />
              New Environment
            </Button.Primary>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        {error != null ? (
          <p className="text-failure-bg px-3 py-8 text-center text-sm">{error}</p>
        ) : loading ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading environments">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : environments.length === 0 ? (
          <EmptyScreen
            title="No environments yet"
            description="Create an environment to customize sandbox images, resources, and networking."
            className="min-h-full"
          />
        ) : filtered.length === 0 ? (
          <EmptyScreen
            title="No environments found"
            description={
              <>
                No environments match <EmptyScreenQueryHighlight>{nameQuery.trim()}</EmptyScreenQueryHighlight>.
              </>
            }
            className="min-h-full"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table className="min-w-240">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-96 max-w-96">Name</TableHead>
                  <TableHead>Build Status</TableHead>
                  <TableHead>Resources</TableHead>
                  <TableHead>Networking</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(env => {
                  const readOnly = isEnvironmentReadOnly(env);
                  return (
                    <TableRow
                      key={env.id}
                      className={readOnly ? undefined : 'cursor-pointer'}
                      onClick={() => {
                        if (!readOnly) setDrawer({ kind: 'edit', environment: env });
                      }}
                    >
                      <TableCell className="w-96 max-w-96">
                        <div className="flex flex-col gap-0.5">
                          <span className="truncate font-medium text-text-primary">{env.name}</span>
                          {env.description.length > 0 ? (
                            <Tooltip
                              content={env.description}
                              className="max-w-sm whitespace-normal text-left"
                              triggerClassName="block min-w-0 w-full max-w-full"
                            >
                              <span className="block truncate text-xs text-text-secondary">{env.description}</span>
                            </Tooltip>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <EnvironmentStatusBadge status={env.status} statusReason={env.statusReason} />
                      </TableCell>
                      <TableCell className="text-sm text-text-secondary">
                        {formatResourcesSummary(env.manifest.resources)}
                      </TableCell>
                      <TableCell className="text-sm text-text-secondary">
                        {formatNetworkingSummary(env.manifest.networking)}
                      </TableCell>
                      <TableCell className="text-sm text-text-secondary">{formatRelativeTime(env.updatedAt)}</TableCell>
                      <TableCell>
                        {!readOnly ? (
                          <button
                            type="button"
                            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                            aria-label={`Delete ${env.name}`}
                            onClick={event => {
                              event.stopPropagation();
                              setPendingDelete(env);
                            }}
                          >
                            <Icon name="trash" className="size-3.5 text-failure-bg" />
                          </button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {hasPageNav ? (
              <TableTokenPagination
                pageSize={pageSize}
                rowCount={filtered.length}
                canPrev={previousPageToken != null}
                canNext={nextPageToken != null}
                onPrev={() => setPageToken(previousPageToken)}
                onNext={() => setPageToken(nextPageToken)}
                pageSizeOptions={ENVIRONMENTS_PAGE_SIZE_OPTIONS}
                onPageSizeChange={size => {
                  setPageSize(clampPageSize(size));
                  setPageToken(undefined);
                  setPreviousPageToken(undefined);
                }}
              />
            ) : null}
          </div>
        )}
      </div>

      <EnvironmentFormDrawer
        open={drawer.kind !== 'closed'}
        mode={drawer.kind === 'edit' ? 'edit' : 'create'}
        {...(drawer.kind === 'edit' ? { environment: drawer.environment } : {})}
        onOpenChange={open => {
          if (!open) setDrawer({ kind: 'closed' });
        }}
        onSaved={() => {
          setPageToken(undefined);
          shell?.invalidateEnvironmentsList();
          void loadEnvironments({ token: undefined, size: pageSize });
        }}
      />

      <Dialog open={pendingDelete != null} onOpenChange={open => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete environment</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            Delete <span className="font-medium text-text-primary">{pendingDelete?.name}</span>? This cannot be undone.
            Delete fails if any agent still references the environment.
          </p>
          <DialogFooter>
            <Button.Secondary type="button" disabled={deleting} onClick={() => setPendingDelete(null)}>
              Cancel
            </Button.Secondary>
            <Button.Primary type="button" disabled={deleting} onClick={() => void handleDelete()}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button.Primary>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    EnvironmentsPage: ComponentType<EnvironmentsPageProps>;
  }
}
