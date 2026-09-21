'use client';

import { useEffect, useRef, useState } from 'react';

import { auiInputClass } from './lib/inputClasses.js';
import { MAX_SESSION_TITLE_LENGTH } from './lib/threadListMeta.js';
import { Button } from './primitives/Button.js';
import { CenteredModal } from './primitives/CenteredModal.js';

export type RenameSessionModalProps = {
  open: boolean;
  initialTitle: string;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (title: string) => void;
};

/** Compact rename dialog: title field + Cancel / Save. */
export function RenameSessionModal({
  open,
  initialTitle,
  saving = false,
  onOpenChange,
  onSave,
}: RenameSessionModalProps) {
  const [value, setValue] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setValue(initialTitle);
  }, [open, initialTitle]);

  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (input == null) return;
    input.focus();
    input.select();
  }, [open]);

  const trimmed = value.trim();
  const isValid = trimmed.length > 0 && trimmed.length <= MAX_SESSION_TITLE_LENGTH;
  const canSave = isValid && !saving;

  const handleSave = () => {
    if (!canSave) return;
    onSave(trimmed);
  };

  const handleOpenChange = (next: boolean) => {
    if (saving) return;
    onOpenChange(next);
  };

  return (
    <CenteredModal
      open={open}
      onOpenChange={handleOpenChange}
      title="Rename session"
      contentSized
      aria-label="Rename session"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button.Secondary type="button" disabled={saving} onClick={() => handleOpenChange(false)}>
            Cancel
          </Button.Secondary>
          <Button.Primary type="button" disabled={!canSave} onClick={handleSave}>
            Save
          </Button.Primary>
        </div>
      }
    >
      <div className="px-5 py-4">
        <input
          ref={inputRef}
          aria-label="Session title"
          value={value}
          readOnly={saving}
          maxLength={MAX_SESSION_TITLE_LENGTH}
          className={auiInputClass('h-9')}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleSave();
            }
          }}
        />
      </div>
    </CenteredModal>
  );
}
