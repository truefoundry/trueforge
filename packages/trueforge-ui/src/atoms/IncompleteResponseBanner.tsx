import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';

export type IncompleteResponseBannerProps = {
  className?: string;
};

/** Orange warning banner for a response the provider cut short, shown under the partial answer. */
export function IncompleteResponseBanner({ className }: IncompleteResponseBannerProps) {
  return (
    <div
      role="status"
      className={cn(
        'aui-incomplete-response-root border-warning-bg bg-warning-bg/10 text-warning-bg mt-2 inline-flex w-fit max-w-full items-center gap-3 rounded-xl border px-3 py-1.5 text-sm font-medium leading-[1.4]',
        className,
      )}
    >
      <Icon name="circle-exclamation" size="1rem" className="text-warning-bg shrink-0" aria-hidden />
      <span className="aui-incomplete-response-message min-w-0 break-words">
        The model provider ended this response early, so it may be incomplete.
      </span>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    IncompleteResponseBanner: typeof IncompleteResponseBanner;
  }
}
