'use client';

import { useState } from 'react';

import { useToasterOptional } from '../containers/ToasterContainer.js';
import { useCanCreateAgent } from '../hooks/useCanCreateAgent.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentSpec } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { getErrorMessage } from '../utils/getErrorMessage.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cloneAgentSpec } from './lib/cloneAgentSpec.js';
import { Button } from './primitives/Button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './primitives/Dialog.js';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from './primitives/DropdownMenu.js';
import { SideDrawer } from './primitives/SideDrawer.js';

/** Immutable clone name for a library agent (`{name}-clone`). */
export function cloneAgentName(agentName: string): string {
  return `${agentName}-clone`;
}

export type AgentOverflowMenuProps = {
  agentName: string;
  description?: string;
  agentSpec?: AgentSpec;
  /** Edit / Clone / Delete when composer is enabled. */
  canMutate: boolean;
  canUse?: boolean;
  canManage?: boolean;
  canDelete?: boolean;
  canManageSchedules: boolean;
  onEdit: () => void;
  onManageSchedules?: () => void;
  /** After successful delete (e.g. leave agent details). */
  onDeleted?: () => void;
};

const NO_CREATE_AGENT_PERMISSION_MESSAGE = 'No permission to create agents';

export function AgentOverflowMenu({
  agentName,
  description,
  agentSpec,
  canMutate,
  canUse = true,
  canManage = true,
  canDelete = true,
  canManageSchedules,
  onEdit,
  onManageSchedules,
  onDeleted,
}: AgentOverflowMenuProps) {
  const builder = useOptionalServer();
  const shell = useOptionalShellMode();
  const toaster = useToasterOptional();
  const PermissionGuard = useSlot('PermissionGuard');
  const SaveAgentForm = useSlot('SaveAgentForm');
  const { canCreateAgent, loading: createAgentPermissionLoading } = useCanCreateAgent();
  const canCreate = canCreateAgent && !createAgentPermissionLoading;
  const [pendingDelete, setPendingDelete] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneDescription, setCloneDescription] = useState('');
  const [cloneSpec, setCloneSpec] = useState<AgentSpec | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canEditOrClone = canMutate && agentSpec != null;
  const showManageSchedules = canManageSchedules && onManageSchedules != null;
  const showMenu = canEditOrClone || showManageSchedules || canMutate;
  if (!showMenu) return null;

  const closePending = () => {
    if (busy) return;
    setPendingDelete(false);
  };

  const closeClone = () => {
    if (busy) return;
    setCloneOpen(false);
    setCloneSpec(null);
    setCloneError(null);
  };

  const openClone = () => {
    if (agentSpec == null || !canCreate) return;
    setCloneName(cloneAgentName(agentName));
    setCloneDescription(description?.trim() || agentName);
    setCloneSpec(cloneAgentSpec(agentSpec));
    setCloneError(null);
    setCloneOpen(true);
  };

  const handleCloneSave = async () => {
    if (!canCreate || builder == null || cloneSpec == null) return;
    const normalizedName = cloneName.trim();
    const normalizedDescription = cloneDescription.trim();
    if (!normalizedName || !normalizedDescription || !cloneSpec.model.name.trim()) return;
    setBusy(true);
    setCloneError(null);
    try {
      await builder.saveAgent({
        agentName: normalizedName,
        description: normalizedDescription,
        agentSpec: cloneSpec,
        intent: 'create',
      });
      shell?.invalidateAgentsList();
      toaster?.showSuccess({
        title: 'Agent cloned',
        description: `Created “${normalizedName}”.`,
      });
      setCloneOpen(false);
      setCloneSpec(null);
    } catch (caught) {
      setCloneError(getErrorMessage(caught, 'Could not clone agent'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!canDelete || builder == null || typeof builder.deleteAgent !== 'function') return;
    setPendingDelete(false);
    setBusy(true);
    try {
      await builder.deleteAgent({ agentName });
      shell?.invalidateAgentsList();
      toaster?.showSuccess({
        title: 'Agent deleted',
        description: `“${agentName}” was deleted.`,
      });
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
            <Icon name="ellipsis-vertical" />
          </button>
        }
      >
        {canEditOrClone ? (
          <PermissionGuard allowed={canManage}>
            <DropdownMenuItem
              className="whitespace-nowrap"
              onClick={() => {
                if (canManage) onEdit();
              }}
            >
              <Icon name="pencil" className="size-3.5" />
              Edit
            </DropdownMenuItem>
          </PermissionGuard>
        ) : null}
        {canEditOrClone ? (
          <PermissionGuard allowed={canCreate} deniedMessage={NO_CREATE_AGENT_PERMISSION_MESSAGE}>
            <DropdownMenuItem
              className="whitespace-nowrap"
              onClick={() => {
                if (canCreate) openClone();
              }}
            >
              <Icon name="clone" className="size-3.5" />
              Clone
            </DropdownMenuItem>
          </PermissionGuard>
        ) : null}
        {showManageSchedules ? (
          <PermissionGuard allowed={canUse}>
            <DropdownMenuItem
              className="whitespace-nowrap"
              onClick={() => {
                if (canUse) onManageSchedules?.();
              }}
            >
              <Icon name="calendar-clock" className="size-3.5" />
              Manage Schedules
            </DropdownMenuItem>
          </PermissionGuard>
        ) : null}
        {canMutate ? (
          <>
            {canEditOrClone || showManageSchedules ? <DropdownMenuSeparator /> : null}
            <PermissionGuard allowed={canDelete}>
              <DropdownMenuItem
                className="whitespace-nowrap text-failure-bg focus-visible:text-failure-bg"
                onClick={() => {
                  if (canDelete) setPendingDelete(true);
                }}
              >
                <Icon name="trash" className="size-3.5" />
                Delete
              </DropdownMenuItem>
            </PermissionGuard>
          </>
        ) : null}
      </DropdownMenu>

      <SideDrawer
        open={cloneOpen}
        onOpenChange={next => !next && closeClone()}
        title="Clone Agent"
        anchor="right"
        size="md"
        aria-label="Clone Agent"
      >
        {cloneSpec != null ? (
          <SaveAgentForm
            intent="create"
            name={cloneName}
            description={cloneDescription}
            spec={cloneSpec}
            saving={busy}
            error={cloneError}
            onNameChange={setCloneName}
            onDescriptionChange={setCloneDescription}
            onCancel={closeClone}
            onSave={() => void handleCloneSave()}
          />
        ) : null}
      </SideDrawer>

      {pendingDelete ? (
        <Dialog open onOpenChange={open => !open && closePending()} aria-label="Delete agent" className="max-w-md">
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete agent</DialogTitle>
              <p className="text-text-secondary text-sm">
                “{agentName}” will be permanently deleted, including any schedules for this agent. This cannot be
                undone.
              </p>
            </DialogHeader>
          </DialogContent>
          <DialogFooter>
            <Button.Secondary type="button" disabled={busy} onClick={closePending}>
              Cancel
            </Button.Secondary>
            <Button.Destructive
              type="button"
              disabled={busy || !canDelete || builder == null || typeof builder.deleteAgent !== 'function'}
              onClick={() => void handleDelete()}
            >
              Delete
            </Button.Destructive>
          </DialogFooter>
        </Dialog>
      ) : null}
    </>
  );
}
