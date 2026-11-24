'use client';

import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { Icon } from '../icons/Icon.js';
import type { Artifact } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import type { DraftComposerAction } from './draft/DraftComposerActionsMenu.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { BottomSheet } from './primitives/BottomSheet.js';
import { DropdownMenu, DropdownMenuItem } from './primitives/DropdownMenu.js';
import { Tooltip } from './primitives/Tooltip.js';

/** Saved artifacts the user picked for the next message. */
export type ComposerArtifactAttach = {
  selected: readonly Artifact[];
  onChange: (next: Artifact[]) => void;
  onPickerOpen?: () => void;
  onPickerClose?: () => void;
};

export type ComposerAttachMenuProps = {
  disabled?: boolean;
  label?: string;
  onAttach?: () => void;
  artifactAttach?: ComposerArtifactAttach;
};

// Rest props carry the aria/keyboard wiring DropdownMenu clones onto its trigger.
function PaperclipButton({ label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} className={auiButtonClass({ variant: 'ghost', size: 'icon' })} {...props}>
      <Icon name="paperclip" />
    </button>
  );
}

export function ComposerAttachMenu({ disabled, label = 'Attach', onAttach, artifactAttach }: ComposerAttachMenuProps) {
  const ArtifactPicker = useSlot('ArtifactPicker');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'artifacts'>('menu');

  if (artifactAttach == null) {
    if (onAttach == null) return null;
    return (
      <Tooltip content={label}>
        <PaperclipButton disabled={disabled} label={label} onClick={onAttach} />
      </Tooltip>
    );
  }

  const setMenuOpen = (next: boolean) => {
    setOpen(next);
    if (next) return;
    if (view === 'artifacts') artifactAttach.onPickerClose?.();
    setView('menu');
  };

  return (
    <DropdownMenu
      align="start"
      side="top"
      open={open}
      onOpenChange={setMenuOpen}
      closeOnClick={false}
      className={view === 'artifacts' ? 'w-[17.5rem] p-0' : 'w-56'}
      trigger={<PaperclipButton disabled={disabled} label={label} title={label} />}
    >
      {view === 'menu' ? (
        <>
          {onAttach != null ? (
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false);
                onAttach();
              }}
            >
              <Icon name="file-plus" className="text-text-secondary size-4 shrink-0" />
              <span>Upload from computer</span>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={() => {
              setView('artifacts');
              artifactAttach.onPickerOpen?.();
            }}
          >
            <Icon name="layers" className="text-text-secondary size-4 shrink-0" />
            <span>Add from artifacts</span>
          </DropdownMenuItem>
        </>
      ) : (
        <ArtifactPicker
          selected={artifactAttach.selected}
          onChange={artifactAttach.onChange}
          onDone={() => setMenuOpen(false)}
        />
      )}
    </DropdownMenu>
  );
}

/** Compact layouts route attach actions through a single "+" menu, so the picker opens in a bottom sheet instead. */
export function useArtifactPickerSheet(artifactAttach: ComposerArtifactAttach | undefined): {
  action: DraftComposerAction | null;
  sheet: ReactNode;
} {
  const ArtifactPicker = useSlot('ArtifactPicker');
  const [open, setOpen] = useState(false);
  if (artifactAttach == null) return { action: null, sheet: null };

  const close = () => {
    setOpen(false);
    artifactAttach.onPickerClose?.();
  };

  return {
    action: {
      id: 'attach-artifacts',
      label: 'Add from artifacts',
      icon: 'layers',
      onSelect: () => {
        setOpen(true);
        artifactAttach.onPickerOpen?.();
      },
    },
    sheet: open ? (
      <BottomSheet
        open
        onOpenChange={next => {
          if (!next) close();
        }}
        aria-label="Add from artifacts"
      >
        <ArtifactPicker selected={artifactAttach.selected} onChange={artifactAttach.onChange} onDone={close} />
      </BottomSheet>
    ) : null,
  };
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ComposerAttachMenu: typeof ComposerAttachMenu;
  }
}
