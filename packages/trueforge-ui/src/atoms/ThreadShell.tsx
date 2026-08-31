import { forwardRef, type ComponentPropsWithRef, type CSSProperties } from 'react';

import { cn } from './lib/cn.js';

const THREAD_CSS_VARS: CSSProperties = {
  ['--thread-max-width' as string]: '44rem',
  ['--composer-padding' as string]: '8px',
};

export type ThreadRootShellProps = ComponentPropsWithRef<'div'>;

export const ThreadRootShell = forwardRef<HTMLDivElement, ThreadRootShellProps>(
  ({ className, style, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'font-sans-flex aui-root aui-thread-root bg-primary-bg @container flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden',
        className,
      )}
      style={{ ...THREAD_CSS_VARS, ...style }}
      {...rest}
    />
  ),
);
ThreadRootShell.displayName = 'ThreadRootShell';

export type ThreadViewportShellProps = ComponentPropsWithRef<'div'> & {
  isEmpty?: boolean;
};

export const ThreadViewportShell = forwardRef<HTMLDivElement, ThreadViewportShellProps>(
  ({ className, isEmpty, children, ...rest }, ref) => (
    <div
      ref={ref}
      data-slot="aui_thread-viewport"
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain',
        className,
      )}
      {...rest}
    >
      <div
        className={cn(
          'mx-auto flex w-full min-w-0 max-w-(--thread-max-width) flex-col px-3 pt-3 sm:px-4 sm:pt-4',
          isEmpty ? 'min-h-full justify-center pb-4' : 'pb-32',
        )}
      >
        {children}
      </div>
    </div>
  ),
);
ThreadViewportShell.displayName = 'ThreadViewportShell';

export type ThreadComposerAreaShellProps = ComponentPropsWithRef<'div'> & {
  isEmpty?: boolean;
};

export const ThreadComposerAreaShell = forwardRef<HTMLDivElement, ThreadComposerAreaShellProps>(
  ({ className, isEmpty, ...rest }, ref) => (
    <div
      ref={ref}
      data-slot="aui_thread-composer"
      className={cn(
        'aui-thread-composer bg-primary-bg relative mx-auto flex w-full min-w-0 max-w-(--thread-max-width) shrink-0 flex-col gap-3 px-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:gap-4 sm:px-4 md:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]',
        !isEmpty && 'rounded-t-(--composer-radius)',
        className,
      )}
      {...rest}
    />
  ),
);
ThreadComposerAreaShell.displayName = 'ThreadComposerAreaShell';

export type MessageGroupProps = ComponentPropsWithRef<'div'>;

export const MessageGroup = forwardRef<HTMLDivElement, MessageGroupProps>(({ className, ...rest }, ref) => (
  <div
    ref={ref}
    data-slot="aui_message-group"
    className={cn('flex flex-col gap-y-4 empty:hidden', className)}
    {...rest}
  />
));
MessageGroup.displayName = 'MessageGroup';

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ThreadRootShell: typeof ThreadRootShell;
    ThreadViewportShell: typeof ThreadViewportShell;
    ThreadComposerAreaShell: typeof ThreadComposerAreaShell;
    MessageGroup: typeof MessageGroup;
  }
}
