'use client';

import { Icon } from '../../icons/Icon.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { DropdownMenu, DropdownMenuItem } from '../primitives/DropdownMenu.js';

export type DraftComposerAction = {
  id: string;
  label: string;
  icon: string;
  onSelect: () => void;
};

export type DraftComposerActionsMenuProps = {
  actions: DraftComposerAction[];
  disabled?: boolean;
};

export function DraftComposerActionsMenu({ actions, disabled }: DraftComposerActionsMenuProps) {
  if (actions.length === 0) return null;

  return (
    <DropdownMenu
      align="start"
      side="top"
      className="w-48"
      trigger={
        <button
          type="button"
          aria-label="Add"
          title="Add"
          disabled={disabled}
          className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-8 rounded-full' })}
        >
          <Icon name="plus" className="size-4" />
        </button>
      }
    >
      {actions.map(action => (
        <DropdownMenuItem key={action.id} onClick={action.onSelect}>
          <Icon name={action.icon} className="text-text-secondary size-4 shrink-0" />
          <span>{action.label}</span>
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    DraftComposerActionsMenu: typeof DraftComposerActionsMenu;
  }
}
