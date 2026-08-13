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
      onSubmit={onAdd}
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
    // Enabled even though the required limits are still empty — they're enforced on submit.
    expect(submit).toBeEnabled();
  });

  it('requires the provider name but defers format validation to the server', () => {
    renderForm();
    const name = screen.getByPlaceholderText('local-llama');
    // A non-empty name with backend-specific format issues is not rejected client-side —
    // the server validates format and surfaces it on submit.
    fireEvent.change(name, { target: { value: 'Local Llama' } }); // spaces + capitals
    fireEvent.blur(name);
    expect(screen.queryByText(/lowercase characters/)).not.toBeInTheDocument();
    // Emptiness is the only client-side check.
    fireEvent.change(name, { target: { value: '' } });
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
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
    // Advanced is expanded by default, so the limits are visible immediately.
    expect((screen.getByPlaceholderText('128000') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('4096') as HTMLInputElement).value).toBe('');
  });

  it('requires both limits: submitting with them empty shows the error and does not submit', () => {
    const onAdd = renderForm();
    fillVisible(); // Advanced is expanded by default; the limits are visible but empty.
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
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
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable reasoning effort/ }));
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

  it('defers Model name format validation to the server', () => {
    renderForm();
    fillVisible();
    const modelName = screen.getByPlaceholderText('llama-3-1-70b');
    fireEvent.change(modelName, { target: { value: 'Bad Name' } }); // spaces + capitals
    fireEvent.blur(modelName);
    // No client-side format error; the server validates the slug on submit.
    expect(screen.queryByText(/lowercase characters/)).not.toBeInTheDocument();
    // A non-empty (if malformed) model name does not block submit client-side.
    expect(screen.getByRole('button', { name: 'Add provider' })).toBeEnabled();
  });

  it('never errors the auto-derived Model name; the user just enters one', () => {
    renderForm();
    const id = screen.getByPlaceholderText('llama3.1:70b');
    // An all-digits id slugifies to an empty name. No error while typing…
    fireEvent.change(id, { target: { value: '111' } });
    expect(screen.queryByText('Model name is required.')).not.toBeInTheDocument();
    // …and none after the id is blurred either — an auto-derived value is never flagged.
    fireEvent.blur(id);
    expect(screen.queryByText('Model name is required.')).not.toBeInTheDocument();
  });

  it('shows only the Model ID error when the id is empty (no stacked name error)', () => {
    renderForm();
    const id = screen.getByPlaceholderText('llama3.1:70b');
    fireEvent.change(id, { target: { value: 'x' } }); // touch, then clear
    fireEvent.change(id, { target: { value: '' } });
    fireEvent.blur(id);
    expect(screen.getByText('Model ID is required.')).toBeInTheDocument();
    expect(screen.queryByText('Model name is required.')).not.toBeInTheDocument();
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

  it('prefills edit values, keeps the provider name immutable, and preserves model properties', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(
      <CustomModelProviderForm
        isEditMode
        open
        onOpenChange={() => undefined}
        onSubmit={onSubmit}
        reasoningEffortOptions={['low', 'high']}
        initialValues={{
          name: 'local-llama',
          baseUrl: 'http://localhost:11434/v1',
          models: [
            {
              id: 'llama3.1:70b',
              name: 'llama-3-1-70b',
              properties: {
                contextLength: 64000,
                maxOutputTokens: 2048,
                reasoningEfforts: ['high'],
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Edit local-llama' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('local-llama')).toHaveValue('local-llama');
    expect(screen.getByPlaceholderText('local-llama')).toHaveAttribute('readonly');
    expect(screen.getByPlaceholderText('http://localhost:11434/v1')).toHaveValue('http://localhost:11434/v1');
    expect(screen.getByPlaceholderText('llama3.1:70b')).toHaveValue('llama3.1:70b');
    expect(screen.getByPlaceholderText('llama-3-1-70b')).toHaveValue('llama-3-1-70b');
    expect(screen.getByPlaceholderText('128000')).toHaveValue(64000);
    expect(screen.getByPlaceholderText('4096')).toHaveValue(2048);
    expect(screen.getByRole('button', { name: 'high' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByPlaceholderText('http://localhost:11434/v1'), {
      target: { value: 'http://localhost:11434/v2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'local-llama',
        baseUrl: 'http://localhost:11434/v2',
        apiKey: '',
        models: [
          expect.objectContaining({
            id: 'llama3.1:70b',
            name: 'llama-3-1-70b',
            properties: {
              contextLength: 64000,
              maxOutputTokens: 2048,
              reasoningEfforts: ['high'],
            },
          }),
        ],
      }),
    );
  });
});
