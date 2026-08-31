'use client';

import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';

export type ApprovalNavBannerProps = {
  count: number;
  /** 1-based index for display, e.g. 1 in "(1/4)". */
  current: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Scroll the thread to the currently selected approval. */
  onFocusCurrent: () => void;
  className?: string;
};

export function ApprovalNavBanner({
  count,
  current,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onFocusCurrent,
  className,
}: ApprovalNavBannerProps) {
  // Figma Agents node 6747:4232 — "N tools need your input"
  const label = count === 1 ? '1 tool needs your input' : `${String(count)} tools need your input`;

  return (
    <div
      data-slot="aui_approval-nav-banner"
      role="status"
      aria-live="polite"
      aria-label={`${label}. Click to go to approval ${String(current)} of ${String(count)}.`}
      onClick={onFocusCurrent}
      className={cn(
        // Figma light 6747:4232 / dark 6748:1977 — top border only; sides & bottom open into the composer.
        'aui-approval-nav-banner border-approval-banner-border bg-approval-banner-bg text-approval-banner-fg flex w-full cursor-pointer items-center justify-between gap-2 border-t px-4 py-1.5 text-sm',
        'rounded-t-[var(--composer-radius,1.5rem)]',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="bg-approval-banner-accent size-2 shrink-0 rounded-full" aria-hidden />
        <span className="truncate font-medium leading-[1.4]">{label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-medium tabular-nums leading-[1.4]">
          ({current}/{count})
        </span>
        <button
          type="button"
          aria-label="Next approval"
          disabled={!canNext}
          onClick={event => {
            event.stopPropagation();
            onNext();
          }}
          className="text-approval-banner-fg hover:bg-approval-banner-border/10 inline-flex size-6 items-center justify-center rounded-sm disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name="arrow-down" size="0.875rem" />
        </button>
        <button
          type="button"
          aria-label="Previous approval"
          disabled={!canPrev}
          onClick={event => {
            event.stopPropagation();
            onPrev();
          }}
          className="text-approval-banner-fg hover:bg-approval-banner-border/10 inline-flex size-6 items-center justify-center rounded-sm disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name="arrow-up" size="0.875rem" />
        </button>
      </div>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ApprovalNavBanner: typeof ApprovalNavBanner;
  }
}
