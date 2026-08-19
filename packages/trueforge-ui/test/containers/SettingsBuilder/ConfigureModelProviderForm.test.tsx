// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import ConfigureModelProviderForm from '@/containers/SettingsBuilder/ConfigureModelProviderForm.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('ConfigureModelProviderForm', () => {
  it('shows required-key and optional endpoint errors beside their fields', () => {
    render(
      <ConfigureModelProviderForm
        open
        onOpenChange={() => undefined}
        onSave={vi.fn(async () => undefined)}
        title="Configure provider"
      />,
    );

    const apiKey = screen.getByLabelText('API key');
    fireEvent.blur(apiKey);
    expect(screen.getByText('API key is required.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Advanced · custom endpoint'));
    const baseUrl = screen.getByLabelText('Base URL');
    fireEvent.change(baseUrl, { target: { value: 'ftp://example.com' } });
    fireEvent.blur(baseUrl);
    expect(screen.getByText('Base URL must use http:// or https://.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('submits trimmed valid credentials and endpoint', async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <ConfigureModelProviderForm open onOpenChange={() => undefined} onSave={onSave} title="Configure provider" />,
    );

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: ' secret ' } });
    fireEvent.click(screen.getByText('Advanced · custom endpoint'));
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: ' https://api.example.com/v1 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ apiKey: 'secret', baseUrl: 'https://api.example.com/v1' });
    });
  });
});
