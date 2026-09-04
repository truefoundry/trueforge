'use client';

import type { ReactNode } from 'react';

import { cn } from './lib/cn.js';

/** Shared title styles for page / chat chrome headers. */
export const pageHeaderTitleClassName = 'text-text-primary min-w-0 truncate text-md font-semibold';

export type PageHeaderProps = {
  /** Page name, or a custom title node (e.g. `NamedAgentHeaderLabel`). Strings use the shared h1 styles. */
  title?: ReactNode;
  /** Leading chrome (back / menu). */
  start?: ReactNode;
  /** Trailing actions; pushed to the end. */
  end?: ReactNode;
  /** Extra content between title and end (prefer `start` / `end` when possible). */
  children?: ReactNode;
  className?: string;
};

/** Shared shell/page header bar used by chat chrome and list pages.
 * `min-h-14` keeps a single-row bar aligned with Agent Config; wrapping end actions can grow the bar.
 */
export function PageHeader({ title, start, end, children, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 md:px-6',
        className,
      )}
    >
      {start}
      {typeof title === 'string' ? <h1 className={pageHeaderTitleClassName}>{title}</h1> : title}
      {children}
      {end != null ? <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{end}</div> : null}
    </header>
  );
}
