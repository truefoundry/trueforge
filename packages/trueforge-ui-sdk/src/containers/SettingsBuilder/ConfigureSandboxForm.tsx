'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';
import type { SandboxProviderConfig } from '../../server/types.js';

export type SandboxConfigDraft = SandboxProviderConfig & {
  apiKey: string;
};

type ConfigureSandboxFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: SandboxConfigDraft) => void | Promise<void>;
  title: string;
  description?: string;
  /** Prefills config fields; apiKey is never autofilled. */
  initialConfig?: SandboxProviderConfig | null;
  /** When false (updates), empty apiKey means keep the existing key. */
  requireApiKey?: boolean;
  busy?: boolean;
};

const EMPTY_CONFIG: SandboxProviderConfig = {
  snapshotName: '',
  execTimeoutMs: 0,
  autoStopIntervalInMinutes: 0,
  autoArchiveIntervalInMinutes: 0,
  autoDeleteIntervalInMinutes: 0,
};

const inputClassName =
  'h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40';

function parseNonNegInt(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

const ConfigureSandboxForm = ({
  open,
  onOpenChange,
  onSave,
  title,
  description,
  initialConfig = null,
  requireApiKey = true,
  busy = false,
}: ConfigureSandboxFormProps) => {
  const [snapshotName, setSnapshotName] = useState('');
  const [execTimeoutMs, setExecTimeoutMs] = useState('');
  const [autoStopIntervalInMinutes, setAutoStopIntervalInMinutes] = useState('');
  const [autoArchiveIntervalInMinutes, setAutoArchiveIntervalInMinutes] = useState('');
  const [autoDeleteIntervalInMinutes, setAutoDeleteIntervalInMinutes] = useState('');
  const [apiKey, setApiKey] = useState('');

  const resetForm = () => {
    setSnapshotName('');
    setExecTimeoutMs('');
    setAutoStopIntervalInMinutes('');
    setAutoArchiveIntervalInMinutes('');
    setAutoDeleteIntervalInMinutes('');
    setApiKey('');
  };

  useEffect(() => {
    if (!open) return;
    const config = initialConfig ?? EMPTY_CONFIG;
    setSnapshotName(config.snapshotName);
    setExecTimeoutMs(String(config.execTimeoutMs));
    setAutoStopIntervalInMinutes(String(config.autoStopIntervalInMinutes));
    setAutoArchiveIntervalInMinutes(String(config.autoArchiveIntervalInMinutes));
    setAutoDeleteIntervalInMinutes(String(config.autoDeleteIntervalInMinutes));
    setApiKey('');
  }, [open, initialConfig]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const execTimeout = parseNonNegInt(execTimeoutMs);
  const autoStop = parseNonNegInt(autoStopIntervalInMinutes);
  const autoArchive = parseNonNegInt(autoArchiveIntervalInMinutes);
  const autoDelete = parseNonNegInt(autoDeleteIntervalInMinutes);
  const trimmedKey = apiKey.trim();

  const isValid =
    !!snapshotName.trim() &&
    (!requireApiKey || !!trimmedKey) &&
    execTimeout != null &&
    autoStop != null &&
    autoArchive != null &&
    autoDelete != null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid || busy || execTimeout == null || autoStop == null || autoArchive == null || autoDelete == null) {
      return;
    }

    try {
      await onSave({
        snapshotName: snapshotName.trim(),
        execTimeoutMs: execTimeout,
        autoStopIntervalInMinutes: autoStop,
        autoArchiveIntervalInMinutes: autoArchive,
        autoDeleteIntervalInMinutes: autoDelete,
        apiKey: trimmedKey,
      });
      resetForm();
      onOpenChange(false);
    } catch {
      // Parent surfaces error; keep form open.
    }
  };

  return (
    <CenteredModal
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      contentSized
      headerIcon={
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
          aria-hidden
        >
          <Icon name="cube" className="size-6" />
        </span>
      }
    >
      <form className="flex flex-col overflow-y-auto p-5 md:p-6" onSubmit={handleSubmit}>
        <div className="space-y-4">
          <div>
            <label htmlFor="sandbox-snapshot-name" className="mb-1.5 block text-sm font-medium text-foreground">
              Snapshot name
            </label>
            <input
              id="sandbox-snapshot-name"
              type="text"
              required
              value={snapshotName}
              onChange={event => {
                setSnapshotName(event.target.value);
              }}
              placeholder="daytona-default"
              autoFocus
              className={inputClassName}
            />
          </div>

          <div>
            <label htmlFor="sandbox-exec-timeout" className="mb-1.5 block text-sm font-medium text-foreground">
              Exec timeout (ms)
            </label>
            <input
              id="sandbox-exec-timeout"
              type="number"
              min={0}
              required
              value={execTimeoutMs}
              onChange={event => {
                setExecTimeoutMs(event.target.value);
              }}
              placeholder="300000"
              className={inputClassName}
            />
          </div>

          <div>
            <label htmlFor="sandbox-auto-stop" className="mb-1.5 block text-sm font-medium text-foreground">
              Auto-stop interval (minutes)
            </label>
            <input
              id="sandbox-auto-stop"
              type="number"
              min={0}
              required
              value={autoStopIntervalInMinutes}
              onChange={event => {
                setAutoStopIntervalInMinutes(event.target.value);
              }}
              placeholder="15"
              className={inputClassName}
            />
          </div>

          <div>
            <label htmlFor="sandbox-auto-archive" className="mb-1.5 block text-sm font-medium text-foreground">
              Auto-archive interval (minutes)
            </label>
            <input
              id="sandbox-auto-archive"
              type="number"
              min={0}
              required
              value={autoArchiveIntervalInMinutes}
              onChange={event => {
                setAutoArchiveIntervalInMinutes(event.target.value);
              }}
              placeholder="10080"
              className={inputClassName}
            />
          </div>

          <div>
            <label htmlFor="sandbox-auto-delete" className="mb-1.5 block text-sm font-medium text-foreground">
              Auto-delete interval (minutes)
            </label>
            <input
              id="sandbox-auto-delete"
              type="number"
              min={0}
              required
              value={autoDeleteIntervalInMinutes}
              onChange={event => {
                setAutoDeleteIntervalInMinutes(event.target.value);
              }}
              placeholder="43200"
              className={inputClassName}
            />
          </div>

          <div>
            <label htmlFor="sandbox-api-key" className="mb-1.5 block text-sm font-medium text-foreground">
              API key
              {!requireApiKey ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
            </label>
            <input
              id="sandbox-api-key"
              type="password"
              required={requireApiKey}
              value={apiKey}
              onChange={event => {
                setApiKey(event.target.value);
              }}
              placeholder={requireApiKey ? 'dtn_...' : 'Leave blank to keep existing'}
              className={inputClassName}
            />
          </div>
        </div>

        <Button type="submit" size="lg" disabled={!isValid || busy} className="mt-6 w-full shrink-0">
          Save
        </Button>
      </form>
    </CenteredModal>
  );
};

export default ConfigureSandboxForm;
