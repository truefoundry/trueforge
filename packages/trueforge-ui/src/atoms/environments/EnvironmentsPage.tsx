'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { useCanCreateAgent } from '../../hooks/useCanCreateAgent.js';
import { useResourcePermissions } from '../../hooks/useResourcePermissions.js';
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
import { cn } from '../lib/cn.js';
import { formatRelativeTime } from '../lib/dateFormat.js';
import { PageHeader } from '../PageHeader.js';
import { Badge } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../primitives/Dialog.js';
import { DropdownMenu, DropdownMenuItem } from '../primitives/DropdownMenu.js';
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
import { formatNetworkingSummary, formatResourcesSummary, isReservedEnvironmentName } from './environmentDisplay.js';
import { EnvironmentFormDrawer } from './EnvironmentFormDrawer.js';
import { EnvironmentStatusBadge } from './EnvironmentStatusBadge.js';

type DrawerState = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; environment: SandboxEnvironment };

const ENVIRONMENTS_PAGE_SIZE_OPTIONS = [10, 25] as const;
export const PENDING_ENVIRONMENTS_POLL_INTERVAL_MS = 10_000;

function clampPageSize(size: number): number {
  return Math.min(Math.max(size, 1), 25);
}

/**
 * Why each row action is unavailable, or undefined when it can be used. Every action stays in the
 * menu so the set on offer does not shift between rows; the reason is what explains the greying.
 *
 * MANAGE and DELETE are admin-only (same gate as tenant CREATE). The reserved name and
 * `isDefault` say what the row allows; those carve-outs are enforced by the API too.
 */
function environmentRowActionReasons({
  environment,
  canManage,
  canDelete,
  canSetDefault,
}: {
  environment: SandboxEnvironment;
  canManage: boolean;
  canDelete: boolean;
  /** Admin: tenant `sandbox_environment` CREATE (same role as New Environment). */
  canSetDefault: boolean;
}): {
  edit: string | undefined;
  setDefault: string | undefined;
  toggleEnabled: string | undefined;
  delete: string | undefined;
} {
  const noManage = canManage ? undefined : 'You do not have permission to manage this environment.';
  const reserved = isReservedEnvironmentName(environment.name);
  return {
    edit: reserved ? 'This environment is provided by the platform and cannot be edited.' : noManage,
    setDefault:
      noManage ??
      (!canSetDefault
        ? 'Only admins can choose the default environment.'
        : environment.isDefault
          ? 'Already the default.'
          : !environment.enabled
            ? 'Enable the environment before making it the default.'
            : environment.status !== 'ready'
              ? 'Only a ready environment can be the default.'
              : undefined),
    toggleEnabled:
      noManage ??
      (environment.isDefault && environment.enabled
        ? 'The default environment cannot be disabled. Make another one the default first.'
        : undefined),
    delete: reserved
      ? 'This environment is provided by the platform and cannot be deleted.'
      : environment.isDefault
        ? 'The default environment cannot be deleted. Make another one the default first.'
        : canDelete
          ? undefined
          : 'You do not have permission to delete this environment.',
  };
}

/** A row action that stays visible when unavailable, greyed out and explaining itself on hover. */
function EnvironmentActionItem({
  label,
  icon,
  reason,
  className,
  onClick,
}: {
  label: string;
  icon: string;
  /** Why the action is unavailable; when set the item is disabled and shows this on hover. */
  reason: string | undefined;
  className?: string;
  onClick: () => void;
}) {
  const item = (
    <DropdownMenuItem className={cn('whitespace-nowrap', className)} disabled={reason !== undefined} onClick={onClick}>
      <Icon name={icon} className="size-3.5" />
      {label}
    </DropdownMenuItem>
  );
  // The tooltip hangs off a wrapping span: a disabled item takes no mouse events of its own.
  return reason === undefined ? (
    item
  ) : (
    <Tooltip content={reason} side="left" className="max-w-xs whitespace-normal text-left" interactive={false}>
      <span className="block w-full">{item}</span>
    </Tooltip>
  );
}

export type EnvironmentsPageProps = Record<string, never>;

export function EnvironmentsPage(_props: EnvironmentsPageProps) {
  const environmentServer = useSandboxEnvironmentServer();
  const shell = useOptionalShellMode();
  const toaster = useToasterOptional();
  const track = useTrackAnalytics();
  const { canCreateSandboxEnvironment, loading: createPermissionLoading } = useCanCreateAgent();

  const [environments, setEnvironments] = useState<SandboxEnvironment[]>([]);
  const { allows } = useResourcePermissions({
    resourceType: 'sandbox_environment',
    resourceIds: environments.map(environment => environment.id),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameQuery, setNameQuery] = useState(() => readEnvironmentShareSearch(window.location.search).q ?? '');
  // Stay closed until tenant CREATE is known — do not open from envIsNew on first paint.
  const [drawer, setDrawer] = useState<DrawerState>({ kind: 'closed' });
  const [pendingDelete, setPendingDelete] = useState<SandboxEnvironment | null>(null);
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
          setError(getErrorMessage(caught, 'Check your connection and try again.'));
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

  // Wait for tenant CREATE before honoring envIsNew; close create if CREATE is denied.
  useEffect(() => {
    if (createPermissionLoading) return;

    const share = readEnvironmentShareSearch(window.location.search);
    if (!didConsumeIsNewRef.current && share.isNew) {
      didConsumeIsNewRef.current = true;
      replaceEnvironmentShareSearch({ isNew: null });
      if (canCreateSandboxEnvironment) {
        setDrawer({ kind: 'create' });
      } else {
        setDrawer(current => (current.kind === 'create' ? { kind: 'closed' } : current));
      }
      return;
    }

    if (!canCreateSandboxEnvironment) {
      setDrawer(current => (current.kind === 'create' ? { kind: 'closed' } : current));
    }
  }, [canCreateSandboxEnvironment, createPermissionLoading]);

  useEffect(() => {
    const onShareChange = () => {
      const share = readEnvironmentShareSearch(window.location.search);
      setNameQuery(share.q ?? '');
      if (!share.isNew) return;
      // Leave envIsNew in the URL until CREATE finishes loading so the resolve effect can honor it.
      if (createPermissionLoading) return;
      replaceEnvironmentShareSearch({ isNew: null });
      if (canCreateSandboxEnvironment) {
        setDrawer({ kind: 'create' });
      }
    };
    window.addEventListener(ENVIRONMENT_SHARE_CHANGE_EVENT, onShareChange);
    return () => window.removeEventListener(ENVIRONMENT_SHARE_CHANGE_EVENT, onShareChange);
  }, [canCreateSandboxEnvironment, createPermissionLoading]);

  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (q.length === 0) return environments;
    return environments.filter(env => env.name.toLowerCase().includes(q) || env.description.toLowerCase().includes(q));
  }, [environments, nameQuery]);

  // Derived live so the drawer gains Save once permissions load after it was opened.
  const drawerReadOnly =
    drawer.kind === 'edit' &&
    (isReservedEnvironmentName(drawer.environment.name) || !allows(drawer.environment.id, 'MANAGE'));

  const hasPageNav = nextPageToken != null || previousPageToken != null || environments.length > 0;

  const openCreate = () => {
    if (!canCreateSandboxEnvironment) return;
    setDrawer({ kind: 'create' });
  };

  const handleDelete = async () => {
    if (pendingDelete == null) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await environmentServer.deleteEnvironment({ name: target.name });
      track(AnalyticsEvents.Environment.DELETED, {
        environment_name: target.name,
        environment_id: target.id,
      });
      toaster?.showSuccess({ title: 'Environment deleted' });
      setPageToken(undefined);
      shell?.invalidateEnvironmentsList();
      void loadEnvironments({ token: undefined, size: pageSize });
    } catch (caught) {
      toaster?.showError(caught);
    }
  };

  const applyFlagChange = async ({ change, title }: { change: () => Promise<unknown>; title: string }) => {
    try {
      await change();
      toaster?.showSuccess({ title });
      shell?.invalidateEnvironmentsList();
      void loadEnvironments({ token: pageToken, size: pageSize });
    } catch (caught) {
      toaster?.showError(caught);
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
            <Tooltip
              content={
                canCreateSandboxEnvironment || createPermissionLoading
                  ? undefined
                  : 'Only admins can create sandbox environments'
              }
            >
              <span className="inline-flex">
                <Button.Primary type="button" onClick={openCreate} disabled={!canCreateSandboxEnvironment}>
                  <Icon name="plus" className="size-3.5" />
                  New Environment
                </Button.Primary>
              </span>
            </Tooltip>
          </>
        }
      />

      <div className={cn('min-h-0 flex-1 overflow-auto px-4 py-4', error != null ? 'flex flex-col' : undefined)}>
        {error != null ? (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center">
            <EmptyScreen
              title="Couldn't load environments"
              description={error}
              className="h-auto min-h-0 flex-none py-0"
            />
          </div>
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
                  const readOnly = isReservedEnvironmentName(env.name) || !allows(env.id, 'MANAGE');
                  const actions = environmentRowActionReasons({
                    environment: env,
                    canManage: allows(env.id, 'MANAGE'),
                    canDelete: allows(env.id, 'DELETE'),
                    canSetDefault: canCreateSandboxEnvironment,
                  });
                  return (
                    <TableRow
                      key={env.id}
                      className="cursor-pointer"
                      onClick={() => setDrawer({ kind: 'edit', environment: env })}
                    >
                      <TableCell className="w-96 max-w-96">
                        <div className="flex flex-col gap-0.5">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium text-text-primary">{env.name}</span>
                            {env.isDefault ? (
                              <Tooltip
                                content="Agents that do not pick an environment run in this one."
                                className="max-w-xs whitespace-normal text-left"
                                triggerClassName="shrink-0"
                              >
                                <Badge variant="info" shape="pill">
                                  Default
                                </Badge>
                              </Tooltip>
                            ) : null}
                            {env.enabled ? null : (
                              <Badge variant="outline" shape="pill">
                                Disabled
                              </Badge>
                            )}
                          </span>
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
                      <TableCell className="text-sm text-text-secondary">
                        {readOnly ? '—' : formatRelativeTime(env.updatedAt)}
                      </TableCell>
                      {/* Swallow here, not on the trigger: the trigger's own click must reach
                          the menu wrapper, and portal menu items still bubble through React. */}
                      <TableCell onClick={event => event.stopPropagation()}>
                        <DropdownMenu
                          align="end"
                          className="min-w-48"
                          trigger={
                            <button
                              type="button"
                              className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                              aria-label={`Actions for ${env.name}`}
                            >
                              <Icon name="ellipsis-vertical" className="size-3.5" />
                            </button>
                          }
                        >
                          <EnvironmentActionItem
                            label="Edit"
                            icon="pencil"
                            reason={actions.edit}
                            onClick={() => setDrawer({ kind: 'edit', environment: env })}
                          />
                          <EnvironmentActionItem
                            label="Set as default"
                            icon="check"
                            reason={actions.setDefault}
                            onClick={() =>
                              void applyFlagChange({
                                change: () => environmentServer.setDefaultEnvironment({ name: env.name }),
                                title: `“${env.name}” is now the default`,
                              })
                            }
                          />
                          <EnvironmentActionItem
                            label={env.enabled ? 'Disable' : 'Enable'}
                            icon={env.enabled ? 'circle-xmark' : 'circle-check'}
                            reason={actions.toggleEnabled}
                            onClick={() =>
                              void applyFlagChange({
                                change: () =>
                                  environmentServer.setEnvironmentEnabled({
                                    name: env.name,
                                    enabled: !env.enabled,
                                  }),
                                title: env.enabled ? 'Environment disabled' : 'Environment enabled',
                              })
                            }
                          />
                          <EnvironmentActionItem
                            label="Delete"
                            icon="trash"
                            className="text-failure-bg focus-visible:text-failure-bg"
                            reason={actions.delete}
                            onClick={() => setPendingDelete(env)}
                          />
                        </DropdownMenu>
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
        {...(drawer.kind === 'edit' ? { environment: drawer.environment, readOnly: drawerReadOnly } : {})}
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
            <Button.Secondary type="button" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button.Secondary>
            <Button.Primary type="button" onClick={() => void handleDelete()}>
              Delete
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
