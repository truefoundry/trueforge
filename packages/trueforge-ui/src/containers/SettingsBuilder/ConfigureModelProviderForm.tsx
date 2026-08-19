'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { cn } from '../../atoms/lib/cn.js';
import { auiInputClass } from '../../atoms/lib/inputClasses.js';
import { Accordion, AccordionDetails, AccordionSummary } from '../../atoms/primitives/Accordion.js';
import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';
import {
  RequiredMark,
  SETTINGS_INPUT_ERROR_CLASS_NAME,
  SettingsFieldError,
  useTouchedFields,
} from './SettingsFormField.js';
import { validateHttpUrl, validateRequired } from './settingsFormValidation.js';

export type ModelProviderKeyDraft = { apiKey: string; baseUrl: string };

type ConfigureModelProviderFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: ModelProviderKeyDraft) => void | Promise<void>;
  title: string;
  description?: string;
  /** Prefills the Base URL (endpoint). The API key is never autofilled. */
  initialBaseUrl?: string;
  baseUrlPlaceholder?: string;
  /** When false (editing), a blank API key keeps the existing one; a value replaces it. */
  requireApiKey?: boolean;
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
};

const inputClassName = auiInputClass('h-11 shadow-sm');
type ModelProviderField = 'apiKey' | 'baseUrl';
const MODEL_PROVIDER_FIELDS: readonly ModelProviderField[] = ['apiKey', 'baseUrl'];

const ConfigureModelProviderForm = ({
  open,
  onOpenChange,
  onSave,
  title,
  description,
  initialBaseUrl = '',
  baseUrlPlaceholder = 'https://api.openai.com/v1',
  requireApiKey = true,
  submitLabel = 'Save',
  busy = false,
  error,
}: ConfigureModelProviderFormProps) => {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { isTouched, resetTouched, touch, touchAll } = useTouchedFields<ModelProviderField>();

  const resetForm = () => {
    setApiKey('');
    setBaseUrl('');
    setAdvancedOpen(false);
    resetTouched();
  };

  // Prefill the endpoint when the modal opens; the API key is always blank (never echoed back).
  useEffect(() => {
    if (!open) return;
    setApiKey('');
    setBaseUrl(initialBaseUrl);
    setAdvancedOpen(false);
    resetTouched();
  }, [open, initialBaseUrl, resetTouched]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const trimmedKey = apiKey.trim();
  const apiKeyError = requireApiKey ? validateRequired({ value: apiKey, label: 'API key' }) : null;
  const baseUrlError = validateHttpUrl({ value: baseUrl, label: 'Base URL', required: false });
  const isValid = !apiKeyError && !baseUrlError;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    touchAll(MODEL_PROVIDER_FIELDS);
    if (!isValid || busy) return;
    try {
      await onSave({ apiKey: trimmedKey, baseUrl: baseUrl.trim() });
      resetForm();
      onOpenChange(false);
    } catch {
      // Parent surfaces the error via the `error` prop; keep the modal open.
    }
  };

  return (
    <CenteredModal open={open} onOpenChange={handleOpenChange} title={title} description={description} contentSized>
      <form className="flex flex-col overflow-y-auto p-5 md:p-6" noValidate onSubmit={handleSubmit}>
        <div className="space-y-4">
          <div>
            <label htmlFor="model-provider-api-key" className="mb-1.5 block text-sm font-medium text-text-primary">
              API key
              {requireApiKey ? <RequiredMark /> : null}
              {!requireApiKey ? <span className="font-normal text-text-secondary"> (optional)</span> : null}
            </label>
            <input
              id="model-provider-api-key"
              type="password"
              required={requireApiKey}
              value={apiKey}
              onChange={event => {
                setApiKey(event.target.value);
              }}
              onBlur={() => touch('apiKey')}
              placeholder={requireApiKey ? 'Enter API key' : 'Enter a new key'}
              autoFocus
              aria-invalid={isTouched('apiKey') && apiKeyError ? true : undefined}
              aria-describedby={isTouched('apiKey') && apiKeyError ? 'model-provider-api-key-error' : undefined}
              className={cn(inputClassName, isTouched('apiKey') && apiKeyError && SETTINGS_INPUT_ERROR_CLASS_NAME)}
            />
            {isTouched('apiKey') && apiKeyError ? (
              <SettingsFieldError id="model-provider-api-key-error">{apiKeyError}</SettingsFieldError>
            ) : !requireApiKey ? (
              <p className="mt-1.5 text-xs text-text-secondary">
                Leave blank to keep the current key; enter a new one to replace it.
              </p>
            ) : null}
          </div>

          <Accordion
            expanded={advancedOpen}
            onChange={(_event, next) => setAdvancedOpen(next)}
            className="rounded-md border border-border"
          >
            <AccordionSummary className="px-3 py-2.5">
              <span className="flex w-full items-center justify-between text-sm font-medium text-text-primary">
                Advanced · custom endpoint
                <Icon
                  name="chevron-down"
                  className={cn(
                    'size-4 shrink-0 text-text-secondary transition-transform duration-200',
                    advancedOpen ? 'rotate-0' : '-rotate-90',
                  )}
                />
              </span>
            </AccordionSummary>
            <AccordionDetails className="space-y-1.5 border-t border-border px-3 pb-3 pt-4">
              <label htmlFor="model-provider-base-url" className="block text-sm font-medium text-text-primary">
                Base URL
              </label>
              <input
                id="model-provider-base-url"
                type="url"
                value={baseUrl}
                onChange={event => {
                  setBaseUrl(event.target.value);
                }}
                onBlur={() => touch('baseUrl')}
                placeholder={baseUrlPlaceholder}
                aria-invalid={isTouched('baseUrl') && baseUrlError ? true : undefined}
                aria-describedby={isTouched('baseUrl') && baseUrlError ? 'model-provider-base-url-error' : undefined}
                className={cn(inputClassName, isTouched('baseUrl') && baseUrlError && SETTINGS_INPUT_ERROR_CLASS_NAME)}
              />
              {isTouched('baseUrl') && baseUrlError ? (
                <SettingsFieldError id="model-provider-base-url-error">{baseUrlError}</SettingsFieldError>
              ) : (
                <p className="text-xs text-text-secondary">Leave blank unless you use a regional or proxy endpoint.</p>
              )}
            </AccordionDetails>
          </Accordion>
        </div>

        <div className="mt-6 space-y-3">
          {error ? <p className="text-failure-bg text-sm">{error}</p> : null}
          <Button type="submit" size="lg" disabled={!isValid || busy} className="w-full shrink-0">
            {submitLabel}
          </Button>
        </div>
      </form>
    </CenteredModal>
  );
};

export default ConfigureModelProviderForm;
