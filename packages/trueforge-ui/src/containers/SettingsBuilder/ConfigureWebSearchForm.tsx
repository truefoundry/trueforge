'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { auiInputClass } from '../../atoms/lib/inputClasses.js';
import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';
import type { ParallelWebSearchMode, WebSearchProviderConfig } from '../../server/types.js';

export type WebSearchConfigDraft = WebSearchProviderConfig & {
  apiKey: string;
};

type ConfigureWebSearchFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: WebSearchConfigDraft) => void | Promise<void>;
  title: string;
  description?: string;
  /** Prefills config fields; apiKey is never autofilled. */
  initialConfig?: WebSearchProviderConfig | null;
  /** When false (updates), empty apiKey means keep the existing key. */
  requireApiKey?: boolean;
  busy?: boolean;
  error?: string | null;
};

const MODE_OPTIONS: Array<{ value: ParallelWebSearchMode; label: string }> = [
  { value: 'turbo', label: 'Turbo' },
  { value: 'fast', label: 'Fast' },
  { value: 'basic', label: 'Basic' },
  { value: 'advanced', label: 'Advanced' },
];

const EMPTY_CONFIG: WebSearchProviderConfig = {
  mode: 'turbo',
};

const inputClassName = auiInputClass('h-11 shadow-sm');

function isParallelWebSearchMode(value: string): value is ParallelWebSearchMode {
  return MODE_OPTIONS.some(option => option.value === value);
}

const ConfigureWebSearchForm = ({
  open,
  onOpenChange,
  onSave,
  title,
  description,
  initialConfig = null,
  requireApiKey = true,
  busy = false,
  error,
}: ConfigureWebSearchFormProps) => {
  const [mode, setMode] = useState<ParallelWebSearchMode>(EMPTY_CONFIG.mode);
  const [apiKey, setApiKey] = useState('');

  const resetForm = () => {
    setMode(EMPTY_CONFIG.mode);
    setApiKey('');
  };

  useEffect(() => {
    if (!open) return;
    const config = initialConfig ?? EMPTY_CONFIG;
    setMode(config.mode);
    setApiKey('');
  }, [open, initialConfig]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const trimmedKey = apiKey.trim();
  const isValid = !requireApiKey || !!trimmedKey;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid || busy) return;

    try {
      await onSave({
        mode,
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
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-primary"
          aria-hidden
        >
          <Icon name="search" className="size-6" />
        </span>
      }
    >
      <form className="flex flex-col overflow-y-auto p-5 md:p-6" onSubmit={handleSubmit}>
        <div className="space-y-4">
          <div>
            <label htmlFor="web-search-api-key" className="mb-1.5 block text-sm font-medium text-text-primary">
              API key
              {!requireApiKey ? <span className="font-normal text-text-secondary"> (optional)</span> : null}
            </label>
            <input
              id="web-search-api-key"
              type="password"
              required={requireApiKey}
              value={apiKey}
              onChange={event => {
                setApiKey(event.target.value);
              }}
              placeholder={requireApiKey ? 'Parallel API key' : 'Leave blank to keep existing'}
              autoFocus
              className={inputClassName}
            />
          </div>

          <div>
            <label htmlFor="web-search-mode" className="mb-1.5 block text-sm font-medium text-text-primary">
              Mode
            </label>
            <select
              id="web-search-mode"
              required
              value={mode}
              onChange={event => {
                const next = event.target.value;
                if (isParallelWebSearchMode(next)) {
                  setMode(next);
                }
              }}
              className={inputClassName}
            >
              {MODE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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

export default ConfigureWebSearchForm;
