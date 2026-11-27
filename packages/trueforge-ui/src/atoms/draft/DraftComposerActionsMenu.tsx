'use client';

import { useState, type ReactNode } from 'react';

import { Icon } from '../../icons/Icon.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { DropdownMenuItem } from '../primitives/DropdownMenu.js';
import { DropdownSubmenu } from '../primitives/DropdownSubmenu.js';
import { ResponsiveDropdownMenu } from '../primitives/ResponsiveDropdownMenu.js';

export type DraftComposerAction = {
  id: string;
  label: string;
  icon: string;
  /** Flat actions run on click; submenu rows run when their panel opens. */
  onSelect?: () => void;
  /** Nested panel. It mounts only while open, so its local state resets on every open. */
  submenu?: ReactNode;
};

export type DraftComposerActionsMenuProps = {
  actions: DraftComposerAction[];
  disabled?: boolean;
  /** Omit to let the menu manage its own open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

// Shared width for every nested panel, so Connectors, Skills, and Environment line up.
const SUBMENU_PANEL_CLASS = 'w-[21rem] max-w-[min(21rem,calc(100vw-2rem))]';

const PLUS_BUTTON_CLASS = auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-8 rounded-full' });

function ActionLabel({ action }: { action: DraftComposerAction }) {
  return (
    <>
      <Icon name={action.icon} className="text-text-secondary size-4 shrink-0" />
      <span>{action.label}</span>
    </>
  );
}

/**
 * Plus menu for the composer. Flat actions close the menu on click; submenu rows
 * open a nested panel on desktop and drill into it inside the compact bottom sheet.
 */
export function DraftComposerActionsMenu({
  actions,
  disabled,
  open: openProp,
  onOpenChange,
}: DraftComposerActionsMenuProps) {
  const compact = useCompactLayout();
  const [internalOpen, setInternalOpen] = useState(false);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [drilledId, setDrilledId] = useState<string | null>(null);
  const open = openProp ?? internalOpen;

  if (actions.length === 0) return null;

  // One flat action needs no menu: the plus button runs it directly.
  const [onlyAction] = actions;
  if (onlyAction != null && actions.length === 1 && onlyAction.submenu == null) {
    return (
      <button
        type="button"
        aria-label={onlyAction.label}
        title={onlyAction.label}
        disabled={disabled}
        className={PLUS_BUTTON_CLASS}
        onClick={onlyAction.onSelect}
      >
        <Icon name="plus" className="size-4" />
      </button>
    );
  }

  // Resetting nested state on close keeps the next open from showing a stale panel.
  const handleOpenChange = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next);
    if (!next) {
      setOpenSubmenuId(null);
      setDrilledId(null);
    }
    onOpenChange?.(next);
  };

  const setSubmenuOpen = (action: DraftComposerAction, next: boolean) => {
    setOpenSubmenuId(next ? action.id : null);
    if (next && openSubmenuId !== action.id) action.onSelect?.();
  };

  const drilled = compact ? actions.find(action => action.id === drilledId && action.submenu != null) : undefined;

  const renderRow = (action: DraftComposerAction) => {
    if (action.submenu == null) {
      return (
        <DropdownMenuItem
          key={action.id}
          onClick={() => {
            action.onSelect?.();
            handleOpenChange(false);
          }}
        >
          <ActionLabel action={action} />
        </DropdownMenuItem>
      );
    }
    if (compact) {
      return (
        <DropdownMenuItem
          key={action.id}
          aria-haspopup="menu"
          onClick={() => {
            setDrilledId(action.id);
            action.onSelect?.();
          }}
        >
          <ActionLabel action={action} />
          <Icon name="chevron-right" className="text-text-secondary ml-auto size-3.5 shrink-0" />
        </DropdownMenuItem>
      );
    }
    const submenuOpen = openSubmenuId === action.id;
    return (
      <DropdownSubmenu
        key={action.id}
        open={submenuOpen}
        onOpenChange={next => setSubmenuOpen(action, next)}
        className={SUBMENU_PANEL_CLASS}
        trigger={
          <DropdownMenuItem aria-expanded={submenuOpen}>
            <ActionLabel action={action} />
            <Icon name="chevron-right" className="text-text-secondary ml-auto size-3.5 shrink-0" />
          </DropdownMenuItem>
        }
      >
        {action.submenu}
      </DropdownSubmenu>
    );
  };

  const body =
    drilled?.submenu != null ? (
      <>
        <DropdownMenuItem onClick={() => setDrilledId(null)}>
          <Icon name="chevron-left" className="text-text-secondary size-4 shrink-0" />
          <span>Back</span>
        </DropdownMenuItem>
        {drilled.submenu}
      </>
    ) : (
      actions.map(renderRow)
    );

  return (
    <ResponsiveDropdownMenu
      align="start"
      side="top"
      className="w-48"
      sheetLabel="Add to composer"
      open={open}
      onOpenChange={handleOpenChange}
      closeOnClick={false}
      trigger={
        <button type="button" aria-label="Add" title="Add" disabled={disabled} className={PLUS_BUTTON_CLASS}>
          <Icon name="plus" className="size-4" />
        </button>
      }
    >
      {body}
    </ResponsiveDropdownMenu>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    DraftComposerActionsMenu: typeof DraftComposerActionsMenu;
  }
}
