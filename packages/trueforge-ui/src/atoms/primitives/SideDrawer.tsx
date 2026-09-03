'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

import { Icon } from '../../icons/Icon.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useCompactOverlayStyle } from '../lib/useCompactOverlayStyle.js';

export type SideDrawerAnchor = 'left' | 'right';
export type SideDrawerSize = 'sm' | 'md' | 'lg' | 'xl';

export type SideDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  headerIcon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Desktop side; ignored when compact / below `md` (falls back to bottom sheet). */
  anchor?: SideDrawerAnchor;
  /** Desktop width. Defaults to `md`. */
  size?: SideDrawerSize;
  className?: string;
  'aria-label'?: string;
};

const SIZE_WIDTH: Record<SideDrawerSize, string> = {
  sm: 'md:w-80',
  md: 'md:w-[28rem]',
  lg: 'md:w-[36rem]',
  xl: 'md:w-[42rem]',
};

/**
 * Responsive overlay chrome: side drawer on `md+`, bottom sheet below `md`
 * (and always when compact dock/widget layout is active).
 */
export function SideDrawer({
  open,
  onOpenChange,
  title,
  description,
  headerIcon,
  children,
  footer,
  anchor = 'right',
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: SideDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const compact = useCompactLayout();
  const compactStyle = useCompactOverlayStyle(ref, compact);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => onOpenChange(false);
    el.addEventListener('close', handler);
    return () => el.removeEventListener('close', handler);
  }, [onOpenChange]);

  return (
    <dialog
      ref={ref}
      aria-label={ariaLabel ?? title}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Escape still closes via cancel; backdrop click must not (no light-dismiss).
      closedby="closerequest"
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }}
      style={compactStyle}
      className={cn(
        'bg-card-bg text-text-primary border-border open:flex open:flex-col overflow-hidden rounded-none p-0 shadow-xl',
        'backdrop:bg-black/50 backdrop:backdrop-blur-[2px] dark:backdrop:bg-black/70',
        compact
          ? 'm-0 mt-auto h-[min(85dvh,40rem)] w-full max-w-none border-t pb-[env(safe-area-inset-bottom)]'
          : cn(
              // Mobile / narrow: bottom sheet
              'm-0 mt-auto h-[min(85dvh,40rem)] w-full max-w-none border-t pb-[env(safe-area-inset-bottom)]',
              // Desktop: side drawer
              'md:mt-0 md:h-dvh md:max-h-none md:border md:pb-0',
              SIZE_WIDTH[size],
              anchor === 'right'
                ? 'md:ml-auto md:mr-0 md:border-y-0 md:border-r-0'
                : 'md:mr-auto md:ml-0 md:border-y-0 md:border-l-0',
            ),
        className,
      )}
    >
      <header className="bg-topbar-bg flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
        {headerIcon}
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-text-primary text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="text-text-secondary mt-1 text-sm">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close"
          title="Close"
          className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
          onClick={() => onOpenChange(false)}
        >
          <Icon name="xmark" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">{children}</div>
      {footer ? <div className="shrink-0 border-t border-border px-5 py-3">{footer}</div> : null}
    </dialog>
  );
}
