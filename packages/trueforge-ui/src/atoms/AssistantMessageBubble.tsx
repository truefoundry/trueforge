import type { ReactNode } from 'react';

import { cn } from './lib/cn.js';

export type AssistantMessageBubbleProps = {
  children: ReactNode;
  error?: ReactNode;
  /** Terminal status chrome (e.g. cancelled banner); rendered under message parts. */
  statusBanner?: ReactNode;
  actionBar?: ReactNode;
  className?: string;
};

export function AssistantMessageBubble({
  children,
  error,
  statusBanner,
  actionBar,
  className,
}: AssistantMessageBubbleProps) {
  return (
    <div
      data-slot="aui_assistant-message-root"
      className={cn(
        'group/assistant relative min-w-0 max-w-full bg-assistant-message-bg text-assistant-message-text',
        className,
      )}
    >
      <div className="min-w-0 max-w-full">
        {children}
        {statusBanner}
        {error && <div className="mt-2 text-sm text-failure-bg">{error}</div>}
      </div>
      {actionBar && <div className="mt-1">{actionBar}</div>}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AssistantMessageBubble: typeof AssistantMessageBubble;
  }
}
