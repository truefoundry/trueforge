'use client';

import { ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { useTrueFoundryAgentSpec, useTrueFoundryCancel } from '@truefoundry/assistant-ui-runtime';
import { useRef } from 'react';

import { DraftCatalogProvider } from '../atoms/draft/DraftCatalogProvider.js';
import { useComposerBusyState } from '../hooks/useComposerBusyState.js';
import { useComposerPauseView } from '../hooks/useComposerPauseView.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { SlotsProvider, useSlot, useSlotIsDefault } from '../theme/SlotsProvider.js';
import { AskUserContainer } from './AskUserContainer.js';
import { ComposerAttachmentsContainer } from './AttachmentsContainer.js';
import { CustomActionContainer } from './CustomActionContainer.js';
import { McpAuthContainer } from './McpAuthContainer.js';

export type ComposerContainerProps = {
  placeholder?: string;
};

function ComposerBody({ placeholder }: { placeholder: string }) {
  const ComposerShell = useSlot('ComposerShell');
  const aui = useAui();
  const shell = useOptionalShellMode();
  const hasText = useAuiState(s => s.composer.text.trim().length > 0);
  const { agentSpec } = useTrueFoundryAgentSpec();
  // Named (immutable) agents use a server-side model; only draft/mutable composers pick one here.
  const requiresModel = shell == null || (shell.mode.status === 'active' && shell.mode.isMutable);
  const hasModel = Boolean(agentSpec?.model?.name?.trim());
  const { isBusy, send, resetBusy } = useComposerBusyState();
  const cancel = useTrueFoundryCancel();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSubmit = !isBusy && hasText && (!requiresModel || hasModel);
  const submit = () => {
    if (!canSubmit) return;
    send(() => aui.composer().send());
  };

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
        className="w-full rounded-[0.75rem] transition-[box-shadow] data-[dragging=true]:ring-focus-ring/20 data-[dragging=true]:ring-3"
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
                className="text-text-primary placeholder:text-text-secondary/80 max-h-[10lh] min-h-10 w-full resize-none overflow-y-auto rounded-lg border-none bg-transparent px-1 py-1 text-base leading-normal shadow-none outline-none disabled:cursor-not-allowed"
              />
            }
            disabled={isBusy}
            canSubmit={canSubmit}
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
  const usesDefaultLeftSection = useSlotIsDefault('ComposerLeftSection');
  const usesDefaultRightSection = useSlotIsDefault('ComposerRightSection');
  const DraftComposerLeftSection = useSlot('DraftComposerLeftSection');
  const DraftComposerRightSection = useSlot('DraftComposerRightSection');
  const canMutateSpec = shell?.mode.status === 'active' && shell.mode.isMutable;

  if (pauseView.kind === 'mcp') {
    return <McpAuthContainer />;
  }
  if (pauseView.kind === 'custom') {
    return <CustomActionContainer />;
  }
  if (pauseView.kind === 'ask-user') {
    return <AskUserContainer />;
  }

  if (canMutateSpec) {
    return (
      <DraftCatalogProvider>
        <SlotsProvider
          overrides={{
            ComposerLeftSection: usesDefaultLeftSection ? DraftComposerLeftSection : parentLeftSection,
            ComposerRightSection: usesDefaultRightSection ? DraftComposerRightSection : parentRightSection,
          }}
        >
          <ComposerBody placeholder={placeholder} />
        </SlotsProvider>
      </DraftCatalogProvider>
    );
  }

  return <ComposerBody placeholder={placeholder} />;
}
