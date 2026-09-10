'use client';

import type { CreatedBySubject } from '../server/types.js';
import { createdByLabel } from '../utils/createdBySubject.js';
import { getUserInitials } from './UserAvatar.js';
import { Avatar, AvatarFallback } from './primitives/Avatar.js';
import { Tooltip } from './primitives/Tooltip.js';

export type CreatedByCellProps = {
  subject: CreatedBySubject | undefined;
};

/** Avatar + truncated label for a Created-by table cell. */
export function CreatedByCell({ subject }: CreatedByCellProps) {
  if (subject == null) {
    return <span className="text-text-secondary text-sm">—</span>;
  }
  const label = createdByLabel(subject);
  const initials = getUserInitials(label) || '?';
  return (
    <Tooltip content={label}>
      <span className="flex min-w-0 max-w-[14rem] items-center gap-2">
        <Avatar size="sm" aria-hidden>
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <span className="text-text-secondary truncate text-sm">{label}</span>
      </span>
    </Tooltip>
  );
}
