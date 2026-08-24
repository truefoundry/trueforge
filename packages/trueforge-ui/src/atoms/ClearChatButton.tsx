'use client';

import { useState, type MouseEvent } from 'react';

import { useAui } from '../assistant-ui.js';
import { useChatChromeActionsVisible, useDeleteChatState } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from './primitives/DropdownMenu.js';

const DELETE_CHAT_CONFIRM_MESSAGE = 'Delete this chat? This permanently removes the chat history for this session.';

// This established slot now owns the compact header menu so host overrides remain compatible.
export function ClearChatButton() {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const clearVisible = useChatChromeActionsVisible();
  const deleteState = useDeleteChatState();
  const [deleting, setDeleting] = useState(false);

  if ((!clearVisible && !deleteState.visible) || shell == null) return null;

  const handleDelete = (event: MouseEvent<HTMLButtonElement>) => {
    if (!deleteState.enabled || deleting || !window.confirm(DELETE_CHAT_CONFIRM_MESSAGE)) {
      event.stopPropagation();
      return;
    }
    setDeleting(true);
    void Promise.resolve(aui.threads().item('main').delete())
      .catch(() => undefined)
      .finally(() => setDeleting(false));
  };

  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          aria-label="Chat actions"
          title="Chat actions"
          className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
        >
          <Icon name="ellipsis" />
        </button>
      }
    >
      {clearVisible ? (
        <DropdownMenuItem onClick={() => shell.clearChat()}>
          <Icon name="broom" size="0.875rem" />
          Clear chat
        </DropdownMenuItem>
      ) : null}
      {clearVisible && deleteState.visible ? <DropdownMenuSeparator /> : null}
      {deleteState.visible ? (
        <DropdownMenuItem
          disabled={!deleteState.enabled || deleting}
          className="text-failure-bg hover:bg-failure-bg/12 hover:text-failure-bg focus:bg-failure-bg/12 focus:text-failure-bg"
          onClick={handleDelete}
        >
          <Icon name="trash" size="0.875rem" />
          Delete chat
        </DropdownMenuItem>
      ) : null}
    </DropdownMenu>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ClearChatButton: typeof ClearChatButton;
  }
}
