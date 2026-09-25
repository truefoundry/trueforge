'use client';

import type { ReactNode } from 'react';

import { useShareSessionDialog, type SessionSharePermission } from '../hooks/useShareSessionDialog.js';
import { Icon } from '../icons/Icon.js';
import { auiInputClass } from './lib/inputClasses.js';
import { auiSelectOptionClass, auiSelectTriggerClass } from './lib/selectClasses.js';
import { Button } from './primitives/Button.js';
import { DropdownMenu } from './primitives/DropdownMenu.js';

export type ShareSessionDialogProps = {
  sessionId: string;
  trigger: ReactNode;
};

const SHARE_PERMISSIONS: Record<SessionSharePermission, { title: string; description: string }> = {
  private: { title: 'Only you', description: 'Only you have access' },
  tenant: { title: 'Everyone within this tenant', description: 'Everyone has access' },
};

const SHARE_PERMISSION_VALUES: readonly SessionSharePermission[] = ['private', 'tenant'];

function permissionCopy({
  permission,
  tenantId,
}: {
  permission: SessionSharePermission;
  tenantId: string | undefined;
}): { title: string; description: string } {
  if (permission === 'tenant' && tenantId != null && tenantId.length > 0) {
    return { title: `Everyone within ${tenantId}`, description: SHARE_PERMISSIONS.tenant.description };
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
      containerClassName="w-full"
      className="z-210 w-88 p-1"
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

export function ShareSessionDialog({ sessionId, trigger }: ShareSessionDialogProps) {
  const {
    permission,
    canManage,
    loading,
    shareUrl,
    copied,
    tenantId,
    load,
    changePermission,
    copySharedSessionLink,
  } = useShareSessionDialog(sessionId);

  return (
    <DropdownMenu
      trigger={trigger}
      align="end"
      closeOnClick={false}
      onOpenChange={open => {
        if (open) void load();
      }}
      className="w-100 gap-5 rounded-[0.75rem] p-6 shadow-[0_0.5rem_0.75rem_rgba(0,0,0,0.05)]"
    >
      <div className="flex w-full items-center gap-2">
        <Icon name="user-cog" size="1.25rem" className="text-text-primary shrink-0" />
        <p className="text-text-primary min-w-0 flex-1 text-base font-semibold">Change permissions</p>
      </div>
      <AccessSelector
        permission={permission}
        tenantId={tenantId}
        disabled={!canManage || loading}
        onChange={next => {
          void changePermission(next);
        }}
      />
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
          onClick={() => void copySharedSessionLink()}
        >
          <Icon name={copied ? 'check' : 'copy'} size="0.875rem" />
          {copied ? 'Copied' : 'Copy'}
        </Button.Primary>
      </div>
    </DropdownMenu>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ShareSessionDialog: typeof ShareSessionDialog;
  }
}
