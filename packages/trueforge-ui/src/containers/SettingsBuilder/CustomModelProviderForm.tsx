'use client';

import { useState, type ReactNode } from 'react';

import { cn } from '../../atoms/lib/cn.js';
import { Button } from '../../atoms/primitives/Button.js';
import { CenteredModal } from '../../atoms/primitives/CenteredModal.js';
import { Icon } from '../../icons/Icon.js';

export type CustomProviderDraft = {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: Array<{
    id: string;
    name: string;
    properties?: {
      reasoningEfforts?: string[];
      contextLength?: number;
      maxOutputTokens?: number;
    };
  }>;
};

export type CustomProviderInitialValues = Omit<CustomProviderDraft, 'apiKey'>;

type CustomModelProviderFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: CustomProviderDraft) => void | Promise<void>;
  isEditMode?: boolean;
  initialValues?: CustomProviderInitialValues;
  reasoningEffortOptions?: readonly string[];
  busy?: boolean;
  error?: string | null;
};

type ModelRow = {
  name: string;
  advancedExpanded: boolean;
  reasoningEfforts?: string[];
  contextLength: string;
  maxOutputTokens: string;
  idTouched?: boolean;
  contextTouched?: boolean;
  maxTouched?: boolean;
  // Set once the user edits the model name by hand, so auto-derive from the id stops.
  nameDirty?: boolean;
  // `id` is the upstream model_id; kept last so object-shorthand stays readable.
  id: string;
};

// Shown only as greyed placeholders — never prefilled, since real limits vary per model
// and a wrong-looking default reads as "already correct".
const PLACEHOLDER_CONTEXT_LENGTH = '128000';
const PLACEHOLDER_MAX_OUTPUT_TOKENS = '4096';

const createEmptyModelRow = (): ModelRow => ({
  id: '',
  name: '',
  // Expanded by default: Context length and Max output tokens are required, so they
  // shouldn't be hidden behind a collapsed section.
  advancedExpanded: true,
  contextLength: '',
  maxOutputTokens: '',
});

const createModelRows = (initialValues?: CustomProviderInitialValues): ModelRow[] =>
  initialValues?.models.map(model => ({
    id: model.id,
    name: model.name,
    advancedExpanded: true,
    reasoningEfforts: model.properties?.reasoningEfforts,
    contextLength: model.properties?.contextLength?.toString() ?? '',
    maxOutputTokens: model.properties?.maxOutputTokens?.toString() ?? '',
    nameDirty: true,
  })) ?? [createEmptyModelRow()];

// Flat, de-boxed input with enough contrast to read as editable: a slightly
// deeper fill, a subtle hairline, and a clear focus ring.
const inputClassName =
  'h-11 w-full rounded-md border border-border/70 bg-secondary-bg px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-secondary/70 focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring/50';
const inputErrorClassName = 'border-failure-bg focus-visible:border-failure-bg focus-visible:ring-failure-bg';

/** Parse an optional positive integer; returns null when empty or invalid (so it's simply omitted). */
function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Derive a NameSchema-valid slug from an upstream model id, e.g. "llama3.1:70b" -> "llama-3-1-70b". */
function slugifyModelId(raw: string): string {
  return raw
    .replace(/([a-zA-Z])(\d)/g, '$1-$2') // split letter→digit boundaries
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // separators → single hyphen
    .replace(/^[^a-z]+/, '') // must start with a letter
    .slice(0, 64) // enforce max length first…
    .replace(/-+$/g, ''); // …then trim any separator truncation left at the end
}

const RequiredMark = () => (
  <span className="ml-0.5 text-failure-bg" aria-hidden>
    *
  </span>
);

const FieldError = ({ children }: { children: ReactNode }) => (
  <p className="mt-1 text-xs text-failure-bg">{children}</p>
);

const FieldHelp = ({ children }: { children: ReactNode }) => (
  <p className="mt-1 text-xs text-text-secondary">{children}</p>
);

const CustomModelProviderForm = ({
  open,
  onOpenChange,
  onSubmit,
  reasoningEffortOptions,
  busy = false,
  error,
  isEditMode = false,
  initialValues,
}: CustomModelProviderFormProps) => {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<ModelRow[]>(() => createModelRows(initialValues));
  const [nameTouched, setNameTouched] = useState(false);
  const [baseUrlTouched, setBaseUrlTouched] = useState(false);

  const resetForm = () => {
    setName(initialValues?.name ?? '');
    setBaseUrl(initialValues?.baseUrl ?? '');
    setApiKey('');
    setModels(createModelRows(initialValues));
    setNameTouched(false);
    setBaseUrlTouched(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const updateModel = (index: number, patch: Partial<ModelRow>) => {
    setModels(current => current.map((model, i) => (i === index ? { ...model, ...patch } : model)));
  };

  // On a submit attempt, reveal errors for every field that already exists. We flip
  // per-field `touched` flags rather than keeping a single global "submitted" flag, so
  // a model added *after* the attempt starts clean instead of showing errors for inputs
  // the user has never touched.
  const markAllTouched = () => {
    setNameTouched(true);
    setBaseUrlTouched(true);
    setModels(current =>
      current.map(model => ({
        ...model,
        idTouched: true,
        contextTouched: true,
        maxTouched: true,
      })),
    );
  };

  // ── Validation ── Client checks stay backend-agnostic: presence only. Name *format*
  // rules (slug pattern, length) belong to the server, which may differ per deployment;
  // violations surface via the `error` prop on submit rather than being second-guessed here.
  const trimmedName = name.trim();
  const nameError = trimmedName ? null : 'Name is required.';

  const trimmedBaseUrl = baseUrl.trim();
  let baseUrlError: string | null = null;
  if (!trimmedBaseUrl) {
    baseUrlError = 'Base URL is required.';
  } else {
    try {
      new URL(trimmedBaseUrl);
    } catch {
      baseUrlError = 'Enter a valid URL.';
    }
  }

  const modelIdError = (model: ModelRow): string | null => (model.id.trim() ? null : 'Model ID is required.');
  const modelNameError = (model: ModelRow): string | null => (model.name.trim() ? null : 'Model name is required.');

  // Both limits are required: the harness budgets a run as input + reserved output ≤ context window.
  const modelContextError = (model: ModelRow): string | null =>
    parsePositiveInt(model.contextLength) == null ? "Set the model's context window." : null;
  const modelMaxOutputError = (model: ModelRow): string | null =>
    parsePositiveInt(model.maxOutputTokens) == null ? 'Set the max output tokens.' : null;

  // The Add-provider button gates on the always-visible fields. The collapsed per-model
  // limits are enforced on submit — auto-expanding and focusing the first offender.
  const visibleValid =
    !nameError && !baseUrlError && models.every(model => !modelIdError(model) && !modelNameError(model));

  const showNameError = nameTouched && nameError;
  const showBaseUrlError = baseUrlTouched && baseUrlError;

  const handleSubmit = async () => {
    markAllTouched();
    if (!visibleValid || busy) return;

    // A required per-model limit is missing: reveal it rather than silently blocking.
    // Expand that model's Advanced section, then scroll to and focus the first empty field.
    const incompleteIndex = models.findIndex(model => modelContextError(model) || modelMaxOutputError(model));
    if (incompleteIndex !== -1) {
      updateModel(incompleteIndex, { advancedExpanded: true });
      const target = models[incompleteIndex];
      const field = target && modelContextError(target) ? 'context-length' : 'max-output-tokens';
      setTimeout(() => {
        const el = document.getElementById(`custom-provider-model-${incompleteIndex}-${field}`);
        // scrollIntoView is unimplemented in jsdom; guard the method so tests don't throw.
        el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        (el as HTMLInputElement | null)?.focus();
      }, 0);
      return;
    }

    try {
      await onSubmit({
        name: trimmedName,
        baseUrl: trimmedBaseUrl,
        apiKey: apiKey.trim(),
        models: models.map(model => {
          const properties: NonNullable<CustomProviderDraft['models'][number]['properties']> = {};
          if (model.reasoningEfforts?.length) properties.reasoningEfforts = model.reasoningEfforts;
          const contextLength = parsePositiveInt(model.contextLength);
          if (contextLength != null) properties.contextLength = contextLength;
          const maxOutputTokens = parsePositiveInt(model.maxOutputTokens);
          if (maxOutputTokens != null) properties.maxOutputTokens = maxOutputTokens;
          return {
            id: model.id.trim(),
            name: model.name.trim(),
            ...(Object.keys(properties).length > 0 ? { properties } : {}),
          };
        }),
      });
      handleOpenChange(false);
    } catch {
      // Parent surfaces error; keep form open.
    }
  };

  return (
    <CenteredModal
      open={open}
      onOpenChange={handleOpenChange}
      title={isEditMode ? `Edit ${initialValues?.name ?? name}` : 'Add custom provider'}
      description={
        isEditMode
          ? 'Update the endpoint, credentials, and models for this provider.'
          : "Connect any OpenAI-compatible endpoint, whether it's a local model, a proxy, or your own hosted service."
      }
      contentSized
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={event => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        {/* Scrollable body — generous bottom padding keeps expanded Advanced clear of the pinned footer */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pt-4 pb-8">
          <div>
            <label htmlFor="custom-provider-name" className="mb-1.5 block text-sm font-medium text-text-primary">
              Name
              <RequiredMark />
            </label>
            <input
              id="custom-provider-name"
              type="text"
              value={name}
              onChange={event => setName(event.target.value)}
              onBlur={() => setNameTouched(true)}
              placeholder="local-llama"
              autoFocus={!isEditMode}
              readOnly={isEditMode}
              aria-readonly={isEditMode}
              aria-invalid={showNameError ? true : undefined}
              className={cn(
                inputClassName,
                isEditMode && 'cursor-not-allowed bg-secondary-bg/60 text-text-secondary',
                showNameError && inputErrorClassName,
              )}
            />
            {isEditMode ? <FieldHelp>Provider names cannot be changed after creation.</FieldHelp> : null}
            {showNameError ? <FieldError>{nameError}</FieldError> : null}
          </div>

          <div>
            <label htmlFor="custom-provider-base-url" className="mb-1.5 block text-sm font-medium text-text-primary">
              Base URL
              <RequiredMark />
            </label>
            <input
              id="custom-provider-base-url"
              type="text"
              value={baseUrl}
              onChange={event => setBaseUrl(event.target.value)}
              onBlur={() => setBaseUrlTouched(true)}
              placeholder="http://localhost:11434/v1"
              autoFocus={isEditMode}
              aria-invalid={showBaseUrlError ? true : undefined}
              className={cn(inputClassName, showBaseUrlError && inputErrorClassName)}
            />
            {showBaseUrlError ? (
              <FieldError>{baseUrlError}</FieldError>
            ) : !trimmedBaseUrl ? (
              <FieldHelp>OpenAI-compatible endpoint, usually ending in /v1.</FieldHelp>
            ) : null}
          </div>

          <div>
            <label htmlFor="custom-provider-api-key" className="mb-1.5 block text-sm font-medium text-text-primary">
              API key
              <span className="font-normal text-text-secondary"> (optional)</span>
            </label>
            <input
              id="custom-provider-api-key"
              type="password"
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
              placeholder="sk-…"
              className={inputClassName}
            />
            <FieldHelp>
              {isEditMode
                ? 'Leave blank to keep the saved key, or enter a new key to replace it.'
                : 'Leave blank if your endpoint needs no key (e.g. a local model).'}
            </FieldHelp>
          </div>

          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="float-left mb-2 w-full p-0 text-sm font-medium text-text-primary">
              Models
              <RequiredMark />
            </legend>

            <div className="clear-both">
              {models.map((model, index) => {
                const idError = modelIdError(model);
                const showIdError = model.idTouched && idError;
                const nameFieldError = modelNameError(model);
                // The Model name is auto-derived from the Model ID and is editable. Never flag an
                // auto-derived value: if the id yields no usable name, stay silent and let the user
                // type one. Only surface an error once they have hand-edited the name themselves.
                const showNameFieldError = !!nameFieldError && model.nameDirty;
                const contextError = modelContextError(model);
                const maxError = modelMaxOutputError(model);
                const showContextError = model.contextTouched && contextError;
                const showMaxError = model.maxTouched && maxError;
                return (
                  <div
                    key={index}
                    className={cn('pb-6', index > 0 ? 'border-t border-border pt-6' : 'pt-1')}
                    style={index > 0 ? { borderTopWidth: '0.5px' } : undefined}
                  >
                    <div className="grid grid-cols-[1fr_1fr_2rem] items-end gap-2">
                      <div className="min-w-0">
                        <label
                          htmlFor={`custom-provider-model-${index}-id`}
                          className="mb-1 block text-xs font-normal text-text-secondary"
                        >
                          Model ID
                        </label>
                        <input
                          id={`custom-provider-model-${index}-id`}
                          type="text"
                          value={model.id}
                          onChange={event => {
                            const id = event.target.value;
                            // Keep the model name in sync with the id until the user edits it by hand.
                            updateModel(index, {
                              id,
                              ...(model.nameDirty ? {} : { name: slugifyModelId(id) }),
                            });
                          }}
                          onBlur={() => updateModel(index, { idTouched: true })}
                          placeholder="llama3.1:70b"
                          aria-invalid={showIdError ? true : undefined}
                          className={cn(inputClassName, 'font-mono', showIdError && inputErrorClassName)}
                        />
                      </div>
                      <div className="min-w-0">
                        <label
                          htmlFor={`custom-provider-model-${index}-name`}
                          className="mb-1 block text-xs font-normal text-text-secondary"
                        >
                          Model name
                        </label>
                        <input
                          id={`custom-provider-model-${index}-name`}
                          type="text"
                          value={model.name}
                          onChange={event => updateModel(index, { name: event.target.value, nameDirty: true })}
                          placeholder="llama-3-1-70b"
                          aria-invalid={showNameFieldError ? true : undefined}
                          className={cn(inputClassName, showNameFieldError && inputErrorClassName)}
                        />
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove model ${index + 1}`}
                        disabled={models.length === 1 || busy}
                        className="mb-0.5 flex size-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
                        onClick={() => setModels(current => current.filter((_, i) => i !== index))}
                      >
                        <Icon name="trash" className="size-4" />
                      </button>
                    </div>
                    {showIdError ? <FieldError>{idError}</FieldError> : null}
                    {showNameFieldError ? <FieldError>{nameFieldError}</FieldError> : null}

                    {/* Advanced (plain text toggle, no surrounding box) */}
                    <div className="mt-2">
                      <button
                        type="button"
                        aria-expanded={model.advancedExpanded}
                        aria-controls={`custom-provider-model-${index}-advanced`}
                        className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-text-primary"
                        onClick={() => updateModel(index, { advancedExpanded: !model.advancedExpanded })}
                      >
                        <Icon
                          name="chevron-down"
                          className={cn(
                            'size-4 text-text-secondary transition-transform',
                            model.advancedExpanded ? '' : '-rotate-90',
                          )}
                        />
                        Advanced
                      </button>

                      {model.advancedExpanded ? (
                        <div id={`custom-provider-model-${index}-advanced`} className="mt-3 space-y-4 pl-6">
                          <div>
                            <label
                              htmlFor={`custom-provider-model-${index}-context-length`}
                              className="mb-1.5 block text-xs font-medium text-text-secondary"
                            >
                              Context length
                              <RequiredMark />
                            </label>
                            <input
                              id={`custom-provider-model-${index}-context-length`}
                              type="number"
                              min={1}
                              inputMode="numeric"
                              value={model.contextLength}
                              onChange={event => updateModel(index, { contextLength: event.target.value })}
                              onBlur={() => updateModel(index, { contextTouched: true })}
                              placeholder={PLACEHOLDER_CONTEXT_LENGTH}
                              aria-invalid={showContextError ? true : undefined}
                              className={cn(inputClassName, showContextError && inputErrorClassName)}
                            />
                            {showContextError ? (
                              <FieldError>{contextError}</FieldError>
                            ) : model.contextLength.trim() === '' ? (
                              <FieldHelp>Model&apos;s total token window.</FieldHelp>
                            ) : null}
                          </div>

                          <div>
                            <label
                              htmlFor={`custom-provider-model-${index}-max-output-tokens`}
                              className="mb-1.5 block text-xs font-medium text-text-secondary"
                            >
                              Max output tokens
                              <RequiredMark />
                            </label>
                            <input
                              id={`custom-provider-model-${index}-max-output-tokens`}
                              type="number"
                              min={1}
                              inputMode="numeric"
                              value={model.maxOutputTokens}
                              onChange={event => updateModel(index, { maxOutputTokens: event.target.value })}
                              onBlur={() => updateModel(index, { maxTouched: true })}
                              placeholder={PLACEHOLDER_MAX_OUTPUT_TOKENS}
                              aria-invalid={showMaxError ? true : undefined}
                              className={cn(inputClassName, showMaxError && inputErrorClassName)}
                            />
                            {showMaxError ? (
                              <FieldError>{maxError}</FieldError>
                            ) : model.maxOutputTokens.trim() === '' ? (
                              <FieldHelp>Longest reply the model allows — use its real limit.</FieldHelp>
                            ) : null}
                          </div>

                          {reasoningEffortOptions && reasoningEffortOptions.length > 0 ? (
                            <div>
                              <label className="flex w-fit cursor-pointer items-center gap-2 select-none">
                                <input
                                  type="checkbox"
                                  className="size-4 shrink-0 cursor-pointer accent-primary-button-bg disabled:cursor-not-allowed disabled:opacity-50"
                                  checked={model.reasoningEfforts !== undefined}
                                  aria-label={`Enable reasoning effort for model ${index + 1}`}
                                  disabled={busy}
                                  onChange={event =>
                                    updateModel(index, {
                                      reasoningEfforts: event.target.checked ? [] : undefined,
                                    })
                                  }
                                />
                                <span className="text-text-secondary text-xs font-medium">Reasoning effort</span>
                              </label>
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
                                        className={cn(
                                          'rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40 disabled:opacity-50',
                                          selected
                                            ? 'border-primary-button-bg bg-primary-button-bg text-primary-button-text'
                                            : 'border-border text-text-secondary hover:bg-ghost-button-hover',
                                        )}
                                        onClick={() =>
                                          updateModel(index, {
                                            reasoningEfforts: selected
                                              ? model.reasoningEfforts?.filter(item => item !== effort)
                                              : [...(model.reasoningEfforts ?? []), effort],
                                          })
                                        }
                                      >
                                        {effort}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <Button
              variant="secondary"
              size="sm"
              type="button"
              className="mt-4 w-fit"
              onClick={() => setModels(current => [...current, createEmptyModelRow()])}
            >
              <Icon name="plus" className="size-3.5" />
              Add model
            </Button>
          </fieldset>
        </div>

        {/* Sticky footer */}
        <div className="shrink-0 space-y-3 border-t border-border px-5 py-4">
          {error ? <p className="text-failure-bg text-sm">{error}</p> : null}
          <Button type="submit" size="lg" disabled={!visibleValid || busy} className="w-full">
            {isEditMode ? 'Save changes' : 'Add provider'}
          </Button>
        </div>
      </form>
    </CenteredModal>
  );
};

export default CustomModelProviderForm;
