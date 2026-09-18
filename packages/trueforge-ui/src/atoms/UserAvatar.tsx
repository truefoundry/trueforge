'use client';

import { useOptionalCurrentUser } from '../contexts/CurrentUserContext.js';
import { cn } from './lib/cn.js';
import { Avatar, AvatarFallback } from './primitives/Avatar.js';

export type UserAvatarProps = {
  /** Sidebar rail: wider control with display name under the avatar. */
  labeled?: boolean;
  className?: string;
};

export function getUserInitials(displayName: string): string {
  const first = Array.from(displayName.trim())[0];
  return first === undefined ? '' : first.toLocaleUpperCase();
}

// Default current-user chrome; hosts can replace it through `overrides.UserAvatar`.
export function UserAvatar({ labeled = false, className }: UserAvatarProps) {
  const currentUser = useOptionalCurrentUser();
  const displayName = currentUser?.displayName.trim();
  if (!displayName) {
    return null;
  }

  return (
    <div
      data-slot="user-avatar"
      aria-label={displayName}
      title={displayName}
      className={cn(
        'flex min-w-0 shrink-0 flex-col items-center justify-center gap-0.5 text-text-secondary',
        labeled ? 'w-14.5' : undefined,
        className,
      )}
    >
      <Avatar size="sm">
        <AvatarFallback>{getUserInitials(displayName)}</AvatarFallback>
      </Avatar>
      {labeled ? (
        <span className="w-full truncate text-center text-[0.625rem] leading-tight">{displayName}</span>
      ) : null}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    UserAvatar: typeof UserAvatar;
  }
}
