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
  models: Array<
    ModelEntry & {
      properties?: {
        reasoningEfforts: string[];
      };
    }
  >;
};

type CustomModelProviderFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (draft: CustomProviderDraft) => void | Promise<void>;
  reasoningEffortOptions?: readonly string[];
  busy?: boolean;
};

type ModelRow = {
  id: string;
  name: string;
  supportedParametersExpanded: boolean;
  reasoningEfforts?: string[];
};

const createEmptyModelRow = (): ModelRow => ({
  id: '',
  name: '',
  supportedParametersExpanded: true,
});

const inputClassName =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40';

const RequiredMark = () => (
  <span className="ml-0.5 text-destructive" aria-hidden>
    *
  </span>
);

const CustomModelProviderForm = ({
  open,
  onOpenChange,
  onAdd,
  reasoningEffortOptions,
  busy = false,
}: CustomModelProviderFormProps) => {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<ModelRow[]>([createEmptyModelRow()]);

  const resetForm = () => {
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModels([createEmptyModelRow()]);
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
          ...(model.reasoningEfforts?.length ? { properties: { reasoningEfforts: model.reasoningEfforts } } : {}),
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

        <fieldset className="m-0 min-w-0 border-0 p-0">
          {/* float clears the extra legend gap some browsers leave inside fieldset */}
          <legend className="float-left mb-2 w-full p-0 text-sm font-medium text-foreground">
            Models
            <RequiredMark />
          </legend>
          <div className="flex clear-both flex-col gap-3">
            {models.map((model, index) => (
              <div key={index} className="rounded-lg border border-border p-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`custom-provider-model-${index}-id`}
                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
                    >
                      Model ID
                    </label>
                    <input
                      id={`custom-provider-model-${index}-id`}
                      type="text"
                      required
                      value={model.id}
                      onChange={event => {
                        updateModel(index, { id: event.target.value });
                      }}
                      placeholder="llama3.1:70b"
                      className={`${inputClassName} min-w-0 font-mono`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`custom-provider-model-${index}-name`}
                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
                    >
                      Display name
                    </label>
                    <input
                      id={`custom-provider-model-${index}-name`}
                      type="text"
                      required
                      value={model.name}
                      onChange={event => {
                        updateModel(index, { name: event.target.value });
                      }}
                      placeholder="Llama 3.1 70B"
                      className={`${inputClassName} min-w-0`}
                    />
                  </div>
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

                {reasoningEffortOptions && reasoningEffortOptions.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-border">
                    <button
                      type="button"
                      aria-expanded={model.supportedParametersExpanded}
                      aria-controls={`custom-provider-model-${index}-parameters`}
                      className="flex w-full cursor-pointer items-start gap-2 px-3 py-2.5 text-left"
                      onClick={() => {
                        updateModel(index, {
                          supportedParametersExpanded: !model.supportedParametersExpanded,
                        });
                      }}
                    >
                      <Icon
                        name="chevron-down"
                        className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${
                          model.supportedParametersExpanded ? 'rotate-180' : ''
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">Supported parameters</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Enable the parameters this model supports. Only these appear when it&apos;s used.
                        </span>
                      </span>
                    </button>

                    {model.supportedParametersExpanded ? (
                      <div id={`custom-provider-model-${index}-parameters`} className="px-3 pb-3">
                        <div className="rounded-lg border border-border px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-foreground">Reasoning effort</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={model.reasoningEfforts !== undefined}
                              aria-label={`Enable reasoning effort for model ${index + 1}`}
                              disabled={busy}
                              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 ${
                                model.reasoningEfforts !== undefined
                                  ? 'bg-primary'
                                  : 'bg-muted-foreground/30 dark:bg-muted-foreground/50'
                              }`}
                              onClick={() => {
                                updateModel(index, {
                                  reasoningEfforts: model.reasoningEfforts === undefined ? [] : undefined,
                                });
                              }}
                            >
                              <span
                                className={`absolute top-0.5 left-0 size-5 rounded-full bg-white shadow-sm transition-transform ${
                                  model.reasoningEfforts !== undefined ? 'translate-x-5' : 'translate-x-0.5'
                                }`}
                              />
                            </button>
                          </div>

                          {model.reasoningEfforts !== undefined ? (
                            <div
                              role="group"
                              aria-label={`Supported reasoning efforts for model ${index + 1}`}
                              className="mt-2 flex flex-wrap gap-2"
                            >
                              {reasoningEffortOptions.map(effort => {
                                const selected = model.reasoningEfforts?.includes(effort) ?? false;
                                return (
                                  <button
                                    key={effort}
                                    type="button"
                                    aria-pressed={selected}
                                    disabled={busy}
                                    className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 ${
                                      selected
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-border text-muted-foreground hover:bg-accent'
                                    }`}
                                    onClick={() => {
                                      updateModel(index, {
                                        reasoningEfforts: selected
                                          ? model.reasoningEfforts?.filter(item => item !== effort)
                                          : [...(model.reasoningEfforts ?? []), effort],
                                      });
                                    }}
                                  >
                                    {effort}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => {
              setModels(current => [...current, createEmptyModelRow()]);
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
