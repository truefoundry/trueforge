import { forwardRef, type ComponentProps } from 'react';

import { Icon } from '../icons/Icon.js';
import { cn } from './lib/cn.js';
import { Button } from './primitives/Button.js';

export type ScrollToBottomButtonProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'>;

export const ScrollToBottomButton = forwardRef<HTMLSpanElement, ScrollToBottomButtonProps>(
  ({ className, disabled, ...rest }, ref) => {
    if (disabled) return null;
    return (
      <span ref={ref} className={cn('absolute -top-14 z-10 inline-flex self-center')}>
        <Button.Ghost
          type="button"
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
          disabled={disabled}
          size="small"
          className={cn(
            'aui-thread-scroll-to-bottom aspect-square rounded-full border border-border bg-primary-bg p-3 px-0 text-text-primary shadow-sm hover:bg-ghost-button-hover hover:text-text-primary',
            className,
          )}
          {...rest}
        >
          <Icon name="arrow-down" />
        </Button.Ghost>
      </span>
    );
  },
);

ScrollToBottomButton.displayName = 'ScrollToBottomButton';

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ScrollToBottomButton: typeof ScrollToBottomButton;
  }
}
