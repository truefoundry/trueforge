'use client';

import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';

import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { cn } from '../lib/cn.js';
import { useCompactOverlayStyle } from '../lib/useCompactOverlayStyle.js';

export type BottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  id?: string;
  'aria-label': string;
};

export function BottomSheet({
  open,
  onOpenChange,
  children,
  className,
  id,
  'aria-label': ariaLabel,
}: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const compact = useCompactLayout();
  const compactStyle = useCompactOverlayStyle(ref, compact);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => onOpenChange(false);
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onOpenChange]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === ref.current) onOpenChange(false);
  };

  return (
    <dialog
      ref={ref}
      id={id}
      aria-label={ariaLabel}
      onClick={handleBackdropClick}
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }}
      style={compactStyle ?? { height: 'min(70dvh, 30rem)', maxHeight: '85dvh' }}
      className={cn(
        'aui-bottom-sheet bg-card-bg text-text-primary m-0 mt-auto w-full max-w-none overflow-hidden rounded-t-xl border border-b-0 border-border p-0 pb-[env(safe-area-inset-bottom)] shadow-xl',
        'backdrop:bg-[var(--overlay)] backdrop:backdrop-blur-[2px]',
        'open:flex open:flex-col',
        className,
      )}
    >
      <div className="flex h-5 shrink-0 items-center justify-center" aria-hidden>
        <span className="h-1 w-10 rounded-full bg-text-secondary/30" />
      </div>
      {children}
    </dialog>
  );
}
