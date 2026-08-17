import { forwardRef, type ComponentPropsWithRef } from 'react';

import { cn } from './lib/cn.js';
import { Spinner } from './primitives/Spinner.js';

export type HistoryLoaderProps = ComponentPropsWithRef<'div'> & {
  /** True while an older-history page is being fetched. */
  isLoading?: boolean;
};

/**
 * Inline status row shown at the top of the message list when older history
 * pages are available. Doubles as the scroll sentinel observed by
 * `HistoryLoaderContainer`.
 */
export const HistoryLoader = forwardRef<HTMLDivElement, HistoryLoaderProps>(
  ({ className, isLoading = false, ...rest }, ref) => (
    <div
      ref={ref}
      data-slot="aui_history-loader"
      role="status"
      aria-live="polite"
      aria-label={isLoading ? 'Loading older messages' : 'Scroll up to load older messages'}
      className={cn('flex justify-center py-2', className)}
      {...rest}
    >
      {isLoading && <Spinner size={14} />}
    </div>
  ),
);
HistoryLoader.displayName = 'HistoryLoader';

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    HistoryLoader: typeof HistoryLoader;
  }
}
