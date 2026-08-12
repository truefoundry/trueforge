import { cn } from './lib/cn.js';

export type MessageErrorBannerProps = {
  message: string;
  className?: string;
};

export function MessageErrorBanner({ message, className }: MessageErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        'aui-message-error-root border-failure-bg bg-failure-bg/10 text-failure-bg mt-2 rounded-md border p-3 text-sm',
        className,
      )}
    >
      <span className="aui-message-error-message line-clamp-2">{message}</span>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    MessageErrorBanner: typeof MessageErrorBanner;
  }
}
