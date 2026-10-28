'use client';

import { useState, type ReactNode } from 'react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { useSessionUserSearch } from '../hooks/useSessionUserSearch.js';
import {
  SESSION_SHARE_PRIVATE,
  SESSION_SHARE_TENANT,
  useShareSessionDialog,
  type SessionSharePermission,
} from '../hooks/useShareSessionDialog.js';
import { Icon } from '../icons/Icon.js';
import type { DirectoryUser } from '../server/types.js';
import { auiInputClass } from './lib/inputClasses.js';
import { auiSelectOptionClass, auiSelectTriggerClass } from './lib/selectClasses.js';
import { Avatar, AvatarFallback } from './primitives/Avatar.js';
import { Button } from './primitives/Button.js';
import { DropdownMenu } from './primitives/DropdownMenu.js';

export type ShareSessionDialogProps = {
  sessionId: string;
  trigger: ReactNode;
};

const SHARE_PERMISSIONS: Record<SessionSharePermission, { title: string; description: string }> = {
  [SESSION_SHARE_PRIVATE]: { title: 'Only you', description: 'Only you have access' },
  [SESSION_SHARE_TENANT]: { title: 'Everyone within this tenant', description: 'Everyone has access' },
};

const SHARE_PERMISSION_VALUES: readonly SessionSharePermission[] = [SESSION_SHARE_PRIVATE, SESSION_SHARE_TENANT];

function permissionCopy({
  permission,
  tenantId,
}: {
  permission: SessionSharePermission;
  tenantId: string | undefined;
}): { title: string; description: string } {
  if (permission === SESSION_SHARE_TENANT && tenantId != null && tenantId.length > 0) {
    return { title: `Everyone within ${tenantId}`, description: SHARE_PERMISSIONS[SESSION_SHARE_TENANT].description };
  }
  return SHARE_PERMISSIONS[permission];
}

function AccessSelector({
  permission,
  tenantId,
  disabled,
  onChange,
}: {
  permission: SessionSharePermission;
  tenantId: string | undefined;
  disabled: boolean;
  onChange: (next: SessionSharePermission) => void;
}) {
  const selected = permissionCopy({ permission, tenantId });

  return (
    <DropdownMenu
      align="start"
      captureOutsideClick
      containerClassName="w-full"
      className="z-210 w-108 p-1 gap-1"
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label="Session sharing"
          className={auiSelectTriggerClass(
            'h-auto w-full bg-secondary-bg px-4 py-1.75 disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon name="check" size="1rem" className="text-text-primary shrink-0" />
            <span className="flex min-w-0 items-baseline gap-2 text-sm">
              <span className="text-text-primary font-semibold">{selected.title}</span>
              <span className="text-text-secondary truncate">{selected.description}</span>
            </span>
          </span>
          <Icon name="chevron-down" size="1rem" className="text-text-secondary shrink-0" />
        </button>
      }
    >
      {SHARE_PERMISSION_VALUES.map(value => {
        const copy = permissionCopy({ permission: value, tenantId });
        return (
          <button
            key={value}
            type="button"
            role="option"
            aria-label={copy.title}
            aria-selected={value === permission}
            className={auiSelectOptionClass()}
            onClick={() => onChange(value)}
          >
            <span aria-hidden className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="font-semibold">{copy.title}</span>
              <span className="text-text-secondary truncate">{copy.description}</span>
            </span>
            <Icon name="check" className={value === permission ? 'opacity-100' : 'opacity-0'} />
          </button>
        );
      })}
    </DropdownMenu>
  );
}

function initialsOf(label: string): string {
  return label.trim().slice(0, 2).toUpperCase();
}

function PersonRow({
  label,
  role,
  action,
}: {
  label: string;
  role: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex h-8 w-full items-center gap-2 text-sm">
      <Avatar size="sm">
        <AvatarFallback>{initialsOf(label)}</AvatarFallback>
      </Avatar>
      <span className="text-text-primary min-w-0 flex-1 truncate">{label}</span>
      <span className="text-text-secondary shrink-0">{role}</span>
      {action == null ? null : (
        <button
          type="button"
          aria-label={action.label}
          title={action.label}
          className="text-text-secondary hover:text-text-primary shrink-0 cursor-pointer"
          onClick={action.onClick}
        >
          <Icon name="xmark" size="0.875rem" />
        </button>
      )}
    </div>
  );
}

function InviteCollaborators({
  excludedIds,
  onInvite,
}: {
  excludedIds: ReadonlySet<string>;
  onInvite: (users: DirectoryUser[]) => Promise<boolean>;
}) {
  const { query, setQuery, users, loading, hasMore, loadMore } = useSessionUserSearch({ enabled: true });
  const [selected, setSelected] = useState<DirectoryUser[]>([]);
  const [inviting, setInviting] = useState(false);
  const selectedIds = new Set(selected.map(user => user.id));
  const candidates = users.filter(user => !excludedIds.has(user.id) && !selectedIds.has(user.id));

  const submit = async () => {
    if (selected.length === 0 || inviting) return;
    setInviting(true);
    const ok = await onInvite(selected);
    setInviting(false);
    if (ok) {
      setSelected([]);
      setQuery('');
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex h-8 w-full items-center gap-2">
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Add collaborator username or email"
          aria-label="Search users"
          className={auiInputClass('h-8 min-w-0 flex-1 px-3.5 text-[0.8125rem]')}
        />
        <Button.Primary
          type="button"
          size="large"
          className="h-8 shrink-0 rounded px-2.5 text-xs"
          disabled={selected.length === 0 || inviting}
          onClick={() => {
            void submit();
          }}
        >
          <Icon name="users" size="0.875rem" />
          Invite
        </Button.Primary>
      </div>
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(user => (
            <button
              key={user.id}
              type="button"
              aria-label={`Remove ${user.displayName} from invite`}
              className="bg-secondary-bg text-text-primary flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              onClick={() => setSelected(current => current.filter(item => item.id !== user.id))}
            >
              {user.displayName}
              <Icon name="xmark" size="0.625rem" />
            </button>
          ))}
        </div>
      ) : null}
      {query.trim().length > 0 && (candidates.length > 0 || hasMore) ? (
        <div role="listbox" aria-label="Matching users" className="flex max-h-40 w-full flex-col overflow-y-auto">
          {candidates.map(user => (
            <button
              key={user.id}
              type="button"
              role="option"
              aria-selected={false}
              className={auiSelectOptionClass()}
              onClick={() => setSelected(current => [...current, user])}
            >
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="font-semibold">{user.displayName}</span>
                {user.email == null ? null : <span className="text-text-secondary truncate">{user.email}</span>}
              </span>
            </button>
          ))}
          {hasMore ? (
            <button
              type="button"
              className="text-text-secondary hover:text-text-primary cursor-pointer px-2 py-1.5 text-left text-sm"
              disabled={loading}
              onClick={loadMore}
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ShareSessionDialog({ sessionId, trigger }: ShareSessionDialogProps) {
  const {
    permission,
    canChangePermission,
    canInvite,
    loading,
    shareUrl,
    copied,
    tenantId,
    owner,
    collaborators,
    load,
    changePermission,
    invite,
    removeCollaborator,
    copySharedSessionLink,
  } = useShareSessionDialog(sessionId);
  const track = useTrackAnalytics();

  return (
    <DropdownMenu
      trigger={trigger}
      align="end"
      closeOnClick={false}
      onOpenChange={open => {
        if (open) {
          track(AnalyticsEvents.Session.SHARE_OPENED, { session_id: sessionId });
          load();
        }
      }}
      className="w-120 gap-5 rounded-[0.75rem] p-6 shadow-xs"
    >
      <div className="flex w-full items-center gap-2">
        <Icon name="user-cog" size="1.25rem" className="text-text-primary shrink-0" />
        <p className="text-text-primary min-w-0 flex-1 text-base font-semibold">Change permissions</p>
      </div>
      <AccessSelector
        permission={permission}
        tenantId={tenantId}
        disabled={!canChangePermission || loading}
        onChange={next => {
          track(AnalyticsEvents.Session.SHARE_PERMISSION_CHANGED, { session_id: sessionId, permission: next });
          void changePermission(next);
        }}
      />
      {canInvite ? (
        <InviteCollaborators
          excludedIds={new Set([...collaborators.map(grant => grant.subjectId), ...(owner == null ? [] : [owner.id])])}
          onInvite={async users => {
            const ok = await invite(users);
            if (ok)
              track(AnalyticsEvents.Session.SHARE_COLLABORATORS_INVITED, {
                session_id: sessionId,
                count: users.length,
              });
            return ok;
          }}
        />
      ) : null}
      {collaborators.length > 0 || owner != null ? (
        <div className="flex w-full flex-col gap-1">
          {collaborators.map(grant => {
            const label = grant.displayName ?? grant.email ?? grant.subjectId;
            return (
              <PersonRow
                key={grant.subjectId}
                label={label}
                role="can access"
                {...(canInvite
                  ? {
                      action: {
                        label: `Remove ${label}`,
                        onClick: () => {
                          track(AnalyticsEvents.Session.SHARE_COLLABORATOR_REMOVED, { session_id: sessionId });
                          void removeCollaborator(grant.subjectId);
                        },
                      },
                    }
                  : {})}
              />
            );
          })}
          {owner == null ? null : <PersonRow label={owner.displayName} role="owner" />}
        </div>
      ) : null}
      {permission === SESSION_SHARE_TENANT || collaborators.length > 0 ? (
        <>
          <div role="separator" className="bg-border h-px w-full" />
          <div className="flex w-full items-center gap-2">
            <Icon name="link" size="1rem" className="text-text-primary shrink-0" />
            <p className="text-text-primary min-w-0 flex-1 text-sm font-semibold">Share URL</p>
          </div>
          <div className="flex h-8 w-full items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              aria-label="Share URL"
              className={auiInputClass('h-8 min-w-0 flex-1 px-3.5 text-[0.8125rem]')}
            />
            <Button.Primary
              type="button"
              size="large"
              className="h-8 shrink-0 rounded px-2.5 text-xs"
              onClick={() => {
                track(AnalyticsEvents.Session.SHARE_LINK_COPIED, {
                  session_id: sessionId,
                  permission,
                });
                copySharedSessionLink();
              }}
            >
              <Icon name={copied ? 'check' : 'copy'} size="0.875rem" />
              {copied ? 'Copied' : 'Copy'}
            </Button.Primary>
          </div>
        </>
      ) : null}
    </DropdownMenu>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ShareSessionDialog: typeof ShareSessionDialog;
  }
}
