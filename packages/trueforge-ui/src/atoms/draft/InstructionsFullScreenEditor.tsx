'use client';

import { Icon } from '../../icons/Icon.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { Dialog } from '../primitives/Dialog.js';

export type InstructionsFullScreenEditorProps = {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
};

export function InstructionsFullScreenEditor({ open, value, onChange, onClose }: InstructionsFullScreenEditorProps) {
  const InstructionsMarkdownEditor = useSlot('InstructionsMarkdownEditor');
  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => !nextOpen && onClose()}
      aria-label="Edit instructions full screen"
      className="h-[calc(100dvh-2rem)] max-h-none w-[calc(100vw-2rem)] max-w-none"
    >
      {open ? (
        <>
          <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-2">
            <h2 className="text-text-primary text-sm font-semibold">Agent instructions</h2>
            <button
              type="button"
              aria-label="Exit full screen"
              title="Exit full screen"
              className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7' })}
              onClick={onClose}
            >
              <Icon name="compress" className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <InstructionsMarkdownEditor value={value} onChange={onChange} height="100%" />
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    InstructionsFullScreenEditor: typeof InstructionsFullScreenEditor;
  }
}
