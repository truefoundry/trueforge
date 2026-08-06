'use client';

import { useState } from 'react';

import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';
import type { ModelEntry } from '../../server/types.js';

export type CustomProviderDraft = {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ModelEntry[];
};

type CustomModelProviderFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (draft: CustomProviderDraft) => void | Promise<void>;
  busy?: boolean;
};

type ModelRow = { id: string; name: string };

const EMPTY_MODEL_ROW: ModelRow = { id: '', name: '' };

const inputClassName =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40';

const RequiredMark = () => (
  <span className="ml-0.5 text-destructive" aria-hidden>
    *
  </span>
);

const CustomModelProviderForm = ({ open, onOpenChange, onAdd, busy = false }: CustomModelProviderFormProps) => {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<ModelRow[]>([EMPTY_MODEL_ROW]);

  const resetForm = () => {
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModels([EMPTY_MODEL_ROW]);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const isValid =
    !!name.trim() && !!baseUrl.trim() && !!apiKey.trim() && models.every(model => model.id.trim() && model.name.trim());

  const updateModel = (index: number, patch: Partial<ModelRow>) => {
    setModels(current => current.map((model, i) => (i === index ? { ...model, ...patch } : model)));
  };

  const handleSubmit = async () => {
    if (!isValid || busy) return;
    try {
      await onAdd({
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        models: models.map(model => ({
          id: model.id.trim(),
          name: model.name.trim(),
        })),
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
      title="Add custom provider"
      description="Any OpenAI-compatible endpoint. Each one stays its own provider."
      contentSized
    >
      <form
        className="flex min-h-0 flex-1 flex-col gap-4 p-5"
        onSubmit={event => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div>
          <label htmlFor="custom-provider-name" className="mb-1.5 block text-sm font-medium text-foreground">
            Name
            <RequiredMark />
          </label>
          <input
            id="custom-provider-name"
            type="text"
            required
            value={name}
            onChange={event => {
              setName(event.target.value);
            }}
            placeholder="Local Llama"
            autoFocus
            className={inputClassName}
          />
        </div>

        <div>
          <label htmlFor="custom-provider-base-url" className="mb-1.5 block text-sm font-medium text-foreground">
            Base URL
            <RequiredMark />
          </label>
          <input
            id="custom-provider-base-url"
            type="text"
            required
            value={baseUrl}
            onChange={event => {
              setBaseUrl(event.target.value);
            }}
            placeholder="http://localhost:11434/v1"
            className={inputClassName}
          />
        </div>

        <div>
          <label htmlFor="custom-provider-api-key" className="mb-1.5 block text-sm font-medium text-foreground">
            API key
            <RequiredMark />
          </label>
          <input
            id="custom-provider-api-key"
            type="password"
            required
            value={apiKey}
            onChange={event => {
              setApiKey(event.target.value);
            }}
            placeholder="sk-..."
            className={inputClassName}
          />
        </div>

        <fieldset>
          <legend className="mb-1.5 block text-sm font-medium text-foreground">
            Models
            <RequiredMark />
          </legend>
          <div className="flex flex-col gap-2">
            {models.map((model, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  required
                  aria-label={`Model ${index + 1} ID`}
                  value={model.id}
                  onChange={event => {
                    updateModel(index, { id: event.target.value });
                  }}
                  placeholder="llama3.1:70b"
                  className={`${inputClassName} font-mono`}
                />
                <input
                  type="text"
                  required
                  aria-label={`Model ${index + 1} display name`}
                  value={model.name}
                  onChange={event => {
                    updateModel(index, { name: event.target.value });
                  }}
                  placeholder="Llama 3.1 70B"
                  className={inputClassName}
                />
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  aria-label={`Remove model ${index + 1}`}
                  disabled={models.length === 1 || busy}
                  className="size-10 shrink-0"
                  onClick={() => {
                    setModels(current => current.filter((_, i) => i !== index));
                  }}
                >
                  <Icon name="trash" className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => {
              setModels(current => [...current, EMPTY_MODEL_ROW]);
            }}
          >
            <Icon name="plus" className="size-3.5" />
            Add model
          </button>
        </fieldset>

        <Button type="submit" size="lg" disabled={!isValid || busy} className="w-full shrink-0">
          Add provider
        </Button>
      </form>
    </CenteredModal>
  );
};

export default CustomModelProviderForm;
