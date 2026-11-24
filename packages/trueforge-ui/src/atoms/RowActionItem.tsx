'use client';

import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';
import { DropdownMenuItem } from './primitives/DropdownMenu.js';
import { Tooltip } from './primitives/Tooltip.js';

/** A row action that stays visible when unavailable, greyed out and explaining itself on hover. */
export function RowActionItem({
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
