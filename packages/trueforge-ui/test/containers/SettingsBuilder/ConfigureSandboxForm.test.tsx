// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import ConfigureSandboxForm from '@/containers/SettingsBuilder/ConfigureSandboxForm.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('ConfigureSandboxForm', () => {
  it('shows API-key and integer-range errors beside their fields', () => {
    render(
      <ConfigureSandboxForm
        open
        onOpenChange={() => undefined}
        onSave={vi.fn(async () => undefined)}
        title="Configure sandbox"
      />,
    );

    const apiKey = screen.getByLabelText('API key');
    fireEvent.blur(apiKey);
    expect(screen.getByText('API key is required.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Advanced settings'));
    const execTimeout = screen.getByLabelText('Exec timeout (ms)');
    fireEvent.change(execTimeout, { target: { value: '0' } });
    fireEvent.blur(execTimeout);
    expect(screen.getByText('Exec timeout must be a whole number greater than 0.')).toBeInTheDocument();

    const autoStop = screen.getByLabelText('Auto-stop interval (minutes)');
    fireEvent.change(autoStop, { target: { value: '1.5' } });
    fireEvent.blur(autoStop);
    expect(screen.getByText('Auto-stop interval must be a whole number of 0 or more.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('submits valid integer settings', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<ConfigureSandboxForm open onOpenChange={() => undefined} onSave={onSave} title="Configure sandbox" />);

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: ' dtn_secret ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        apiKey: 'dtn_secret',
        execTimeoutMs: 300000,
        autoStopIntervalInMinutes: 15,
        autoArchiveIntervalInMinutes: 10080,
        autoDeleteIntervalInMinutes: 43200,
      });
    });
  });
});
