'use client';

import { useOptionalCurrentUser } from '../contexts/CurrentUserContext.js';
import { cn } from './lib/cn.js';
import { Avatar, AvatarFallback } from './primitives/Avatar.js';
import { RailTooltip } from './primitives/Tooltip.js';

export type UserAvatarProps = {
  /** Wider rail-style chrome with caption (mobile drawer). */
  labeled?: boolean;
  /** Desktop app rail: avatar only, no caption. */
  iconOnly?: boolean;
  className?: string;
};

export function getUserInitials(displayName: string): string {
  const first = Array.from(displayName.trim())[0];
  return first === undefined ? '' : first.toLocaleUpperCase();
}

// Default current-user chrome; hosts can replace it through `overrides.UserAvatar`.
export function UserAvatar({ labeled = false, iconOnly = false, className }: UserAvatarProps) {
  const currentUser = useOptionalCurrentUser();
  const displayName = currentUser?.displayName.trim();
  if (!displayName) {
    return null;
  }

  const avatar = (
    <div
      data-slot="user-avatar"
      aria-label={displayName}
      title={iconOnly ? undefined : displayName}
      className={cn(
        'flex min-w-0 shrink-0 flex-col items-center justify-center gap-0.5 text-text-secondary',
        iconOnly ? 'size-9' : labeled ? 'w-14.5' : 'max-w-20',
        className,
      )}
    >
      <Avatar size="sm">
        <AvatarFallback>{getUserInitials(displayName)}</AvatarFallback>
      </Avatar>
      {iconOnly ? null : (
        <span className="w-full truncate text-center text-[0.625rem] leading-tight">{displayName}</span>
      )}
    </div>
  );

  return iconOnly ? <RailTooltip content={displayName}>{avatar}</RailTooltip> : avatar;
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    UserAvatar: typeof UserAvatar;
  }
}
