'use client';

import React, { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn.js';
import { themePortalRoot } from '../lib/themePortalRoot.js';

const TOOLTIP_VIEWPORT_PAD = 8;
const TOOLTIP_GAP = 6;
/** Grace period to cross the gap between trigger and portaled popup. */
const INTERACTIVE_CLOSE_DELAY_MS = 100;

/** Only one uncontrolled hover tooltip may stay open — avoids stacked/adjacent popups. */
let exclusiveHoverOwner: object | null = null;
let exclusiveHoverClose: (() => void) | null = null;

function claimExclusiveHover(owner: object, close: () => void) {
  if (exclusiveHoverOwner != null && exclusiveHoverOwner !== owner) exclusiveHoverClose?.();
  exclusiveHoverOwner = owner;
  exclusiveHoverClose = close;
}

function releaseExclusiveHover(owner: object) {
  if (exclusiveHoverOwner === owner) {
    exclusiveHoverOwner = null;
    exclusiveHoverClose = null;
  }
}

function interactiveBridgeStyle(side: TooltipSide): React.CSSProperties {
  if (side === 'bottom') return { left: 0, right: 0, top: -TOOLTIP_GAP, height: TOOLTIP_GAP };
  if (side === 'top') return { left: 0, right: 0, bottom: -TOOLTIP_GAP, height: TOOLTIP_GAP };
  if (side === 'right') return { top: 0, bottom: 0, left: -TOOLTIP_GAP, width: TOOLTIP_GAP };
  return { top: 0, bottom: 0, right: -TOOLTIP_GAP, width: TOOLTIP_GAP };
}

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

function isVerticalSide(side: TooltipSide): side is 'top' | 'bottom' {
  return side === 'top' || side === 'bottom';
}

function tooltipTransform(side: TooltipSide): string {
  if (side === 'bottom') return 'translate(-50%, 0)';
  if (side === 'top') return 'translate(-50%, -100%)';
  if (side === 'right') return 'translate(0, -50%)';
  return 'translate(-100%, -50%)';
}

/** `left`/`top` are the desired center and top-edge (bottom) or bottom-edge (top). */
export function clampCenteredTooltip({
  left,
  top,
  width,
  height,
  side,
  viewportWidth,
  viewportHeight,
  pad = TOOLTIP_VIEWPORT_PAD,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  side: 'top' | 'bottom';
  viewportWidth: number;
  viewportHeight: number;
  pad?: number;
}): { top: number; left: number } {
  let nextLeft = left;
  if (width > 0) {
    const half = width / 2;
    const minCenter = pad + half;
    const maxCenter = viewportWidth - pad - half;
    nextLeft = maxCenter < minCenter ? viewportWidth / 2 : Math.min(maxCenter, Math.max(minCenter, left));
  }

  let nextTop = top;
  if (height > 0) {
    if (side === 'bottom') {
      const overflow = top + height - (viewportHeight - pad);
      if (overflow > 0) nextTop = Math.max(pad, top - overflow);
    } else if (top - height < pad) {
      nextTop = pad + height;
    }
  }
  return { top: nextTop, left: nextLeft };
}

/** `left` is the inner edge (right: tooltip start; left: tooltip end). `top` is the vertical center. */
export function clampEdgeTooltip({
  left,
  top,
  width,
  height,
  side,
  viewportWidth,
  viewportHeight,
  pad = TOOLTIP_VIEWPORT_PAD,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  side: 'left' | 'right';
  viewportWidth: number;
  viewportHeight: number;
  pad?: number;
}): { top: number; left: number } {
  let nextTop = top;
  if (height > 0) {
    const half = height / 2;
    nextTop = Math.min(viewportHeight - pad - half, Math.max(pad + half, top));
  }
  let nextLeft = left;
  if (width > 0) {
    nextLeft =
      side === 'right'
        ? Math.min(viewportWidth - pad - width, Math.max(pad, left))
        : Math.min(viewportWidth - pad, Math.max(pad + width, left));
  }
  return { top: nextTop, left: nextLeft };
}

function hasTooltipContent(content: React.ReactNode): boolean {
  if (content == null || content === false) return false;
  if (typeof content === 'string') return content.trim().length > 0;
  return true;
}

export type TooltipAnchor = {
  left: number;
  top: number;
};

export type TooltipProps = {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
  triggerClassName?: string;
  side?: TooltipSide;
  dismissOnClick?: boolean;
  followCursor?: boolean;
  /** When set, tooltip is pinned to these viewport coords instead of the trigger. */
  anchor?: TooltipAnchor | null;
  /** Controls visibility when provided; otherwise hover/focus owns it. */
  open?: boolean;
  /** When true (default) the tooltip stays open while the cursor is inside the popup. */
  interactive?: boolean;
};

export function Tooltip({
  content,
  children,
  className,
  triggerClassName,
  side = 'top',
  dismissOnClick = true,
  followCursor = false,
  anchor = null,
  open,
  interactive = true,
}: TooltipProps) {
  const [uncontrolledVisible, setUncontrolledVisible] = useState(false);
  const visible = open ?? uncontrolledVisible;
  const controlled = open !== undefined;
  const setVisible = (next: boolean) => {
    if (!controlled) setUncontrolledVisible(next);
  };
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerWrapRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const cursorXRef = useRef<number | null>(null);
  const placeRef = useRef<() => void>(() => {});
  // Tracks how many hover regions (trigger + tooltip) are currently entered.
  // The tooltip hides only when this drops to zero after the debounce delay.
  const hoverCountRef = useRef(0);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownerRef = useRef({});
  const dismissRef = useRef(() => {});

  const cancelHide = () => {
    if (leaveTimerRef.current != null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };

  const hide = () => {
    cancelHide();
    hoverCountRef.current = 0;
    releaseExclusiveHover(ownerRef.current);
    setVisible(false);
  };

  dismissRef.current = hide;

  const scheduleHide = () => {
    cancelHide();
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      if (hoverCountRef.current <= 0) hide();
    }, INTERACTIVE_CLOSE_DELAY_MS);
  };

  const show = () => {
    if (!controlled) claimExclusiveHover(ownerRef.current, () => dismissRef.current());
    setVisible(true);
  };

  useEffect(
    () => () => {
      cancelHide();
      releaseExclusiveHover(ownerRef.current);
    },
    [],
  );

  placeRef.current = () => {
    const trigger = triggerWrapRef.current;
    let next: { top: number; left: number } | null = null;
    if (anchor != null) {
      next = {
        top: side === 'bottom' ? anchor.top + TOOLTIP_GAP : anchor.top - TOOLTIP_GAP,
        left: anchor.left,
      };
    } else if (trigger) {
      const rect = trigger.getBoundingClientRect();
      next = isVerticalSide(side)
        ? {
            top: side === 'bottom' ? rect.bottom + TOOLTIP_GAP : rect.top - TOOLTIP_GAP,
            left: followCursor && cursorXRef.current != null ? cursorXRef.current : rect.left + rect.width / 2,
          }
        : {
            top: rect.top + rect.height / 2,
            left: side === 'right' ? rect.right + TOOLTIP_GAP : rect.left - TOOLTIP_GAP,
          };
    }
    if (next == null) return;
    const tooltipEl = tooltipRef.current;
    if (tooltipEl == null) {
      setPos(next);
      return;
    }
    const size = {
      ...next,
      width: tooltipEl.offsetWidth,
      height: tooltipEl.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
    setPos(isVerticalSide(side) ? clampCenteredTooltip({ ...size, side }) : clampEdgeTooltip({ ...size, side }));
  };

  useLayoutEffect(() => {
    if (!visible) {
      setPos(null);
      return;
    }

    const update = () => placeRef.current();
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor, followCursor, visible, side, content]);

  if (!isValidElement(children)) return children;

  type AnyProps = React.HTMLAttributes<Element>;
  const p = children.props as AnyProps;
  const child = cloneElement(children as React.ReactElement<AnyProps>, {
    onMouseEnter(e: React.MouseEvent<Element>) {
      if (followCursor) cursorXRef.current = e.clientX;
      if (interactive) {
        cancelHide();
        hoverCountRef.current += 1;
      }
      show();
      (p.onMouseEnter as ((e: React.MouseEvent<Element>) => void) | undefined)?.(e);
    },
    onMouseMove(e: React.MouseEvent<Element>) {
      if (followCursor && anchor == null) {
        cursorXRef.current = e.clientX;
        placeRef.current();
      }
      (p.onMouseMove as ((e: React.MouseEvent<Element>) => void) | undefined)?.(e);
    },
    onMouseLeave(e: React.MouseEvent<Element>) {
      cursorXRef.current = null;
      if (interactive) {
        hoverCountRef.current = Math.max(0, hoverCountRef.current - 1);
        scheduleHide();
      } else {
        hide();
      }
      (p.onMouseLeave as ((e: React.MouseEvent<Element>) => void) | undefined)?.(e);
    },
    onFocus(e: React.FocusEvent<Element>) {
      show();
      (p.onFocus as ((e: React.FocusEvent<Element>) => void) | undefined)?.(e);
    },
    onBlur(e: React.FocusEvent<Element>) {
      hide();
      (p.onBlur as ((e: React.FocusEvent<Element>) => void) | undefined)?.(e);
    },
    onClick(e: React.MouseEvent<Element>) {
      if (dismissOnClick) hide();
      (p.onClick as ((e: React.MouseEvent<Element>) => void) | undefined)?.(e);
    },
  });

  const tooltip =
    visible && hasTooltipContent(content)
      ? createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              transform: tooltipTransform(side),
              visibility: pos == null ? 'hidden' : undefined,
            }}
            className={cn(
              interactive ? 'pointer-events-auto' : 'pointer-events-none',
              'fixed z-[200] max-w-[calc(100vw-1rem)]',
              'whitespace-nowrap rounded bg-card-bg px-2 py-1 text-xs text-text-primary shadow-md',
              className,
            )}
            onMouseEnter={
              interactive
                ? () => {
                    cancelHide();
                    hoverCountRef.current += 1;
                  }
                : undefined
            }
            onMouseLeave={
              interactive
                ? () => {
                    hoverCountRef.current = Math.max(0, hoverCountRef.current - 1);
                    scheduleHide();
                  }
                : undefined
            }
          >
            {interactive ? (
              <span aria-hidden className="pointer-events-auto absolute" style={interactiveBridgeStyle(side)} />
            ) : null}
            {content}
          </span>,
          themePortalRoot(triggerWrapRef.current),
        )
      : null;

  return (
    <span ref={triggerWrapRef} className={cn('relative inline-flex', triggerClassName)}>
      {child}
      {tooltip}
    </span>
  );
}

export type LightTooltipProps = {
  title: React.ReactNode;
  children: React.ReactElement;
  className?: string;
  triggerClassName?: string;
  size?: string;
  side?: TooltipSide;
  dismissOnClick?: boolean;
  followCursor?: boolean;
  anchor?: TooltipAnchor | null;
  open?: boolean;
  /** When true (default) the tooltip stays open while the cursor is inside the popup. */
  interactive?: boolean;
};

export function LightTooltip({
  title,
  children,
  className,
  triggerClassName,
  size: _size,
  side,
  dismissOnClick,
  followCursor,
  anchor,
  open,
  interactive,
}: LightTooltipProps) {
  return (
    <Tooltip
      content={title}
      className={className}
      triggerClassName={triggerClassName}
      side={side}
      dismissOnClick={dismissOnClick}
      followCursor={followCursor}
      anchor={anchor}
      open={open}
      interactive={interactive}
    >
      {children}
    </Tooltip>
  );
}
