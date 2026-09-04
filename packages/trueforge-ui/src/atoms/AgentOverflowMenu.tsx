'use client';

import { useState } from 'react';

import { useToasterOptional } from '../containers/ToasterContainer.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentSpec } from '../server/types.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { Button } from './primitives/Button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './primitives/Dialog.js';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from './primitives/DropdownMenu.js';

/** Immutable clone name for a library agent (`{name}-copy`). */
export function cloneAgentName(agentName: string): string {
  return `${agentName}-copy`;
}

export type AgentOverflowMenuProps = {
  agentName: string;
  agentSpec?: AgentSpec;
  /** Edit / Clone / Delete when composer is enabled. */
  canMutate: boolean;
  canManageSchedules: boolean;
  onEdit: () => void;
  onManageSchedules?: () => void;
  /** After successful delete (e.g. leave agent details). */
  onDeleted?: () => void;
};

type PendingAction = 'clone' | 'delete' | null;

export function AgentOverflowMenu({
  agentName,
  agentSpec,
  canMutate,
  canManageSchedules,
  onEdit,
  onManageSchedules,
  onDeleted,
}: AgentOverflowMenuProps) {
  const builder = useOptionalServer();
  const shell = useOptionalShellMode();
  const toaster = useToasterOptional();
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);

  const canEditOrClone = canMutate && agentSpec != null;
  const showManageSchedules = canManageSchedules && onManageSchedules != null;
  const showMenu = canEditOrClone || showManageSchedules || canMutate;
  if (!showMenu) return null;

  const clonedName = cloneAgentName(agentName);

  const closePending = () => {
    if (busy) return;
    setPending(null);
  };

  const handleClone = async () => {
    if (builder == null || agentSpec == null) return;
    setBusy(true);
    try {
      await builder.saveAgent({
        agentName: clonedName,
        agentSpec,
        intent: 'create',
      });
      shell?.invalidateAgentsList();
      toaster?.showSuccess({
        title: 'Agent cloned',
        description: `Created “${clonedName}”.`,
      });
      setPending(null);
    } catch (caught) {
      toaster?.showError(caught);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (builder == null || typeof builder.deleteAgent !== 'function') return;
    setBusy(true);
    try {
      await builder.deleteAgent({ agentName });
      shell?.invalidateAgentsList();
      toaster?.showSuccess({
        title: 'Agent deleted',
        description: `“${agentName}” was deleted.`,
      });
      setPending(null);
      onDeleted?.();
    } catch (caught) {
      toaster?.showError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu
        align="end"
        className="min-w-48"
        trigger={
          <button
            type="button"
            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
            aria-label={`Actions for ${agentName}`}
          >
            <Icon name="ellipsis-vertical" className="size-4" />
          </button>
        }
      >
        {canEditOrClone ? (
          <DropdownMenuItem className="whitespace-nowrap" onClick={onEdit}>
            <Icon name="pencil" className="size-3.5" />
            Edit
          </DropdownMenuItem>
        ) : null}
        {canEditOrClone ? (
          <DropdownMenuItem className="whitespace-nowrap" onClick={() => setPending('clone')}>
            <Icon name="clone" className="size-3.5" />
            Clone
          </DropdownMenuItem>
        ) : null}
        {showManageSchedules ? (
          <DropdownMenuItem className="whitespace-nowrap" onClick={onManageSchedules}>
            <Icon name="calendar-clock" className="size-3.5" />
            Manage Schedules
          </DropdownMenuItem>
        ) : null}
        {canMutate ? (
          <>
            {canEditOrClone || showManageSchedules ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              className="whitespace-nowrap text-failure-bg focus-visible:text-failure-bg"
              onClick={() => setPending('delete')}
            >
              <Icon name="trash" className="size-3.5" />
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenu>

      {pending === 'clone' ? (
        <Dialog open onOpenChange={open => !open && closePending()} aria-label="Clone agent" className="max-w-md">
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Clone agent?</DialogTitle>
              <p className="text-text-secondary text-sm">
                This will create “{clonedName}” with the same configuration as “{agentName}”.
              </p>
            </DialogHeader>
          </DialogContent>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={closePending}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || builder == null} onClick={() => void handleClone()}>
              Clone
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}

      {pending === 'delete' ? (
        <Dialog open onOpenChange={open => !open && closePending()} aria-label="Delete agent" className="max-w-md">
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete agent?</DialogTitle>
              <p className="text-text-secondary text-sm">
                “{agentName}” will be permanently deleted. This cannot be undone.
              </p>
            </DialogHeader>
          </DialogContent>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={closePending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || builder == null || typeof builder.deleteAgent !== 'function'}
              onClick={() => void handleDelete()}
            >
              Delete
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </>
  );
}
