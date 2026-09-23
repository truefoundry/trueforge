'use client';

import { ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { useTrueForgeAgentSpec, useTrueForgeCancel } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useRef, type KeyboardEvent } from 'react';

import { DraftCatalogProvider } from '../atoms/draft/DraftCatalogProvider.js';
import { useComposerBusyState } from '../hooks/useComposerBusyState.js';
import { useComposerPauseView } from '../hooks/useComposerPauseView.js';
import { useActiveSessionCanManage } from '../hooks/useResourcePermissions.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { SlotsProvider, useSlot, useSlotIsDefault } from '../theme/SlotsProvider.js';
import { ApprovalNavContainer } from './ApprovalNavContainer.js';
import { AskUserContainer } from './AskUserContainer.js';
import { ComposerAttachmentsContainer } from './AttachmentsContainer.js';
import { CustomActionContainer } from './CustomActionContainer.js';
import { McpAuthContainer } from './McpAuthContainer.js';

export type ComposerContainerProps = {
  placeholder?: string;
};

export function canSubmitComposer({
  disabled,
  hasText,
  hasAttachments,
  requiresModel,
  hasModel,
}: {
  disabled: boolean;
  hasText: boolean;
  hasAttachments: boolean;
  requiresModel: boolean;
  hasModel: boolean;
}): boolean {
  return !disabled && (hasText || hasAttachments) && (!requiresModel || hasModel);
}

function ComposerBody({
  placeholder,
  connectedToBanner = false,
}: {
  placeholder: string;
  /** Flatten top radius/border so pause chrome sits flush above. */
  connectedToBanner?: boolean;
}) {
  const ComposerShell = useSlot('ComposerShell');
  const aui = useAui();
  const shell = useOptionalShellMode();
  const hasText = useAuiState(s => s.composer.text.trim().length > 0);
  const hasAttachments = useAuiState(s => s.composer.attachments.length > 0);
  const hasContent = hasText || hasAttachments;
  const { agentSpec } = useTrueForgeAgentSpec();
  // Named (immutable) agents use a server-side model; only draft/mutable composers pick one here.
  const requiresModel = shell == null || (shell.mode.status === 'active' && shell.mode.isMutable);
  const hasModel = Boolean(agentSpec?.model?.name?.trim());
  const { isBusy, send, resetBusy } = useComposerBusyState();
  const canManageSession = useActiveSessionCanManage();
  const cancel = useTrueForgeCancel();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Running/pause no longer lock the input — only session permissions do.
  const disabled = !canManageSession;
  const canSubmit = canSubmitComposer({ disabled, hasText, hasAttachments, requiresModel, hasModel });
  const submit = () => {
    if (!canSubmit) return;
    // Do not cancelSession here; sendTurn detaches the prior client stream.
    send(() => aui.composer().send());
  };

  // assistant-ui blocks Enter while the thread is running without queue support.
  // Intercept before the primitive handler so Send can supersede a running turn.
  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (!canSubmit) return;
    event.preventDefault();
    submit();
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
        disabled={disabled}
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
            className={
              connectedToBanner
                ? // Banner owns the top accent; composer keeps its normal chrome without a shared blue frame.
                  'rounded-t-none border-t-0 focus-within:ring-0'
                : undefined
            }
            attachments={<ComposerAttachmentsContainer />}
            input={
              <ComposerPrimitive.Input
                data-slot="aui_composer-input"
                placeholder={placeholder}
                disabled={disabled}
                submitMode="enter"
                onKeyDown={onInputKeyDown}
                aria-label="Message input"
                className="text-text-primary placeholder:text-text-secondary/80 max-h-[10lh] min-h-10 w-full resize-none overflow-y-auto rounded-lg border-none bg-transparent px-1 py-1 text-base leading-normal shadow-none outline-none disabled:cursor-not-allowed"
              />
            }
            disabled={disabled}
            canSubmit={canSubmit}
            hasContent={hasContent}
            isRunning={isBusy}
            onSubmit={submit}
            onCancel={
              canManageSession
                ? () => {
                    resetBusy();
                    void cancel();
                  }
                : undefined
            }
            onAttach={canManageSession ? () => fileInputRef.current?.click() : undefined}
          />
        </ComposerPrimitive.Root>
      </ComposerPrimitive.AttachmentDropzone>
    </>
  );
}

function ComposerWithOptionalDraft({
  placeholder,
  connectedToBanner = false,
}: {
  placeholder: string;
  connectedToBanner?: boolean;
}) {
  const shell = useOptionalShellMode();
  const parentLeftSection = useSlot('ComposerLeftSection');
  const parentRightSection = useSlot('ComposerRightSection');
  const usesDefaultLeftSection = useSlotIsDefault('ComposerLeftSection');
  const usesDefaultRightSection = useSlotIsDefault('ComposerRightSection');
  const DraftComposerLeftSection = useSlot('DraftComposerLeftSection');
  const DraftComposerRightSection = useSlot('DraftComposerRightSection');
  const canMutateSpec = shell?.mode.status === 'active' && shell.mode.isMutable;

  if (canMutateSpec) {
    return (
      <DraftCatalogProvider>
        <SlotsProvider
          overrides={{
            ComposerLeftSection: usesDefaultLeftSection ? DraftComposerLeftSection : parentLeftSection,
            ComposerRightSection: usesDefaultRightSection ? DraftComposerRightSection : parentRightSection,
          }}
        >
          <ComposerBody placeholder={placeholder} connectedToBanner={connectedToBanner} />
        </SlotsProvider>
      </DraftCatalogProvider>
    );
  }

  return <ComposerBody placeholder={placeholder} connectedToBanner={connectedToBanner} />;
}

export function ComposerContainer({
  placeholder = 'Ask anything... (Shift+Enter for new line)',
}: ComposerContainerProps) {
  const pauseView = useComposerPauseView();
  const canManageSession = useActiveSessionCanManage();

  const pauseChrome =
    pauseView.kind === 'mcp' ? (
      <McpAuthContainer disabled={!canManageSession} />
    ) : pauseView.kind === 'custom' ? (
      <CustomActionContainer disabled={!canManageSession} />
    ) : pauseView.kind === 'ask-user' ? (
      <AskUserContainer disabled={!canManageSession} />
    ) : pauseView.kind === 'approval' ? (
      <ApprovalNavContainer />
    ) : null;

  if (pauseChrome == null) {
    return <ComposerWithOptionalDraft placeholder={placeholder} />;
  }

  return (
    <div data-slot="aui_composer-pause" data-pause-kind={pauseView.kind} className="flex w-full flex-col">
      {pauseChrome}
      <ComposerWithOptionalDraft placeholder={placeholder} connectedToBanner />
    </div>
  );
}
