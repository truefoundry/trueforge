'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn.js';
import { themePortalRoot } from '../lib/themePortalRoot.js';

export type DropdownMenuProps = {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  className?: string;
  containerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  closeOnClick?: boolean;
};

export function DropdownMenu({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  className,
  containerClassName,
  open: controlledOpen,
  onOpenChange,
  closeOnClick = true,
}: DropdownMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusedOpenRef = useRef(false);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }

    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({
        top: side === 'top' ? rect.top - 4 : rect.bottom + 4,
        left: align === 'end' ? rect.right : rect.left,
      });
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, align, side]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Menu mounts only after `pos` is set; focus once per open, not on every scroll/resize pos rewrite.
  useEffect(() => {
    if (!open) {
      focusedOpenRef.current = false;
      return;
    }
    if (pos == null || focusedOpenRef.current) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
    focusedOpenRef.current = true;
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        const triggerBtn = containerRef.current?.querySelector<HTMLElement>("[aria-haspopup='menu']");
        triggerBtn?.focus();
        return;
      }

      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
        return;
      }

      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
      );
      if (items.length === 0) return;

      e.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      let nextIndex = currentIndex;
      if (e.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
      else if (e.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
      else if (e.key === 'Home') nextIndex = 0;
      else if (e.key === 'End') nextIndex = items.length - 1;
      items[nextIndex]?.focus();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const triggerEl = React.isValidElement(trigger)
    ? React.cloneElement(trigger as React.ReactElement<Record<string, unknown>>, {
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        onKeyDown: (e: React.KeyboardEvent) => {
          const existing = (trigger as React.ReactElement<{ onKeyDown?: (ev: React.KeyboardEvent) => void }>).props
            .onKeyDown;
          existing?.(e);
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        },
      })
    : trigger;

  const menu =
    open && pos != null
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            style={{
              top: pos.top,
              left: pos.left,
              transform:
                [align === 'end' ? 'translateX(-100%)' : null, side === 'top' ? 'translateY(-100%)' : null]
                  .filter(value => value !== null)
                  .join(' ') || undefined,
            }}
            className={cn(
              'fixed z-[200] flex min-w-[8rem] flex-col rounded-md border border-border bg-card-bg p-1',
              'text-text-primary shadow-md',
              className,
            )}
            onMouseDown={event => event.stopPropagation()}
            onClick={closeOnClick ? () => setOpen(false) : undefined}
          >
            {children}
          </div>,
          themePortalRoot(containerRef.current),
        )
      : null;

  return (
    <div ref={containerRef} className={cn('relative inline-flex', containerClassName)}>
      <div className="contents" onClick={() => setOpen(!open)}>
        {triggerEl}
      </div>
      {menu}
    </div>
  );
}

export type DropdownMenuItemProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function DropdownMenuItem({ className, ...props }: DropdownMenuItemProps) {
  return (
    <button
      role="menuitem"
      type="button"
      className={cn(
        'flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
        // focus-visible only: open-menu auto-focus must not look like a stuck hover/selected row.
        'transition-colors hover:bg-ghost-button-hover',
        'focus-visible:bg-dropdown-selected-item-bg focus-visible:text-dropdown-selected-item-text',
        'aria-selected:bg-dropdown-selected-item-bg aria-selected:text-dropdown-selected-item-text',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export type DropdownMenuSeparatorProps = React.HTMLAttributes<HTMLDivElement>;

export function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return <div role="separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
