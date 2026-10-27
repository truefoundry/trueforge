import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';

export type MessageCancelledBannerProps = {
  /** Wire cancel reason as-is, e.g. "client-cancelled". */
  message: string;
  className?: string;
};

/** Orange warning banner for cancelled turns (Figma Agents cancelled status). */
export function MessageCancelledBanner({ message, className }: MessageCancelledBannerProps) {
  return (
    <div
      role="status"
      className={cn(
        'aui-message-cancelled-root border-warning-bg bg-warning-bg/10 text-warning-bg mt-2 inline-flex w-fit max-w-full items-center gap-3 rounded-xl border px-3 py-1.5 text-sm font-medium leading-[1.4]',
        className,
      )}
    >
      <Icon name="circle-exclamation" size="1rem" className="text-warning-bg shrink-0" aria-hidden />
      <span className="aui-message-cancelled-message min-w-0 break-words">{message}</span>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    MessageCancelledBanner: typeof MessageCancelledBanner;
  }
}
