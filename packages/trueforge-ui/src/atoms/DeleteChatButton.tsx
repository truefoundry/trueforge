'use client';

import { useState } from 'react';

import { useAui } from '../assistant-ui.js';
import { useDeleteChatVisible } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { auiButtonClass } from './lib/buttonClasses.js';

const DELETE_CHAT_CONFIRM_MESSAGE = 'Delete this chat? This permanently removes the chat history for this session.';

export function confirmDeleteChat(): boolean {
  return window.confirm(DELETE_CHAT_CONFIRM_MESSAGE);
}

export function DeleteChatButton() {
  const aui = useAui();
  const visible = useDeleteChatVisible();
  const [deleting, setDeleting] = useState(false);

  if (!visible) return null;

  const handleDelete = () => {
    if (deleting || !confirmDeleteChat()) return;
    setDeleting(true);
    void Promise.resolve(aui.threads().item('main').delete())
      .catch(() => undefined)
      .finally(() => setDeleting(false));
  };

  return (
    <button
      type="button"
      title="Delete chat"
      disabled={deleting}
      className={auiButtonClass({
        variant: 'ghost',
        size: 'sm',
        className: 'text-failure-bg hover:text-failure-bg',
      })}
      onClick={handleDelete}
    >
      <Icon name="trash" size="0.875rem" />
      Delete chat
    </button>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    DeleteChatButton: typeof DeleteChatButton;
  }
}
