'use client';

import { useOptionalCurrentUser } from '../contexts/CurrentUserContext.js';
import { cn } from './lib/cn.js';
import { Avatar, AvatarFallback } from './primitives/Avatar.js';

export type UserAvatarProps = {
  labeled?: boolean; // Uses the sidebar rail width instead of the compact chrome width
  className?: string;
};

export function getUserInitials(displayName: string): string {
  // split by spaces and filter out empty strings
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (first === undefined) {
    return '';
  }
  const last = parts.at(-1);
  const characters =
    parts.length === 1 ? Array.from(first).slice(0, 2) : [Array.from(first)[0], Array.from(last ?? '')[0]];

  return characters
    .filter(character => character !== undefined)
    .join('')
    .toLocaleUpperCase();
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
        labeled ? 'w-14.5' : 'max-w-20',
        className,
      )}
    >
      <Avatar size="sm">
        <AvatarFallback className="bg-primary-button-bg text-primary-button-text">
          {getUserInitials(displayName)}
        </AvatarFallback>
      </Avatar>
      <span className="w-full truncate text-center text-[0.625rem] leading-tight">{displayName}</span>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    UserAvatar: typeof UserAvatar;
  }
}
