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

/** Fill the required fields with valid values (typing the Model ID auto-derives the Model name). */
function fillValid() {
  fireEvent.change(screen.getByPlaceholderText('local-llama'), { target: { value: 'local-llama' } });
  fireEvent.change(screen.getByPlaceholderText('http://localhost:11434/v1'), {
    target: { value: 'http://localhost:11434/v1' },
  });
  fireEvent.change(screen.getByPlaceholderText('llama3.1:70b'), { target: { value: 'llama3.1:70b' } });
}

describe('CustomModelProviderForm', () => {
  it('disables submit until name, base URL, and model ID are valid', () => {
    renderForm();
    const submit = screen.getByRole('button', { name: 'Add provider' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('local-llama'), { target: { value: 'local-llama' } });
    fireEvent.change(screen.getByPlaceholderText('http://localhost:11434/v1'), {
      target: { value: 'http://localhost:11434/v1' },
    });
    expect(submit).toBeDisabled(); // model ID still empty

    fireEvent.change(screen.getByPlaceholderText('llama3.1:70b'), { target: { value: 'llama3.1:70b' } });
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

  it('treats the API key as optional and submits it empty', async () => {
    const onAdd = renderForm();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'local-llama', baseUrl: 'http://localhost:11434/v1', apiKey: '' }),
    );
  });

  it('sends context_length and max_output_tokens from the prefilled defaults', async () => {
    const onAdd = renderForm();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [expect.objectContaining({ properties: { contextLength: 128000, maxOutputTokens: 4096 } })],
      }),
    );
  });

  it('omits optional properties when their fields are cleared', async () => {
    const onAdd = renderForm();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    fireEvent.change(screen.getByPlaceholderText('128000'), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('4096'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    // No properties key at all when everything optional is empty.
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ models: [{ id: 'llama3.1:70b', name: 'llama-3-1-70b' }] }),
    );
  });

  it('includes selected reasoning efforts in properties', async () => {
    const onAdd = renderForm();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
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
    fillValid();
    const modelName = screen.getByPlaceholderText('llama-3-1-70b');
    fireEvent.change(modelName, { target: { value: 'Bad Name' } }); // spaces + capitals
    fireEvent.blur(modelName);
    expect(screen.getByText(/2–64 lowercase characters/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add provider' })).toBeDisabled();
  });

  it('surfaces a Model name error when the Model ID slugifies to nothing usable', () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('local-llama'), { target: { value: 'local-llama' } });
    fireEvent.change(screen.getByPlaceholderText('http://localhost:11434/v1'), {
      target: { value: 'http://localhost:11434/v1' },
    });
    const id = screen.getByPlaceholderText('llama3.1:70b');
    fireEvent.change(id, { target: { value: '123' } }); // derives an empty model name
    fireEvent.blur(id);
    // The auto-derived name error is visible even though the user never touched the name field.
    expect(screen.getByText('Model name is required.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add provider' })).toBeDisabled();
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
