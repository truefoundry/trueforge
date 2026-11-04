'use client';

import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { useId, useRef, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { Button } from '../primitives/Button.js';
import { SideDrawer } from '../primitives/SideDrawer.js';

type UserMessageDraft = {
  id: number;
  content: string;
};

export type AgentInstructionsDraft = {
  instructions: string;
  messages: TrueForgeApi.InitialUserMessage[];
};

export type AgentInstructionsDrawerProps = {
  open: boolean;
  instructions: string;
  messages?: TrueForgeApi.InitialUserMessage[];
  onSave: (draft: AgentInstructionsDraft) => void;
  onClose: () => void;
};

function persistedMessages(rows: UserMessageDraft[]): TrueForgeApi.InitialUserMessage[] {
  return rows.filter(row => row.content.trim().length > 0).map(row => ({ type: 'user.message', content: row.content }));
}

export function AgentInstructionsDrawer({
  open,
  instructions,
  messages = [],
  onSave,
  onClose,
}: AgentInstructionsDrawerProps) {
  const InstructionsFullScreenEditor = useSlot('InstructionsFullScreenEditor');
  const InstructionsMarkdownEditor = useSlot('InstructionsMarkdownEditor');
  const fieldId = useId();
  const nextMessageId = useRef(messages.length);
  const [instructionDraft, setInstructionDraft] = useState(instructions);
  const [fullScreen, setFullScreen] = useState(false);
  const [messageDrafts, setMessageDrafts] = useState<UserMessageDraft[]>(() =>
    messages.map((message, id) => ({ id, content: message.content })),
  );

  const updateMessageDrafts = (next: UserMessageDraft[]) => {
    setMessageDrafts(next);
  };

  const addUserMessage = () => {
    const next = [...messageDrafts, { id: nextMessageId.current, content: '' }];
    nextMessageId.current += 1;
    setMessageDrafts(next);
  };

  const updateUserMessage = ({ id, content }: UserMessageDraft) => {
    updateMessageDrafts(messageDrafts.map(message => (message.id === id ? { id, content } : message)));
  };

  const removeUserMessage = (id: number) => {
    updateMessageDrafts(messageDrafts.filter(message => message.id !== id));
  };

  const save = () => {
    onSave({ instructions: instructionDraft, messages: persistedMessages(messageDrafts) });
    onClose();
  };

  return (
    <SideDrawer
      open={open}
      onOpenChange={nextOpen => !nextOpen && onClose()}
      title="Instructions"
      description="System prompt that defines the agent's role, goals, and how it should behave. Written once, applied to every run."
      anchor="right"
      size="lg"
      aria-label="Edit Instructions"
      footer={
        <div className="flex justify-end">
          <Button.Primary type="button" onClick={save}>
            Save
          </Button.Primary>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-6 p-5">
        <section>
          <div className="flex items-start justify-between gap-3">
            <div>
              <span id={`${fieldId}-instructions`} className="text-text-primary text-sm font-semibold">
                Agent instructions
              </span>
              <p className="text-text-secondary mt-1 text-xs">
                Describe the agent&apos;s role, goals, and constraints.
              </p>
            </div>
            <button
              type="button"
              aria-label="Edit instructions full screen"
              title="Full screen"
              className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7 shrink-0' })}
              onClick={() => setFullScreen(true)}
            >
              <Icon name="expand" className="size-4" />
            </button>
          </div>
          <div
            className="border-border mt-3 overflow-hidden rounded-md border"
            aria-labelledby={`${fieldId}-instructions`}
          >
            {fullScreen ? (
              <div className="h-72" />
            ) : (
              <InstructionsMarkdownEditor value={instructionDraft} onChange={setInstructionDraft} height="18rem" />
            )}
          </div>
        </section>

        <section className="border-border border-t pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-text-primary text-sm font-semibold">User Messages</h3>
              <p className="text-text-secondary mt-1 text-xs">Add initial messages to every new agent session.</p>
            </div>
            <Button.Secondary type="button" size="small" onClick={addUserMessage}>
              <Icon name="plus" className="size-3.5" />
              Add User Message
            </Button.Secondary>
          </div>

          {messageDrafts.length > 0 ? (
            <div className="mt-4 flex flex-col gap-4">
              {messageDrafts.map((message, index) => {
                const messageId = `${fieldId}-user-message-${message.id}`;
                return (
                  <div key={message.id} className="border-border rounded-lg border p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Icon name="user" className="text-text-secondary size-4" />
                      <label htmlFor={messageId} className="text-text-primary flex-1 text-sm font-medium">
                        User Message {index + 1}
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove User Message ${index + 1}`}
                        className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7' })}
                        onClick={() => removeUserMessage(message.id)}
                      >
                        <Icon name="trash" className="size-3.5" />
                      </button>
                    </div>
                    <textarea
                      id={messageId}
                      value={message.content}
                      rows={4}
                      placeholder="Type message content…"
                      className={auiInputClass('min-h-24 resize-y py-2')}
                      onChange={event => updateUserMessage({ id: message.id, content: event.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-text-secondary mt-4 text-sm">No initial user messages.</p>
          )}
        </section>
      </div>
      <InstructionsFullScreenEditor
        open={fullScreen}
        value={instructionDraft}
        onChange={setInstructionDraft}
        onClose={() => setFullScreen(false)}
      />
    </SideDrawer>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentInstructionsDrawer: typeof AgentInstructionsDrawer;
  }
}
