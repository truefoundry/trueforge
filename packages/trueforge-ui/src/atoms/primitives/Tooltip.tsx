'use client';

import React, { cloneElement, isValidElement, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn.js';

// Keep portaled chrome under ThemeProvider so preset/custom CSS vars still apply.
function themePortalRoot(from: HTMLElement | null): HTMLElement {
  // A native <dialog> opened with showModal() renders in the top layer, above any
  // z-index. When the trigger lives inside one, portal into the dialog so the
  // tooltip joins the top layer instead of rendering behind the modal.
  const dialog = from?.closest('dialog');
  if (dialog instanceof HTMLElement) return dialog;
  return from?.closest('.aui-theme-root') ?? document.body;
}

export type TooltipProps = {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
  triggerClassName?: string;
  side?: 'top' | 'bottom';
  dismissOnClick?: boolean;
  followCursor?: boolean;
};

export function Tooltip({
  content,
  children,
  className,
  triggerClassName,
  side = 'top',
  dismissOnClick = true,
  followCursor = false,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerWrapRef = useRef<HTMLSpanElement>(null);
  const cursorXRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!visible) {
      setPos(null);
      return;
    }

    const update = () => {
      const el = triggerWrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({
        top: side === 'bottom' ? rect.bottom + 6 : rect.top - 6,
        left: followCursor && cursorXRef.current != null ? cursorXRef.current : rect.left + rect.width / 2,
      });
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [followCursor, visible, side]);

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
      if (followCursor) {
        cursorXRef.current = e.clientX;
        const el = triggerWrapRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          setPos({
            top: side === 'bottom' ? rect.bottom + 6 : rect.top - 6,
            left: e.clientX,
          });
        }
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
    visible && content != null && pos != null
      ? createPortal(
          <span
            role="tooltip"
            style={{
              top: pos.top,
              left: pos.left,
              transform: side === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            }}
            className={cn(
              'pointer-events-none fixed z-[200]',
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
}: LightTooltipProps) {
  return (
    <Tooltip
      content={title}
      className={className}
      triggerClassName={triggerClassName}
      side={side}
      dismissOnClick={dismissOnClick}
      followCursor={followCursor}
    >
      {children}
    </Tooltip>
  );
}
