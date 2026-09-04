'use client';

import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { useId, useRef, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { auiInputClass } from '../lib/inputClasses.js';
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
  const fieldId = useId();
  const nextMessageId = useRef(messages.length);
  const [instructionDraft, setInstructionDraft] = useState(instructions);
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
      description="Define the agent behavior and messages added at the start of every session."
      anchor="right"
      size="lg"
      aria-label="Edit Instructions"
      footer={
        <div className="flex justify-end">
          <button type="button" className={auiButtonClass({ variant: 'default' })} onClick={save}>
            Save
          </button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-6 p-5">
        <section>
          <label htmlFor={`${fieldId}-instructions`} className="text-text-primary text-sm font-semibold">
            Agent instructions
          </label>
          <p className="text-text-secondary mt-1 text-xs">Describe the agent&apos;s role, goals, and constraints.</p>
          <textarea
            id={`${fieldId}-instructions`}
            value={instructionDraft}
            rows={14}
            placeholder="Enter detailed instructions for your agent…"
            className={auiInputClass('mt-3 min-h-64 resize-y py-3')}
            onChange={event => setInstructionDraft(event.target.value)}
          />
        </section>

        <section className="border-border border-t pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-text-primary text-sm font-semibold">User Messages</h3>
              <p className="text-text-secondary mt-1 text-xs">Add initial messages to every new agent session.</p>
            </div>
            <button
              type="button"
              className={auiButtonClass({ variant: 'outline', size: 'sm' })}
              onClick={addUserMessage}
            >
              <Icon name="plus" className="size-3.5" />
              Add User Message
            </button>
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
    </SideDrawer>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentInstructionsDrawer: typeof AgentInstructionsDrawer;
  }
}
