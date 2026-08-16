import React, { createContext, useContext, useId, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/**
 * Controlled accordion compatible with prior tfy `expanded` / `onChange` slot usage.
 */
export type AccordionProps = {
  expanded?: boolean;
  onChange?: (event: unknown, expanded: boolean) => void;
  children?: ReactNode;
  className?: string;
  background?: string;
  sx?: unknown;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'>;

export function Accordion({
  expanded,
  onChange,
  children,
  className,
  background: _background,
  sx: _sx,
  ...rest
}: AccordionProps) {
  const panelId = useId();

  return (
    <div className={cn('w-full', className)} data-expanded={expanded || undefined} {...rest}>
      {React.Children.map(children, child => {
        if (!React.isValidElement(child)) return child;
        return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
          expanded,
          onChange,
          panelId,
        });
      })}
    </div>
  );
}

export type AccordionSummaryProps = {
  children?: ReactNode;
  className?: string;
  expanded?: boolean;
  onChange?: (event: unknown, expanded: boolean) => void;
  panelId?: string;
  hideIcon?: boolean;
  disableRipple?: boolean;
  sx?: unknown;
};

export function AccordionSummary({ children, className, expanded, onChange, panelId }: AccordionSummaryProps) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={panelId}
      className={cn('flex w-full cursor-pointer items-center text-left', className)}
      onClick={event => onChange?.(event, !expanded)}
    >
      {children}
    </button>
  );
}

export type AccordionDetailsProps = {
  children?: ReactNode;
  className?: string;
  expanded?: boolean;
  panelId?: string;
  sx?: unknown;
};

export function AccordionDetails({ children, className, expanded, panelId }: AccordionDetailsProps) {
  if (!expanded) return null;
  return (
    <div id={panelId} role="region" className={cn(className)}>
      {children}
    </div>
  );
}

type AccordionCtx = {
  openItems: Set<string>;
  toggle: (id: string) => void;
};

const Ctx = createContext<AccordionCtx>({ openItems: new Set(), toggle: () => {} });

export function AccordionRoot({
  type = 'single',
  defaultValue,
  className,
  children,
}: {
  type?: 'single' | 'multiple';
  defaultValue?: string;
  className?: string;
  children?: ReactNode;
}) {
  const [openItems, setOpenItems] = useState<Set<string>>(() => new Set(defaultValue ? [defaultValue] : []));
  const toggle = (id: string) => {
    setOpenItems(prev => {
      const next = new Set(type === 'single' ? [] : prev);
      if (prev.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <Ctx.Provider value={{ openItems, toggle }}>
      <div className={cn('divide-y divide-border', className)}>{children}</div>
    </Ctx.Provider>
  );
}

export function AccordionItem({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children?: ReactNode;
}) {
  const { openItems } = useContext(Ctx);
  return (
    <div className={className} data-open={openItems.has(value) || undefined}>
      {React.Children.map(children, child =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ itemId?: string; isOpen?: boolean }>, {
              itemId: value,
              isOpen: openItems.has(value),
            })
          : child,
      )}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    Accordion: typeof Accordion;
    AccordionSummary: typeof AccordionSummary;
    AccordionDetails: typeof AccordionDetails;
  }
}

export function AccordionTrigger({
  className,
  children,
  itemId,
  isOpen,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { itemId?: string; isOpen?: boolean }) {
  const { toggle } = useContext(Ctx);
  const panelId = itemId ? `aui-accordion-panel-${itemId}` : undefined;
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-controls={panelId}
      className={cn('flex w-full cursor-pointer items-center justify-between py-3 text-sm font-medium', className)}
      onClick={() => itemId && toggle(itemId)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function AccordionContent({
  className,
  children,
  isOpen,
  itemId,
}: {
  className?: string;
  children?: ReactNode;
  isOpen?: boolean;
  itemId?: string;
}) {
  if (!isOpen) return null;
  return (
    <div
      id={itemId ? `aui-accordion-panel-${itemId}` : undefined}
      role="region"
      className={cn('pb-4 text-sm', className)}
    >
      {children}
    </div>
  );
}
