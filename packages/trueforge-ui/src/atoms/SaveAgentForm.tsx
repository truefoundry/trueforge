'use client';

import { useEffect, useRef } from 'react';

import type { AgentSpec, ModelSelection } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import type { AgentConfigEditor } from './draft/AgentConfigEditors.js';
import type { EditableMount } from './draft/agentConfigMounts.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { auiInputClass } from './lib/inputClasses.js';

export type SaveAgentFormProps = {
  intent: 'create' | 'update';
  name: string;
  spec: AgentSpec;
  modelEntry?: ModelSelection;
  mcpMounts: EditableMount[];
  skillMounts: EditableMount[];
  saving: boolean;
  error: string | null;
  onNameChange: (name: string) => void;
  onChange: (spec: AgentSpec) => void;
  onEdit: (editor: AgentConfigEditor) => void;
  onToggleMcpPreload: (id: string) => void;
  onRemoveMcp?: (id: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

export function SaveAgentForm({
  intent,
  name,
  spec,
  modelEntry,
  mcpMounts,
  skillMounts,
  saving,
  error,
  onNameChange,
  onChange,
  onEdit,
  onToggleMcpPreload,
  onRemoveMcp,
  onCancel,
  onSave,
}: SaveAgentFormProps) {
  const SaveAgentFormFields = useSlot('SaveAgentFormFields');
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error === null) return;
    // scrollIntoView is unimplemented in jsdom; guard so tests don't throw.
    errorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <label className="mb-3 block">
          <span className="mb-1.5 block text-sm font-medium">Agent name</span>
          <input
            value={name}
            disabled={saving || intent === 'update'}
            onChange={event => onNameChange(event.target.value)}
            placeholder="release-notes"
            className={auiInputClass('h-9 disabled:opacity-60')}
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-sm font-medium">Instructions</span>
          <textarea
            value={spec.instructions ?? ''}
            disabled={saving}
            onChange={event => onChange({ ...spec, instructions: event.target.value })}
            rows={5}
            placeholder="You are a release notes writer for a platform team."
            className={auiInputClass('resize-y py-2 disabled:opacity-60')}
          />
        </label>

        <SaveAgentFormFields
          spec={spec}
          modelEntry={modelEntry}
          mcpMounts={mcpMounts}
          skillMounts={skillMounts}
          disabled={saving}
          onEdit={onEdit}
          onToggleMcpPreload={onToggleMcpPreload}
          onRemoveMcp={onRemoveMcp}
        />

        {error ? (
          <p
            ref={errorRef}
            role="alert"
            className="text-failure-bg mt-3 text-sm wrap-break-word whitespace-pre-wrap tab-4"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="bg-card-bg sticky bottom-0 z-10 flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">
        <button type="button" disabled={saving} className={auiButtonClass({ variant: 'secondary' })} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || !name.trim() || !spec.model.name.trim()}
          className={auiButtonClass({ variant: 'default' })}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SaveAgentForm: typeof SaveAgentForm;
  }
}
