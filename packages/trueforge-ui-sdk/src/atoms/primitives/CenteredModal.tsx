'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

import { Icon } from '../../icons/Icon.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useCompactOverlayStyle } from '../lib/useCompactOverlayStyle.js';

export type CenteredModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  headerIcon?: ReactNode;
  children: ReactNode;
  className?: string;
  contentSized?: boolean;
  'aria-label'?: string;
};

/**
 * Responsive modal chrome: centered dialog on `md+`, bottom sheet below `md`.
 * One content tree for both breakpoints (native `<dialog>`).
 */
export function CenteredModal({
  open,
  onOpenChange,
  title,
  description,
  headerIcon,
  children,
  className,
  contentSized = false,
  'aria-label': ariaLabel,
}: CenteredModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const compact = useCompactLayout();
  const compactStyle = useCompactOverlayStyle(ref, compact, contentSized);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
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
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }}
      style={compactStyle ?? (contentSized ? { height: 'fit-content', maxHeight: '85dvh' } : undefined)}
      className={cn(
        'bg-card-bg text-text-primary border-border open:flex open:flex-col overflow-hidden p-0 shadow-xl',
        'backdrop:bg-black/50 backdrop:backdrop-blur-[2px] dark:backdrop:bg-black/70',
        compact
          ? 'm-0 mt-auto max-w-none rounded-t-xl rounded-b-none border-t pb-[env(safe-area-inset-bottom)]'
          : contentSized
            ? 'm-0 mt-auto h-auto max-h-[85dvh] w-full max-w-none rounded-t-xl rounded-b-none border-t pb-[env(safe-area-inset-bottom)] md:m-auto md:h-auto md:w-[min(28rem,calc(100%-3rem))] md:max-w-md md:rounded-xl md:border md:pb-0'
            : cn(
                // Mobile: bottom sheet
                'm-0 mt-auto h-[min(85dvh,40rem)] w-full max-w-none rounded-t-xl rounded-b-none border-t pb-[env(safe-area-inset-bottom)]',
                // Desktop: large centered modal (MCP-tools inspired)
                'md:m-auto md:h-[min(80dvh,40rem)] md:w-[min(72rem,calc(100%-3rem))] md:max-w-5xl md:rounded-xl md:border md:pb-0',
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
    </dialog>
  );
}
