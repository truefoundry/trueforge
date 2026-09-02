'use client';

import React, { cloneElement, isValidElement, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn.js';
import { themePortalRoot } from '../lib/themePortalRoot.js';

const TOOLTIP_VIEWPORT_PAD = 8;

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
  side?: 'top' | 'bottom';
  dismissOnClick?: boolean;
  followCursor?: boolean;
  /** When set, tooltip is pinned to these viewport coords instead of the trigger. */
  anchor?: TooltipAnchor | null;
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
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerWrapRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const cursorXRef = useRef<number | null>(null);
  const placeRef = useRef<() => void>(() => {});

  placeRef.current = () => {
    const trigger = triggerWrapRef.current;
    let next: { top: number; left: number } | null = null;
    if (anchor != null) {
      next = { top: side === 'bottom' ? anchor.top + 6 : anchor.top - 6, left: anchor.left };
    } else if (trigger) {
      const rect = trigger.getBoundingClientRect();
      next = {
        top: side === 'bottom' ? rect.bottom + 6 : rect.top - 6,
        left: followCursor && cursorXRef.current != null ? cursorXRef.current : rect.left + rect.width / 2,
      };
    }
    if (next == null) return;
    const tooltipEl = tooltipRef.current;
    setPos(
      tooltipEl
        ? clampCenteredTooltip({
            ...next,
            width: tooltipEl.offsetWidth,
            height: tooltipEl.offsetHeight,
            side,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          })
        : next,
    );
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
      setVisible(true);
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
      setVisible(false);
      (p.onMouseLeave as ((e: React.MouseEvent<Element>) => void) | undefined)?.(e);
    },
    onFocus(e: React.FocusEvent<Element>) {
      setVisible(true);
      (p.onFocus as ((e: React.FocusEvent<Element>) => void) | undefined)?.(e);
    },
    onBlur(e: React.FocusEvent<Element>) {
      setVisible(false);
      (p.onBlur as ((e: React.FocusEvent<Element>) => void) | undefined)?.(e);
    },
    onClick(e: React.MouseEvent<Element>) {
      if (dismissOnClick) setVisible(false);
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
              transform: side === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
              visibility: pos == null ? 'hidden' : undefined,
            }}
            className={cn(
              'pointer-events-none fixed z-[200] max-w-[calc(100vw-1rem)]',
              'whitespace-nowrap rounded bg-card-bg px-2 py-1 text-xs text-text-primary shadow-md',
              className,
            )}
          >
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
  side?: 'top' | 'bottom';
  dismissOnClick?: boolean;
  followCursor?: boolean;
  anchor?: TooltipAnchor | null;
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
    >
      {children}
    </Tooltip>
  );
}
