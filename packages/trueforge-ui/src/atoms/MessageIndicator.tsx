import { ThinkingOrb } from 'thinking-orbs';

import { cn } from './lib/cn.js';

export type MessageIndicatorProps = {
  className?: string;
};

export function MessageIndicator({ className }: MessageIndicatorProps) {
  return (
    <span
      data-slot="aui_assistant-message-indicator"
      role="status"
      className={cn('inline-flex items-center gap-1.5 font-sans text-sm text-text-secondary', className)}
    >
      <ThinkingOrb state="listening" size={20} aria-hidden />
      <span className="aui-message-indicator-shimmer">Working...</span>
    </span>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    MessageIndicator: typeof MessageIndicator;
  }
}
