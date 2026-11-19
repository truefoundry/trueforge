import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';

export type MessageCancelledBannerProps = {
  /** Human-readable cancel reason, e.g. "You stopped this response". */
  message: string;
  className?: string;
};

/** Muted inline status for cancelled turns; plain text so it reads as an event, not an error. */
export function MessageCancelledBanner({ message, className }: MessageCancelledBannerProps) {
  return (
    <div
      role="status"
      className={cn(
        'aui-message-cancelled-root text-text-secondary mt-2 inline-flex w-fit max-w-full items-center gap-2 text-sm leading-[1.4]',
        className,
      )}
    >
      <Icon name="circle-exclamation" size="1rem" className="-translate-y-[0.0625rem] shrink-0" aria-hidden />
      <span className="aui-message-cancelled-message min-w-0 break-words">{message}</span>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    MessageCancelledBanner: typeof MessageCancelledBanner;
  }
}
