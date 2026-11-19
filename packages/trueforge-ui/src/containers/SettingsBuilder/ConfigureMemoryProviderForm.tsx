'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { auiInputClass } from '../../atoms/lib/inputClasses.js';
import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';

export type MemoryProviderConfigDraft = {
  apiKey: string;
  serverUrl: string;
};

type ConfigureMemoryProviderFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: MemoryProviderConfigDraft) => void | Promise<void>;
  title: string;
  description?: string;
  /** Prefills the server URL when updating. */
  initialServerUrl?: string;
  /** When false (updates), empty apiKey means keep the existing key. */
  requireApiKey?: boolean;
  busy?: boolean;
  error?: string | null;
};

const inputClassName = auiInputClass('h-11 shadow-sm');

const ConfigureMemoryProviderForm = ({
  open,
  onOpenChange,
  onSave,
  title,
  description,
  initialServerUrl = '',
  requireApiKey = true,
  busy = false,
  error,
}: ConfigureMemoryProviderFormProps) => {
  const [apiKey, setApiKey] = useState('');
  const [serverUrl, setServerUrl] = useState(initialServerUrl);

  useEffect(() => {
    if (!open) return;
    setApiKey('');
    setServerUrl(initialServerUrl);
  }, [open, initialServerUrl]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setApiKey('');
      setServerUrl(initialServerUrl);
    }
    onOpenChange(nextOpen);
  };

  const trimmedKey = apiKey.trim();
  const isValid = !requireApiKey || !!trimmedKey;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid || busy) return;

    try {
      await onSave({ apiKey: trimmedKey, serverUrl: serverUrl.trim() });
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
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-primary"
          aria-hidden
        >
          <Icon name="brain" className="size-6" />
        </span>
      }
    >
      <form className="flex flex-col overflow-y-auto p-5 md:p-6" onSubmit={handleSubmit}>
        <div className="space-y-4">
          <div>
            <label htmlFor="memory-provider-api-key" className="mb-1.5 block text-sm font-medium text-text-primary">
              API key
              {!requireApiKey ? <span className="font-normal text-text-secondary"> (optional)</span> : null}
            </label>
            <input
              id="memory-provider-api-key"
              type="password"
              required={requireApiKey}
              value={apiKey}
              onChange={event => {
                setApiKey(event.target.value);
              }}
              placeholder={requireApiKey ? 'Zep API key' : 'Leave blank to keep existing'}
              autoFocus
              className={inputClassName}
            />
          </div>
          <div>
            <label htmlFor="memory-provider-server-url" className="mb-1.5 block text-sm font-medium text-text-primary">
              Server URL <span className="font-normal text-text-secondary">(optional)</span>
            </label>
            <input
              id="memory-provider-server-url"
              type="url"
              value={serverUrl}
              onChange={event => {
                setServerUrl(event.target.value);
              }}
              placeholder="Leave blank for Zep Cloud"
              className={inputClassName}
            />
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {error ? <p className="text-failure-bg text-sm">{error}</p> : null}
          <Button.Primary type="submit" size="large" disabled={!isValid || busy} className="w-full shrink-0">
            Save
          </Button.Primary>
        </div>
      </form>
    </CenteredModal>
  );
};

export default ConfigureMemoryProviderForm;
