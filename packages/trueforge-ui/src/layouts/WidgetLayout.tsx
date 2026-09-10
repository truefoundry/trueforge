'use client';

import { useEffect, useRef } from 'react';

import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { CompactLayoutProvider } from '../atoms/lib/CompactLayoutContext.js';
import { Icon } from '../icons/Icon.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { StackChatPanel } from './StackChatPanel.js';
import { useWidgetVisibility } from './WidgetVisibilityContext.js';

/** FAB-anchored panel with the same list ↔ thread stack as `dock`. */
export function WidgetLayout({ className }: { className?: string }) {
  const BrandLogo = useSlot('BrandLogo');
  const { open, setOpen } = useWidgetVisibility();
  const fabRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dialogRef.current?.querySelector('dialog[open]')) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      dialogRef.current?.focus();
      return;
    }
    if (wasOpen.current) {
      fabRef.current?.focus();
      wasOpen.current = false;
    }
  }, [open]);

  return (
    <div className={cn('pointer-events-none relative h-full min-h-0 w-full', className)}>
      {open ? (
        <div
          ref={dialogRef}
          data-aui-compact-layout
          className="pointer-events-auto absolute right-[max(1.25rem,env(safe-area-inset-right,0px))] bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-[19] flex h-[min(560px,calc(100%-6.5rem-env(safe-area-inset-bottom,0px)))] max-h-[calc(100%-6.5rem)] w-[min(380px,calc(100%-2.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-primary-bg shadow-[0_16px_48px_color-mix(in_oklab,var(--shadow-color)_14%,transparent)] outline-none"
          role="dialog"
          aria-modal={true}
          aria-label="Chat"
          tabIndex={-1}
        >
          <CompactLayoutProvider>
            <StackChatPanel
              threadHeaderEnd={
                <button
                  type="button"
                  aria-label="Close"
                  title="Close"
                  className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                  onClick={() => setOpen(false)}
                >
                  <Icon name="xmark" />
                </button>
              }
            />
          </CompactLayoutProvider>
        </div>
      ) : null}
      {/* Native FAB: inline colors beat host unlayered Tailwind (SDK utilities are layered). */}
      <button
        ref={fabRef}
        type="button"
        className="pointer-events-auto absolute right-[max(1.25rem,env(safe-area-inset-right,0px))] bottom-[max(1.25rem,env(safe-area-inset-bottom,0px))] z-20 flex size-14 cursor-pointer items-center justify-center rounded-full text-sm font-medium shadow-[0_8px_24px_color-mix(in_oklab,var(--primary-button-bg)_45%,transparent)]"
        style={{
          backgroundColor: 'var(--primary-button-bg)',
          color: 'var(--primary-button-text)',
        }}
        aria-expanded={open}
        aria-label={open ? 'Close chat' : 'Open chat'}
        onClick={() => setOpen(v => !v)}
      >
        {open ? (
          <span aria-hidden className="text-xl leading-none">
            ×
          </span>
        ) : (
          <BrandLogo variant="icon" className="size-6" />
        )}
      </button>
    </div>
  );
}
