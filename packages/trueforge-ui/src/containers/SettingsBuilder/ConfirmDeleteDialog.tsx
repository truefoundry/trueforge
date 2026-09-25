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

/** Render only while a removal is pending; closing is the caller's `onCancel`. */
const ConfirmDeleteDialog = ({
  title,
  description,
  confirmLabel = 'Remove',
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) => (
  <Dialog
    open
    onOpenChange={next => {
      if (!next) onCancel();
    }}
    aria-label={title}
    className="max-w-md"
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <p className="text-sm text-text-secondary">{description}</p>
      </DialogHeader>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-failure-bg/30 bg-failure-bg/10 px-3 py-2 text-sm text-failure-bg"
        >
          {error}
        </p>
      ) : null}
    </DialogContent>
    <DialogFooter>
      <Button.Secondary type="button" disabled={busy} onClick={onCancel}>
        Cancel
      </Button.Secondary>
      <Button.Destructive type="button" disabled={busy} onClick={onConfirm}>
        {confirmLabel}
      </Button.Destructive>
    </DialogFooter>
  </Dialog>
);

export default ConfirmDeleteDialog;
