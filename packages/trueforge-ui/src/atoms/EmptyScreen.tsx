'use client';

import type { ReactNode } from 'react';

import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';

export type EmptyScreenProps = {
  title: string;
  description?: ReactNode;
  /** Optional CTA under the description (e.g. Build Now). */
  action?: ReactNode;
  className?: string;
};

/** Centered empty surface: `empty` glyph + title + optional supporting copy. */
export function EmptyScreen({ title, description, action, className }: EmptyScreenProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-4 px-6 py-16',
        className,
      )}
    >
      <Icon name="empty" size={48} className="shrink-0" aria-hidden />
      <div className="flex max-w-md flex-col items-center gap-1.5 text-center">
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        {description != null ? <p className="text-sm text-text-secondary">{description}</p> : null}
      </div>
      {action != null ? <div className="flex shrink-0 items-center justify-center">{action}</div> : null}
    </div>
  );
}

/** Inline pill for a search/filter query inside empty-state descriptions. */
export function EmptyScreenQueryHighlight({ children }: { children: string }) {
  return (
    <span className="mx-0.5 inline-flex max-w-full truncate rounded-full bg-secondary-bg px-2 py-0.5 align-middle font-mono text-xs text-text-primary">
      {children}
    </span>
  );
}
