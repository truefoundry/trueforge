'use client';

import { useTrueFoundryAgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useId, useState, type FormEvent } from 'react';

import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentSpec } from '../server/types.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { CenteredModal } from './primitives/CenteredModal.js';

const inputClassName =
  'border-input bg-background placeholder:text-muted-foreground w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50';

export function SaveAgentButton() {
  const shell = useOptionalShellMode();
  const server = useOptionalServer();
  const { agentSpec } = useTrueFoundryAgentSpec();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const instructionsId = useId();

  if (shell?.mode.status !== 'active' || !shell.mode.isMutable || server == null) return null;

  const editingAgentName = shell.mode.agentName ?? shell.mode.agentId;
  const isUpdate = editingAgentName != null && editingAgentName !== '';
  const draftSpec = shell.mode.agentSpec ?? { model: { name: 'openai-main/gpt-4.1' } };
  // Runtime AgentSpec is structurally compatible; cast across package boundary.
  const specToSave: AgentSpec = (agentSpec as AgentSpec | undefined) ?? draftSpec;

  const reset = () => {
    setName('');
    setInstructions('');
    setError(null);
    setSaving(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName(editingAgentName ?? '');
      setInstructions(specToSave.instructions ?? draftSpec.instructions ?? '');
    } else {
      reset();
    }
    setOpen(next);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const agentName = name.trim();
    if (!agentName || saving) return;

    setSaving(true);
    setError(null);
    const trimmedInstructions = instructions.trim();
    const savedSpec: AgentSpec = {
      ...specToSave,
      instructions: trimmedInstructions || undefined,
    };
    try {
      await server.saveAgent({
        agentName,
        agentSpec: savedSpec,
      });
      // Same draft chat continues as editable agent — do not remount via selectLibraryAgent.
      shell.bindMutableAgent({
        agentId: agentName,
        agentName,
        agentSpec: savedSpec,
      });
      shell.invalidateAgentsList();
      handleOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : isUpdate ? 'Failed to update agent.' : 'Failed to save agent.');
      setSaving(false);
    }
  };

  const triggerLabel = isUpdate ? 'Update Agent' : 'Save as agent';
  const modalTitle = isUpdate ? 'Update Agent' : 'Save as agent';
  const modalDescription = isUpdate
    ? 'Save changes to this agent in the Agents library'
    : 'Reuse this setup later from the Agents library';
  const submitLabel = saving ? (isUpdate ? 'Updating…' : 'Saving…') : isUpdate ? 'Update' : 'Save';

  return (
    <>
      <button
        type="button"
        className={auiButtonClass({ variant: 'outline', size: 'sm' })}
        onClick={() => handleOpenChange(true)}
      >
        {triggerLabel}
      </button>

      <CenteredModal
        open={open}
        onOpenChange={handleOpenChange}
        title={modalTitle}
        description={modalDescription}
        contentSized
      >
        <form className="flex flex-col gap-4 p-5" onSubmit={e => void handleSubmit(e)}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-foreground text-sm font-medium">
              Name
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Release notes writer"
              autoFocus={!isUpdate}
              autoComplete="off"
              disabled={saving || isUpdate}
              className={`${inputClassName} h-9`}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={instructionsId} className="text-foreground text-sm font-medium">
              System instructions
            </label>
            <textarea
              id={instructionsId}
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="You are a release notes writer for the platform team..."
              rows={4}
              autoFocus={isUpdate}
              disabled={saving}
              className={`${inputClassName} min-h-24 resize-y py-2`}
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <button
            type="submit"
            disabled={saving || name.trim().length === 0}
            className={auiButtonClass({ variant: 'default', className: 'w-full' })}
          >
            {submitLabel}
          </button>
        </form>
      </CenteredModal>
    </>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SaveAgentButton: typeof SaveAgentButton;
  }
}
