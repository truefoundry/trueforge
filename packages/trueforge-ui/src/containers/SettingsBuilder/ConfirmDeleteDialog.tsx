'use client';

import type { ReactNode } from 'react';

import { Button } from '@/atoms/primitives/Button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/atoms/primitives/Dialog.js';

export type ConfirmDeleteDialogProps = {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  /** Kept in the dialog: a rejected delete explains which agents still use the entry. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

/** "Remove skill?" → "Can't remove skill" so a refused delete is not another confirm. */
function refusedTitle(title: string): string {
  return title.replace(/\?$/, '').replace(/^Remove /i, "Can't remove ");
}

/** Render only while a removal is pending; closing is the caller's `onCancel`. */
const ConfirmDeleteDialog = ({
  title,
  description,
  confirmLabel = 'Remove',
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) => {
  const refused = error != null && error !== '';
  const heading = refused ? refusedTitle(title) : title;

  return (
    <Dialog
      open
      onOpenChange={next => {
        if (!next) onCancel();
      }}
      aria-label={heading}
      className="max-w-md"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          {refused ? (
            <p role="alert" className="text-sm text-failure-bg">
              {error}
            </p>
          ) : (
            <p className="text-sm text-text-secondary">{description}</p>
          )}
        </DialogHeader>
      </DialogContent>
      <DialogFooter>
        {refused ? (
          <Button.Secondary type="button" onClick={onCancel}>
            Close
          </Button.Secondary>
        ) : (
          <>
            <Button.Secondary type="button" disabled={busy} onClick={onCancel}>
              Cancel
            </Button.Secondary>
            <Button.Destructive type="button" disabled={busy} onClick={onConfirm}>
              {confirmLabel}
            </Button.Destructive>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
};

export default ConfirmDeleteDialog;
