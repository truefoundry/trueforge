'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';

export type ToastProps = {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: 'error' | 'success';
  className?: string;
};

export function Toast({ title, description, open, onOpenChange, variant = 'error', className }: ToastProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = `${title}\n${description}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard can fail in insecure contexts; toast still usable
    }
  }, [title, description]);

  if (!open) return null;

  return (
    <div
      role="alert"
      className={cn(
        'font-sans-flex bg-primary-bg text-text-primary pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-border px-4 py-4 shadow-md dark:bg-card-bg',
        'animate-in fade-in-0 slide-in-from-bottom-4',
        className,
      )}
    >
      <Icon
        name={variant === 'success' ? 'circle-check' : 'circle-exclamation'}
        size="1.25em"
        className={cn('shrink-0', variant === 'success' ? 'text-success-bg' : 'text-failure-bg')}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div
            className={cn(
              'text-sm leading-none font-semibold',
              variant === 'success' ? 'text-success-bg' : 'text-failure-bg',
            )}
          >
            {title}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {variant === 'error' ? (
              <button
                type="button"
                aria-label="Copy"
                title="Copy"
                className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                onClick={handleCopy}
              >
                <Icon name={copied ? 'check' : 'clone'} />
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Close"
              title="Close"
              className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
              onClick={() => onOpenChange(false)}
            >
              <Icon name="xmark" />
            </button>
          </div>
        </div>
        {description ? (
          <div className="text-text-secondary mt-1 max-h-24 overflow-y-auto text-sm leading-snug break-words whitespace-pre-wrap">
            {description}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type ToastStackProps = {
  children: ReactNode;
  duration?: number;
};

const openToastStack = (element: HTMLDivElement | null): void => {
  if (element === null) return;
  try {
    if (typeof element.showPopover !== 'function') return;
    if (element.matches(':popover-open')) element.hidePopover();
    element.showPopover();
  } catch {
    // Popover APIs can reject during attachment; the fixed stack remains usable.
  }
};

export function ToastStack({ children, duration: _duration = Number.POSITIVE_INFINITY }: ToastStackProps) {
  const stack = (
    <div
      ref={openToastStack}
      popover="manual"
      className="pointer-events-none fixed inset-auto right-4 bottom-4 z-50 m-0 flex w-[calc(100vw-2rem)] max-w-md flex-col-reverse gap-2 overflow-visible bg-transparent"
    >
      {children}
    </div>
  );

  if (typeof document === 'undefined') return stack;
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  const activeDialog = dialogs.item(dialogs.length - 1);
  return activeDialog === null ? stack : createPortal(stack, activeDialog);
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    Toast: typeof Toast;
    ToastStack: typeof ToastStack;
  }
}
