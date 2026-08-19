'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { cn } from '../../atoms/lib/cn.js';
import { auiInputClass } from '../../atoms/lib/inputClasses.js';
import { Accordion, AccordionDetails, AccordionSummary } from '../../atoms/primitives/Accordion.js';
import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';
import type { SandboxProviderConfig } from '../../server/types.js';
import {
  RequiredMark,
  SETTINGS_INPUT_ERROR_CLASS_NAME,
  SettingsFieldError,
  useTouchedFields,
} from './SettingsFormField.js';
import { validateNonNegativeInteger, validatePositiveInteger, validateRequired } from './settingsFormValidation.js';

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
  error?: string | null;
};

/** Sensible defaults so the advanced fields are never blank, even without a catalog preset. */
const EMPTY_CONFIG: SandboxProviderConfig = {
  // Snapshot/image is release-owned now; kept only to satisfy the external SandboxProviderConfig type.
  execTimeoutMs: 300000,
  autoStopIntervalInMinutes: 15,
  autoArchiveIntervalInMinutes: 10080,
  autoDeleteIntervalInMinutes: 43200,
};

const inputClassName = auiInputClass('h-11 shadow-sm');

function parseInteger(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

type SandboxField = 'apiKey' | 'execTimeout' | 'autoStop' | 'autoArchive' | 'autoDelete';
const SANDBOX_FIELDS: readonly SandboxField[] = ['apiKey', 'execTimeout', 'autoStop', 'autoArchive', 'autoDelete'];

const ConfigureSandboxForm = ({
  open,
  onOpenChange,
  onSave,
  title,
  description,
  initialConfig = null,
  requireApiKey = true,
  busy = false,
  error,
}: ConfigureSandboxFormProps) => {
  const [execTimeoutMs, setExecTimeoutMs] = useState('');
  const [autoStopIntervalInMinutes, setAutoStopIntervalInMinutes] = useState('');
  const [autoArchiveIntervalInMinutes, setAutoArchiveIntervalInMinutes] = useState('');
  const [autoDeleteIntervalInMinutes, setAutoDeleteIntervalInMinutes] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { isTouched, resetTouched, touch, touchAll } = useTouchedFields<SandboxField>();

  const resetForm = () => {
    setExecTimeoutMs('');
    setAutoStopIntervalInMinutes('');
    setAutoArchiveIntervalInMinutes('');
    setAutoDeleteIntervalInMinutes('');
    setApiKey('');
    setAdvancedOpen(false);
    resetTouched();
  };

  useEffect(() => {
    if (!open) return;
    const config = initialConfig ?? EMPTY_CONFIG;
    setExecTimeoutMs(String(config.execTimeoutMs));
    setAutoStopIntervalInMinutes(String(config.autoStopIntervalInMinutes));
    setAutoArchiveIntervalInMinutes(String(config.autoArchiveIntervalInMinutes));
    setAutoDeleteIntervalInMinutes(String(config.autoDeleteIntervalInMinutes));
    setApiKey('');
    setAdvancedOpen(false);
    resetTouched();
  }, [open, initialConfig, resetTouched]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const execTimeout = parseInteger(execTimeoutMs);
  const autoStop = parseInteger(autoStopIntervalInMinutes);
  const autoArchive = parseInteger(autoArchiveIntervalInMinutes);
  const autoDelete = parseInteger(autoDeleteIntervalInMinutes);
  const trimmedKey = apiKey.trim();
  const apiKeyError = requireApiKey ? validateRequired({ value: apiKey, label: 'API key' }) : null;
  const execTimeoutError = validatePositiveInteger({ value: execTimeoutMs, label: 'Exec timeout' });
  const autoStopError = validateNonNegativeInteger({
    value: autoStopIntervalInMinutes,
    label: 'Auto-stop interval',
  });
  const autoArchiveError = validateNonNegativeInteger({
    value: autoArchiveIntervalInMinutes,
    label: 'Auto-archive interval',
  });
  const autoDeleteError = validateNonNegativeInteger({
    value: autoDeleteIntervalInMinutes,
    label: 'Auto-delete interval',
  });
  const isValid = !apiKeyError && !execTimeoutError && !autoStopError && !autoArchiveError && !autoDeleteError;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    touchAll(SANDBOX_FIELDS);
    if (!isValid || busy || execTimeout == null || autoStop == null || autoArchive == null || autoDelete == null) {
      return;
    }

    try {
      await onSave({
        // Snapshot/image is release-owned; the field is retained only for the external type.
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
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-primary"
          aria-hidden
        >
          <Icon name="cube" className="size-6" />
        </span>
      }
    >
      <form className="flex flex-col overflow-y-auto p-5 md:p-6" noValidate onSubmit={handleSubmit}>
        <div className="space-y-4">
          <div>
            <label htmlFor="sandbox-api-key" className="mb-1.5 block text-sm font-medium text-text-primary">
              API key
              {requireApiKey ? <RequiredMark /> : null}
              {!requireApiKey ? <span className="font-normal text-text-secondary"> (optional)</span> : null}
            </label>
            <input
              id="sandbox-api-key"
              type="password"
              required={requireApiKey}
              value={apiKey}
              onChange={event => {
                setApiKey(event.target.value);
              }}
              onBlur={() => touch('apiKey')}
              placeholder={requireApiKey ? 'dtn_...' : 'Leave blank to keep existing'}
              autoFocus
              aria-invalid={isTouched('apiKey') && apiKeyError ? true : undefined}
              aria-describedby={isTouched('apiKey') && apiKeyError ? 'sandbox-api-key-error' : undefined}
              className={cn(inputClassName, isTouched('apiKey') && apiKeyError && SETTINGS_INPUT_ERROR_CLASS_NAME)}
            />
            {isTouched('apiKey') && apiKeyError ? (
              <SettingsFieldError id="sandbox-api-key-error">{apiKeyError}</SettingsFieldError>
            ) : null}
          </div>

          <Accordion
            expanded={advancedOpen}
            onChange={(_event, next) => setAdvancedOpen(next)}
            className="rounded-md border border-border"
          >
            <AccordionSummary className="px-3 py-2.5">
              <span className="flex w-full items-center justify-between text-sm font-medium text-text-primary">
                Advanced settings
                <Icon
                  name="chevron-down"
                  className={cn(
                    'size-4 shrink-0 text-text-secondary transition-transform duration-200',
                    advancedOpen ? 'rotate-0' : '-rotate-90',
                  )}
                />
              </span>
            </AccordionSummary>
            <AccordionDetails className="space-y-4 border-t border-border px-3 pb-3 pt-4">
              <div>
                <label htmlFor="sandbox-exec-timeout" className="mb-1.5 block text-sm font-medium text-text-primary">
                  Exec timeout (ms)
                </label>
                <input
                  id="sandbox-exec-timeout"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={execTimeoutMs}
                  onChange={event => {
                    setExecTimeoutMs(event.target.value);
                  }}
                  onBlur={() => touch('execTimeout')}
                  placeholder="300000"
                  aria-invalid={isTouched('execTimeout') && execTimeoutError ? true : undefined}
                  aria-describedby={
                    isTouched('execTimeout') && execTimeoutError ? 'sandbox-exec-timeout-error' : undefined
                  }
                  className={cn(
                    inputClassName,
                    isTouched('execTimeout') && execTimeoutError && SETTINGS_INPUT_ERROR_CLASS_NAME,
                  )}
                />
                {isTouched('execTimeout') && execTimeoutError ? (
                  <SettingsFieldError id="sandbox-exec-timeout-error">{execTimeoutError}</SettingsFieldError>
                ) : null}
              </div>

              <div>
                <label htmlFor="sandbox-auto-stop" className="mb-1.5 block text-sm font-medium text-text-primary">
                  Auto-stop interval (minutes)
                </label>
                <input
                  id="sandbox-auto-stop"
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={autoStopIntervalInMinutes}
                  onChange={event => {
                    setAutoStopIntervalInMinutes(event.target.value);
                  }}
                  onBlur={() => touch('autoStop')}
                  placeholder="15"
                  aria-invalid={isTouched('autoStop') && autoStopError ? true : undefined}
                  aria-describedby={isTouched('autoStop') && autoStopError ? 'sandbox-auto-stop-error' : undefined}
                  className={cn(
                    inputClassName,
                    isTouched('autoStop') && autoStopError && SETTINGS_INPUT_ERROR_CLASS_NAME,
                  )}
                />
                {isTouched('autoStop') && autoStopError ? (
                  <SettingsFieldError id="sandbox-auto-stop-error">{autoStopError}</SettingsFieldError>
                ) : null}
              </div>

              <div>
                <label htmlFor="sandbox-auto-archive" className="mb-1.5 block text-sm font-medium text-text-primary">
                  Auto-archive interval (minutes)
                </label>
                <input
                  id="sandbox-auto-archive"
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={autoArchiveIntervalInMinutes}
                  onChange={event => {
                    setAutoArchiveIntervalInMinutes(event.target.value);
                  }}
                  onBlur={() => touch('autoArchive')}
                  placeholder="10080"
                  aria-invalid={isTouched('autoArchive') && autoArchiveError ? true : undefined}
                  aria-describedby={
                    isTouched('autoArchive') && autoArchiveError ? 'sandbox-auto-archive-error' : undefined
                  }
                  className={cn(
                    inputClassName,
                    isTouched('autoArchive') && autoArchiveError && SETTINGS_INPUT_ERROR_CLASS_NAME,
                  )}
                />
                {isTouched('autoArchive') && autoArchiveError ? (
                  <SettingsFieldError id="sandbox-auto-archive-error">{autoArchiveError}</SettingsFieldError>
                ) : null}
              </div>

              <div>
                <label htmlFor="sandbox-auto-delete" className="mb-1.5 block text-sm font-medium text-text-primary">
                  Auto-delete interval (minutes)
                </label>
                <input
                  id="sandbox-auto-delete"
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={autoDeleteIntervalInMinutes}
                  onChange={event => {
                    setAutoDeleteIntervalInMinutes(event.target.value);
                  }}
                  onBlur={() => touch('autoDelete')}
                  placeholder="43200"
                  aria-invalid={isTouched('autoDelete') && autoDeleteError ? true : undefined}
                  aria-describedby={
                    isTouched('autoDelete') && autoDeleteError ? 'sandbox-auto-delete-error' : undefined
                  }
                  className={cn(
                    inputClassName,
                    isTouched('autoDelete') && autoDeleteError && SETTINGS_INPUT_ERROR_CLASS_NAME,
                  )}
                />
                {isTouched('autoDelete') && autoDeleteError ? (
                  <SettingsFieldError id="sandbox-auto-delete-error">{autoDeleteError}</SettingsFieldError>
                ) : null}
              </div>
            </AccordionDetails>
          </Accordion>
        </div>

        <div className="mt-6 space-y-3">
          {error ? <p className="text-failure-bg text-sm">{error}</p> : null}
          <Button type="submit" size="lg" disabled={!isValid || busy} className="w-full shrink-0">
            Save
          </Button>
        </div>
      </form>
    </CenteredModal>
  );
};

export default ConfigureSandboxForm;
