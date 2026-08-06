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
        'aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm',
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
