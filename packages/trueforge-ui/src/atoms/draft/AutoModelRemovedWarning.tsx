'use client';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { Tooltip } from '../primitives/Tooltip.js';

export type AutoModelRemovedWarningProps = {
  removedCount: number;
  /** The button is hidden when a surface has nowhere to review the changes. */
  onReview?: () => void;
  /** The button is hidden when the agent cannot be edited. */
  onSync?: () => void;
  className?: string;
};

function modelCountLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'model' : 'models'}`;
}

/** Warning label for saved Auto candidates the workspace no longer lists; hovering it explains and offers fixes. */
export function AutoModelRemovedWarning({ removedCount, onReview, onSync, className }: AutoModelRemovedWarningProps) {
  if (removedCount <= 0) return null;

  return (
    <Tooltip
      side="bottom"
      align="start"
      dismissOnClick={false}
      triggerClassName={cn('max-w-full', className)}
      className="w-72 overflow-hidden whitespace-normal rounded-lg border border-warning-bg/40 p-0 text-left shadow-lg"
      content={
        <span className="bg-warning-bg/10 flex flex-col gap-2 p-3">
          <span className="text-warning-bg flex items-start gap-2 text-sm font-semibold">
            <Icon name="triangle-exclamation" className="mt-0.5 size-4 shrink-0" aria-hidden />
            Workspace model list changed since this agent was saved.
          </span>
          <span className="text-text-secondary text-xs leading-snug">
            {`${modelCountLabel(removedCount)} ${removedCount === 1 ? 'is' : 'are'} no longer in the workspace list. The agent still attempts routing across all saved candidates until a request succeeds, but requests may fail if an admin removed a provider.`}
          </span>
          {onReview !== undefined || onSync !== undefined ? (
            // The card is portaled outside a parent dropdown, whose outside-click handler would close it
            // on mousedown and swallow these clicks.
            <span className="flex flex-wrap gap-2 pt-1" onMouseDown={event => event.stopPropagation()}>
              {onReview !== undefined ? (
                <Button.Secondary type="button" size="large" onClick={onReview}>
                  Review changes
                </Button.Secondary>
              ) : null}
              {onSync !== undefined ? (
                <Button.Primary type="button" size="large" onClick={onSync}>
                  <Icon name="refresh-cw" aria-hidden />
                  Sync with workspace
                </Button.Primary>
              ) : null}
            </span>
          ) : null}
        </span>
      }
    >
      <span
        tabIndex={0}
        className="text-warning-bg inline-flex max-w-full items-center gap-1.5 text-xs font-medium focus-visible:outline-none focus-visible:underline"
      >
        <Icon name="triangle-exclamation" className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{`${modelCountLabel(removedCount)} removed from workspace list`}</span>
      </span>
    </Tooltip>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AutoModelRemovedWarning: typeof AutoModelRemovedWarning;
  }
}
