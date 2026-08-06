'use client';

import { useTrueFoundryAgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useId, useState, type FormEvent } from 'react';

import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentSpec } from '../server/types.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { CenteredModal } from './primitives/CenteredModal.js';

export function SaveAgentButton() {
  const shell = useOptionalShellMode();
  const server = useOptionalServer();
  const { agentSpec } = useTrueFoundryAgentSpec();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  if (shell?.mode.type !== 'draft' || server == null) return null;

  const draftSpec = shell.mode.defaultAgentSpec;
  // Runtime AgentSpec is structurally compatible; cast across package boundary.
  const specToSave: AgentSpec = (agentSpec as AgentSpec | undefined) ?? draftSpec;

  const reset = () => {
    setName('');
    setError(null);
    setSaving(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const agentName = name.trim();
    if (!agentName || saving) return;

    setSaving(true);
    setError(null);
    try {
      await server.saveAgent({
        agentName,
        agentSpec: specToSave,
      });
      handleOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save agent.');
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={auiButtonClass({ variant: 'outline', size: 'sm' })}
        onClick={() => setOpen(true)}
      >
        Save as agent
      </button>

      <CenteredModal
        open={open}
        onOpenChange={handleOpenChange}
        title="Save as agent"
        description="Reuse this setup later from the Agents library"
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
              placeholder="Agent Name"
              autoFocus
              autoComplete="off"
              disabled={saving}
              className="border-input bg-background placeholder:text-muted-foreground h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <button
            type="submit"
            disabled={saving || name.trim().length === 0}
            className={auiButtonClass({ variant: 'default', className: 'w-full' })}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      </CenteredModal>
    </>
  );
}
