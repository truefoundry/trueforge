import { forwardRef, type ComponentProps } from 'react';

import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';

export type ScrollToBottomButtonProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'>;

export const ScrollToBottomButton = forwardRef<HTMLSpanElement, ScrollToBottomButtonProps>(
  ({ className, disabled, ...rest }, ref) => {
    if (disabled) return null;
    return (
      <span ref={ref} className={cn('absolute -top-14 z-10 inline-flex self-center')}>
        <button
          type="button"
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
          disabled={disabled}
          className={auiButtonClass({
            variant: 'ghost',
            size: 'icon',
            className: cn(
              'aui-thread-scroll-to-bottom rounded-full border border-border bg-primary-bg text-text-primary shadow-sm hover:bg-ghost-button-hover hover:text-text-primary p-3',
              className,
            ),
          })}
          {...rest}
        >
          <Icon name="arrow-down" />
        </button>
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
