'use client';

import { useEffect, useRef } from 'react';

import type { AgentSpec } from '../server/types.js';
import { auiInputClass } from './lib/inputClasses.js';
import { Button } from './primitives/Button.js';

export type SaveAgentFormProps = {
  intent: 'create' | 'update';
  name: string;
  spec: AgentSpec;
  saving: boolean;
  error: string | null;
  onNameChange: (name: string) => void;
  onChange: (spec: AgentSpec) => void;
  onCancel: () => void;
  onSave: () => void;
};

export function SaveAgentForm({
  intent,
  name,
  spec,
  saving,
  error,
  onNameChange,
  onChange,
  onCancel,
  onSave,
}: SaveAgentFormProps) {
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error === null) return;
    // scrollIntoView is unimplemented in jsdom; guard so tests don't throw.
    errorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const canSave =
    name.trim() !== '' &&
    spec.model.name.trim() !== '' &&
    (intent === 'update' || (spec.description?.trim() ?? '') !== '');

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
            className={auiInputClass('h-8 disabled:opacity-60')}
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-sm font-medium">Description</span>
          <textarea
            value={spec.description ?? ''}
            disabled={saving}
            onChange={event => onChange({ ...spec, description: event.target.value })}
            rows={4}
            maxLength={1024}
            placeholder="Describe what this agent does."
            className={auiInputClass('resize-y py-2 disabled:opacity-60')}
          />
        </label>

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
        <Button.Secondary type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </Button.Secondary>
        <Button.Primary type="button" disabled={saving || !canSave} onClick={onSave}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button.Primary>
      </div>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SaveAgentForm: typeof SaveAgentForm;
  }
}
