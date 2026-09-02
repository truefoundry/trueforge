'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';

import { Icon } from '../icons/Icon.js';
import { Button } from './primitives/Button.js';
import { Dialog, DialogContent } from './primitives/Dialog.js';

export type AttachmentPreviewDialogProps = {
  previewSrc?: string;
  children: ReactNode;
};

export function AttachmentPreviewDialog({ previewSrc, children }: AttachmentPreviewDialogProps) {
  const [open, setOpen] = useState(false);

  if (!previewSrc) return <>{children}</>;

  return (
    <>
      <Button.Ghost
        type="button"
        aria-label="Open attachment preview"
        onClick={() => setOpen(true)}
        className="block h-auto max-w-full border-0 bg-transparent p-0 text-left shadow-none hover:bg-transparent"
      >
        {children}
      </Button.Ghost>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        aria-label="Attachment preview"
        className="max-w-[calc(100%-2rem)] sm:max-w-3xl"
      >
        <DialogContent className="relative p-2">
          <span className="absolute top-2 right-2 z-10 inline-flex">
            <Button.Ghost
              type="button"
              aria-label="Close"
              title="Close"
              size="small"
              className="aspect-square px-0"
              onClick={() => setOpen(false)}
            >
              <Icon name="xmark" />
            </Button.Ghost>
          </span>
          <div className="bg-primary-bg relative mx-auto flex max-h-[80dvh] w-full items-center justify-center overflow-hidden">
            <img
              src={previewSrc}
              alt="Attachment preview"
              className="block h-auto max-h-[80vh] w-auto max-w-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AttachmentPreviewDialog: typeof AttachmentPreviewDialog;
  }
}
