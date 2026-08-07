'use client';

import { ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { useTrueFoundryCancel } from '@truefoundry/assistant-ui-runtime';
import { useRef } from 'react';

import { DraftCatalogProvider } from '../atoms/draft/DraftCatalogProvider.js';
import { useComposerBusyState } from '../hooks/useComposerBusyState.js';
import { useComposerPauseView } from '../hooks/useComposerPauseView.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { defaultSlots } from '../theme/defaultSlots.js';
import { SlotsProvider, useSlot } from '../theme/SlotsProvider.js';
import { AskUserContainer } from './AskUserContainer.js';
import { ComposerAttachmentsContainer } from './AttachmentsContainer.js';
import { McpAuthContainer } from './McpAuthContainer.js';

export type ComposerContainerProps = {
  placeholder?: string;
};

/**
 * Use draft UI only when the host did not override the slot.
 * Example: host overrides LeftSection → keep host; else → DraftComposerLeftSection.
 */
function preferHostSlotOverride<T>(parentSlot: T, stockDefault: T, draftDefault: T): T {
  return parentSlot === stockDefault ? draftDefault : parentSlot;
}

function ComposerBody({ placeholder }: { placeholder: string }) {
  const ComposerShell = useSlot('ComposerShell');
  const aui = useAui();
  const hasText = useAuiState(s => s.composer.text.trim().length > 0);
  const { isBusy, send, resetBusy } = useComposerBusyState();
  const cancel = useTrueFoundryCancel();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submit = () => send(() => aui.composer().send());

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={event => {
          const files = event.target.files;
          if (files) {
            for (const file of files) {
              void aui.composer().addAttachment(file);
            }
          }
          event.target.value = '';
        }}
      />
      <ComposerPrimitive.AttachmentDropzone
        disabled={isBusy}
        data-slot="aui_composer-attachment-dropzone"
        className="w-full rounded-[var(--composer-radius,1.5rem)] transition-[box-shadow] data-[dragging=true]:ring-ring/20 data-[dragging=true]:ring-3"
      >
        <ComposerPrimitive.Root
          data-slot="aui_composer-root"
          className="w-full"
          onSubmit={event => {
            // Suppresses the primitive's own send so submits route through the busy-state wrapper.
            event.preventDefault();
            submit();
          }}
        >
          <ComposerShell
            attachments={<ComposerAttachmentsContainer />}
            input={
              <ComposerPrimitive.Input
                data-slot="aui_composer-input"
                placeholder={placeholder}
                disabled={isBusy}
                submitMode="enter"
                aria-label="Message input"
                className="text-foreground placeholder:text-muted-foreground/80 max-h-[10lh] min-h-10 w-full resize-none overflow-y-auto rounded-lg border-none bg-transparent px-1 py-1 text-base leading-normal shadow-none outline-none"
              />
            }
            disabled={isBusy}
            canSubmit={!isBusy && hasText}
            isRunning={isBusy}
            onSubmit={submit}
            onCancel={() => {
              resetBusy();
              void cancel();
            }}
            onAttach={() => fileInputRef.current?.click()}
          />
        </ComposerPrimitive.Root>
      </ComposerPrimitive.AttachmentDropzone>
    </>
  );
}

export function ComposerContainer({
  placeholder = 'Ask anything... (Shift+Enter for new line)',
}: ComposerContainerProps) {
  const pauseView = useComposerPauseView();
  const shell = useOptionalShellMode();
  const parentLeftSection = useSlot('ComposerLeftSection');
  const parentRightSection = useSlot('ComposerRightSection');
  const DraftComposerLeftSection = useSlot('DraftComposerLeftSection');
  const DraftComposerRightSection = useSlot('DraftComposerRightSection');
  const canMutateSpec = shell?.mode.status === 'active' && shell.mode.isMutable;

  if (pauseView.kind === 'mcp') {
    return <McpAuthContainer />;
  }
  if (pauseView.kind === 'ask-user') {
    return <AskUserContainer />;
  }

  if (canMutateSpec) {
    return (
      <DraftCatalogProvider>
        <SlotsProvider
          overrides={{
            ComposerLeftSection: preferHostSlotOverride(
              parentLeftSection,
              defaultSlots.ComposerLeftSection,
              DraftComposerLeftSection,
            ),
            ComposerRightSection: preferHostSlotOverride(
              parentRightSection,
              defaultSlots.ComposerRightSection,
              DraftComposerRightSection,
            ),
          }}
        >
          <ComposerBody placeholder={placeholder} />
        </SlotsProvider>
      </DraftCatalogProvider>
    );
  }

  return <ComposerBody placeholder={placeholder} />;
}
