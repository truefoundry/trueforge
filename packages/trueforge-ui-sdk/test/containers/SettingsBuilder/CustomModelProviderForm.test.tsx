// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import CustomModelProviderForm, {
  type CustomProviderDraft,
} from '@/containers/SettingsBuilder/CustomModelProviderForm.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

function renderForm(onAdd: (draft: CustomProviderDraft) => void | Promise<void> = vi.fn(async () => undefined)) {
  render(
    <CustomModelProviderForm
      open
      onOpenChange={() => undefined}
      onAdd={onAdd}
      reasoningEffortOptions={['low', 'high']}
    />,
  );
  return onAdd as ReturnType<typeof vi.fn>;
}

/** The always-visible required fields (typing the Model ID auto-derives the Model name). */
function fillVisible() {
  fireEvent.change(screen.getByPlaceholderText('local-llama'), { target: { value: 'local-llama' } });
  fireEvent.change(screen.getByPlaceholderText('http://localhost:11434/v1'), {
    target: { value: 'http://localhost:11434/v1' },
  });
  fireEvent.change(screen.getByPlaceholderText('llama3.1:70b'), { target: { value: 'llama3.1:70b' } });
}

/** Expand the (single) model's Advanced section if it is collapsed. */
function expandAdvanced() {
  if (!screen.queryByPlaceholderText('128000')) {
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
  }
}

/** Fill the required per-model limits (Context length + Max output tokens). */
function fillLimits(contextLength = '128000', maxOutputTokens = '4096') {
  expandAdvanced();
  fireEvent.change(screen.getByPlaceholderText('128000'), { target: { value: contextLength } });
  fireEvent.change(screen.getByPlaceholderText('4096'), { target: { value: maxOutputTokens } });
}

/** Everything needed for a valid submit: visible fields + required limits. */
function fillValid() {
  fillVisible();
  fillLimits();
}

describe('CustomModelProviderForm', () => {
  it('enables submit once name, base URL, and model ID are valid (limits are gated on click)', () => {
    renderForm();
    const submit = screen.getByRole('button', { name: 'Add provider' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('local-llama'), { target: { value: 'local-llama' } });
    fireEvent.change(screen.getByPlaceholderText('http://localhost:11434/v1'), {
      target: { value: 'http://localhost:11434/v1' },
    });
    expect(submit).toBeDisabled(); // model ID still empty

    fireEvent.change(screen.getByPlaceholderText('llama3.1:70b'), { target: { value: 'llama3.1:70b' } });
    // Enabled even though the collapsed limits are still empty — the click reveals them.
    expect(submit).toBeEnabled();
  });

  it('shows an inline slug error for an invalid provider name and blocks submit', () => {
    renderForm();
    const name = screen.getByPlaceholderText('local-llama');
    fireEvent.change(name, { target: { value: 'Local Llama' } }); // spaces + capitals
    fireEvent.blur(name);
    expect(screen.getByText(/2–64 lowercase characters/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add provider' })).toBeDisabled();
  });

  it('flags an invalid base URL', () => {
    renderForm();
    const url = screen.getByPlaceholderText('http://localhost:11434/v1');
    fireEvent.change(url, { target: { value: 'not a url' } });
    fireEvent.blur(url);
    expect(screen.getByText('Enter a valid URL.')).toBeInTheDocument();
  });

  it('does not prefill Context length or Max output tokens', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect((screen.getByPlaceholderText('128000') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('4096') as HTMLInputElement).value).toBe('');
  });

  it('requires both limits: submitting empty auto-expands Advanced, shows the error, and does not submit', () => {
    const onAdd = renderForm();
    fillVisible();
    expect(screen.queryByPlaceholderText('128000')).not.toBeInTheDocument(); // Advanced starts collapsed
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    // The offending model's Advanced expands and its required error appears; nothing is submitted.
    expect(screen.getByPlaceholderText('128000')).toBeInTheDocument();
    expect(screen.getByText(/Set the model.s context window/)).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('keeps a newly added model clean after a failed submit attempt', () => {
    renderForm();
    fillVisible(); // model 1 visible-valid, limits still empty
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' })); // reveals model 1's limit errors
    expect(screen.getByText(/Set the model.s context window/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
    // The freshly added (untouched) model must not inherit "required" errors from the submit attempt.
    expect(screen.queryByText('Model ID is required.')).not.toBeInTheDocument();
    expect(screen.queryByText('Model name is required.')).not.toBeInTheDocument();
  });

  it('treats the API key as optional and submits it empty', async () => {
    const onAdd = renderForm();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'local-llama', baseUrl: 'http://localhost:11434/v1', apiKey: '' }),
    );
  });

  it('sends the Context length and Max output tokens the user entered', async () => {
    const onAdd = renderForm();
    fillVisible();
    fillLimits('64000', '2048');
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [
          expect.objectContaining({
            properties: expect.objectContaining({ contextLength: 64000, maxOutputTokens: 2048 }),
          }),
        ],
      }),
    );
  });

  it('includes selected reasoning efforts in properties', async () => {
    const onAdd = renderForm();
    fillValid(); // expands Advanced and fills the required limits
    fireEvent.click(screen.getByRole('switch', { name: /Enable reasoning effort/ }));
    fireEvent.click(screen.getByRole('button', { name: 'low' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [expect.objectContaining({ properties: expect.objectContaining({ reasoningEfforts: ['low'] }) })],
      }),
    );
  });

  it('auto-derives the Model name as a slug from the Model ID', () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('llama3.1:70b'), { target: { value: 'llama3.1:70b' } });
    expect((screen.getByPlaceholderText('llama-3-1-70b') as HTMLInputElement).value).toBe('llama-3-1-70b');
  });

  it('requires the Model name to be a valid slug and blocks submit otherwise', () => {
    renderForm();
    fillVisible();
    const modelName = screen.getByPlaceholderText('llama-3-1-70b');
    fireEvent.change(modelName, { target: { value: 'Bad Name' } }); // spaces + capitals
    fireEvent.blur(modelName);
    expect(screen.getByText(/2–64 lowercase characters/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add provider' })).toBeDisabled();
  });

  it('surfaces the auto-derived Model name error immediately, without a blur or submit', () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('local-llama'), { target: { value: 'local-llama' } });
    fireEvent.change(screen.getByPlaceholderText('http://localhost:11434/v1'), {
      target: { value: 'http://localhost:11434/v1' },
    });
    // An all-digits id slugifies to an empty name. The error must show from typing alone —
    // the id field is never blurred and the disabled button prevents a submit.
    fireEvent.change(screen.getByPlaceholderText('llama3.1:70b'), { target: { value: '123' } });
    expect(screen.getByText('Model name is required.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add provider' })).toBeDisabled();
  });

  it('accepts backend-valid names with adjacent separators (matches NameSchema)', () => {
    renderForm();
    fillVisible();
    const modelName = screen.getByPlaceholderText('llama-3-1-70b');
    // Adjacent/mixed separators are valid under the backend NameSchema; the form must not reject them.
    fireEvent.change(modelName, { target: { value: 'gpt--4.1_turbo' } });
    fireEvent.blur(modelName);
    expect(screen.queryByText(/2–64 lowercase characters/)).not.toBeInTheDocument();
  });

  it('submits the derived slug as the model name', async () => {
    const onAdd = renderForm();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [expect.objectContaining({ id: 'llama3.1:70b', name: 'llama-3-1-70b' })],
      }),
    );
  });
});
