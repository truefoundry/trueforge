'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn.js';
import { themePortalRoot } from '../lib/themePortalRoot.js';

const VIEWPORT_MARGIN_PX = 8;
const PANEL_GAP_PX = 4;
/** Fallback before the panel mounts and can be measured (204×260 Figma agent list). */
const ESTIMATED_PANEL_WIDTH_PX = 204;
const ESTIMATED_PANEL_HEIGHT_PX = 260;

export type DropdownSubmenuProps = {
  /** Trigger row inside the parent menu (usually a menuitem). */
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** Preferred side for the panel; flips when there is not enough room. */
  side?: 'right' | 'left';
};

function clamp({ value, min, max }: { value: number; min: number; max: number }): number {
  return Math.min(Math.max(value, min), max);
}

function resolvePanelPosition({
  triggerRect,
  panelWidth,
  panelHeight,
  preferredSide,
}: {
  triggerRect: DOMRect;
  panelWidth: number;
  panelHeight: number;
  preferredSide: 'right' | 'left';
}): { top: number; left: number } {
  const spaceRight = window.innerWidth - triggerRect.right - VIEWPORT_MARGIN_PX;
  const spaceLeft = triggerRect.left - VIEWPORT_MARGIN_PX;
  const openLeft =
    preferredSide === 'left'
      ? spaceLeft >= panelWidth || spaceLeft >= spaceRight
      : spaceRight < panelWidth && spaceLeft > spaceRight;

  const left = openLeft ? triggerRect.left - PANEL_GAP_PX - panelWidth : triggerRect.right + PANEL_GAP_PX;

  // Prefer aligning to the trigger top; if that clips the bottom, shift up so the panel stays on screen.
  const maxTop = window.innerHeight - VIEWPORT_MARGIN_PX - panelHeight;
  const top = clamp({
    value: triggerRect.top,
    min: VIEWPORT_MARGIN_PX,
    max: Math.max(VIEWPORT_MARGIN_PX, maxTop),
  });

  return {
    top,
    left: clamp({
      value: left,
      min: VIEWPORT_MARGIN_PX,
      max: window.innerWidth - VIEWPORT_MARGIN_PX - panelWidth,
    }),
  };
}

/**
 * Nested panel beside a menu row. Opens on hover/focus/click; stays open until
 * outside click, Escape, or the parent closes it — not on pointer leave.
 */
export function DropdownSubmenu({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  className,
  side = 'right',
}: DropdownSubmenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const openNow = useCallback(() => {
    setOpen(true);
  }, [setOpen]);

  const updatePosition = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const triggerRect = el.getBoundingClientRect();
    const panel = panelRef.current;
    const panelWidth = panel?.offsetWidth || ESTIMATED_PANEL_WIDTH_PX;
    const panelHeight = panel?.offsetHeight || ESTIMATED_PANEL_HEIGHT_PX;
    setPos(
      resolvePanelPosition({
        triggerRect,
        panelWidth,
        panelHeight,
        preferredSide: side,
      }),
    );
  }, [side]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  const panelMounted = open && pos != null;

  // First paint uses an estimate; keep clamping when search results change the panel height.
  useLayoutEffect(() => {
    if (!panelMounted) return;
    const panel = panelRef.current;
    if (panel == null) return;
    updatePosition();
    const observer = new ResizeObserver(() => updatePosition());
    observer.observe(panel);
    return () => observer.disconnect();
  }, [panelMounted, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Capture so a parent menu that stops bubble still closes the submenu.
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open, setOpen]);

  const panel =
    open && pos != null
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="menu"
            style={{ top: pos.top, left: pos.left }}
            className={cn(
              'aui-popup-enter fixed z-[210] flex max-h-[min(20.5rem,calc(100vh-1rem))] min-w-[12.75rem] flex-col overflow-hidden rounded-md border border-border bg-card-bg shadow-md',
              className,
            )}
            onMouseDown={event => event.stopPropagation()}
          >
            {children}
          </div>,
          themePortalRoot(rootRef.current),
        )
      : null;

  return (
    <div ref={rootRef} className="relative" onMouseEnter={openNow} onFocus={openNow}>
      <div
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onKeyDown={event => {
          if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openNow();
          }
          if (event.key === 'ArrowLeft' || event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        {trigger}
      </div>
      {panel}
    </div>
  );
}
