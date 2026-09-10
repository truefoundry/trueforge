'use client';

import {
  cloneElement,
  useCallback,
  useId,
  useState,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
} from 'react';

import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { cn } from '../lib/cn.js';
import { BottomSheet } from './BottomSheet.js';
import { DropdownMenu, type DropdownMenuProps } from './DropdownMenu.js';

type ResponsiveDropdownTriggerProps = {
  'aria-controls'?: string;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'dialog' | 'menu';
  onClick?: MouseEventHandler<HTMLElement>;
};

export type ResponsiveDropdownMenuProps = Omit<DropdownMenuProps, 'children' | 'open' | 'onOpenChange' | 'trigger'> & {
  trigger: ReactElement<ResponsiveDropdownTriggerProps>;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  sheetLabel: string;
  sheetClassName?: string;
};

/**
 * Uses dropdown chrome normally and a container-bound bottom sheet in compact layouts.
 */
export function ResponsiveDropdownMenu({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  sheetLabel,
  sheetClassName,
  containerClassName,
  closeOnClick = true,
  ...dropdownProps
}: ResponsiveDropdownMenuProps) {
  const compact = useCompactLayout();
  const sheetId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );

  if (!compact) {
    return (
      <DropdownMenu
        {...dropdownProps}
        trigger={trigger}
        open={controlledOpen}
        onOpenChange={onOpenChange}
        containerClassName={containerClassName}
        closeOnClick={closeOnClick}
      >
        {children}
      </DropdownMenu>
    );
  }

  const triggerElement = cloneElement(trigger, {
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? sheetId : undefined,
    onClick: event => {
      trigger.props.onClick?.(event);
      if (!event.defaultPrevented) setOpen(!open);
    },
  });

  return (
    <div className={cn('relative inline-flex', containerClassName)}>
      {triggerElement}
      {open ? (
        <BottomSheet id={sheetId} open onOpenChange={setOpen} aria-label={sheetLabel} className={sheetClassName}>
          <div
            className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
            onClick={closeOnClick ? () => setOpen(false) : undefined}
          >
            {children}
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}
