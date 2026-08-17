import { cn } from './lib/cn.js';

export type MessageIndicatorProps = {
  className?: string;
};

export function MessageIndicator({ className }: MessageIndicatorProps) {
  return (
    <span
      data-slot="aui_assistant-message-indicator"
      className={cn('animate-pulse font-sans', className)}
      aria-label="Assistant is working"
    >
      {'●'}
    </span>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    MessageIndicator: typeof MessageIndicator;
  }
}
