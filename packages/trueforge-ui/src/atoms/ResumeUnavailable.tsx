'use client';

import { cn } from './lib/cn.js';

export type ResumeUnavailableProps = {
  className?: string;
};

/**
 * Inline waiting notice when a response is still generating but this backend
 * cannot stream it live.
 */
export function ResumeUnavailable({ className }: ResumeUnavailableProps) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn('text-text-secondary flex items-center gap-2 py-2 text-sm leading-snug', className)}
    >
      <span className="animate-pulse font-sans" aria-hidden>
        {'●'}
      </span>
      Still generating a response. It&apos;ll appear here when ready.
    </p>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ResumeUnavailable: typeof ResumeUnavailable;
  }
}
