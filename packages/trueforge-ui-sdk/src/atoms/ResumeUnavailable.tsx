'use client';

import { StatusDot } from './agent-chat/StatusDot.js';
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
    <div
      role="status"
      aria-live="polite"
      className={cn('text-muted-foreground flex items-center gap-2 py-2 text-sm leading-snug', className)}
    >
      <StatusDot colorClassName="bg-muted-foreground/70" />
      <p>Still generating a response. It&apos;ll appear here when ready.</p>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ResumeUnavailable: typeof ResumeUnavailable;
  }
}
