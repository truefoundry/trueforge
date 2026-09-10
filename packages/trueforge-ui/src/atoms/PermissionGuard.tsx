'use client';

import { cloneElement, type ReactElement } from 'react';

import { Tooltip } from './primitives/Tooltip.js';

export type PermissionGuardProps = {
  allowed: boolean;
  children: ReactElement<{ disabled?: boolean }>;
  deniedMessage?: string;
};

export const PERMISSION_DENIED_MESSAGE = 'You do not have permission to perform this action.';

export function PermissionGuard({
  allowed,
  children,
  deniedMessage = PERMISSION_DENIED_MESSAGE,
}: PermissionGuardProps) {
  const guardedChild = cloneElement(children, {
    disabled: children.props.disabled === true || !allowed,
  });
  if (allowed) return guardedChild;

  return (
    <Tooltip content={deniedMessage}>
      <span aria-disabled="true" className="inline-flex w-full cursor-not-allowed *:pointer-events-none">
        {guardedChild}
      </span>
    </Tooltip>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    PermissionGuard: typeof PermissionGuard;
  }
}
