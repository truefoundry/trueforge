import React, { cloneElement, isValidElement, useRef, useState } from 'react';

import { cn } from '../lib/cn.js';

export type TooltipProps = {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
};

export function Tooltip({ content, children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  if (!isValidElement(children)) return children;

  type AnyProps = React.HTMLAttributes<Element>;
  const p = children.props as AnyProps;
  const child = cloneElement(children as React.ReactElement<AnyProps>, {
    onMouseEnter(e: React.MouseEvent<Element>) {
      setVisible(true);
      (p.onMouseEnter as ((e: React.MouseEvent<Element>) => void) | undefined)?.(e);
    },
    onMouseLeave(e: React.MouseEvent<Element>) {
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
  });

  return (
    <span ref={ref} className="relative inline-flex">
      {child}
      {visible && content != null && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2',
            'whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background shadow-md',
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

export type LightTooltipProps = {
  title: React.ReactNode;
  children: React.ReactElement;
  className?: string;
  size?: string;
};

export function LightTooltip({ title, children, className, size: _size }: LightTooltipProps) {
  return (
    <Tooltip content={title} className={className}>
      {children}
    </Tooltip>
  );
}
