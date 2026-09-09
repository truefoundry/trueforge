// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import AddMcpServerForm from '@/containers/SettingsBuilder/AddMcpServerForm.js';
import type { ConnectorBase } from '@/server/types.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('AddMcpServerForm', () => {
  it('submits name, url, auth, and trimmed description', async () => {
    const onSubmit = vi.fn(async () => undefined);

    render(<AddMcpServerForm open onOpenChange={() => undefined} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('analytics-postgres-mcp'), {
      target: { value: ' analytics-postgres-mcp ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Query analytics from Postgres'), {
      target: { value: ' Query analytics from Postgres ' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://mcp.example.com/mcp'), {
      target: { value: ' https://mcp.example.com/mcp ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'analytics-postgres-mcp',
        url: 'https://mcp.example.com/mcp',
        description: 'Query analytics from Postgres',
        auth: { type: 'dcr' },
      });
    });
  });

  it('disables submit until description is filled', () => {
    const onSubmit = vi.fn(async () => undefined);

    render(<AddMcpServerForm open onOpenChange={() => undefined} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('analytics-postgres-mcp'), {
      target: { value: 'custom-mcp' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://mcp.example.com/mcp'), {
      target: { value: 'https://mcp.example.com/mcp' },
    });

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Query analytics from Postgres'), {
      target: { value: 'Custom MCP tools' },
    });

    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('prefills connector details and preserves an existing API key when left blank', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const connector: ConnectorBase = {
      id: 'custom-mcp',
      name: 'Custom MCP',
      description: 'Custom tools',
      url: 'https://mcp.example.com/mcp',
      authenticated: true,
      requiresAuth: false,
      auth: { type: 'header', headerName: 'X-API-Key' },
    };

    render(<AddMcpServerForm open connector={connector} onOpenChange={() => undefined} onSubmit={onSubmit} />);

    expect(screen.getByLabelText(/Name/)).toHaveValue(connector.name);
    expect(screen.getByLabelText(/Name/)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/Name/)).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByLabelText(/Name/)).toHaveClass('cursor-not-allowed', 'opacity-70');
    expect(screen.getByLabelText(/Name/)).not.toHaveClass('cursor-text');
    expect(screen.getByLabelText(/Description/)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/URL/)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/URL/)).toHaveClass('cursor-not-allowed');
    expect(screen.getByLabelText(/URL/)).not.toHaveClass('cursor-text');
    expect(screen.getByRole('radio', { name: 'API Key' })).toBeChecked();
    expect(screen.getByLabelText(/Header name/)).toHaveValue('X-API-Key');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: connector.name,
        url: connector.url,
        description: connector.description,
        auth: { type: 'header', apiKey: '', headerName: 'X-API-Key' },
      });
    });
  });

  it('requires a key when changing a connector to API Key auth', () => {
    const connector: ConnectorBase = {
      id: 'custom-mcp',
      name: 'Custom MCP',
      description: 'Custom tools',
      url: 'https://mcp.example.com/mcp',
      authenticated: true,
      requiresAuth: false,
      auth: { type: 'none' },
    };

    render(<AddMcpServerForm open connector={connector} onOpenChange={() => undefined} onSubmit={() => undefined} />);

    fireEvent.click(screen.getByRole('radio', { name: 'API Key' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: 'new-secret' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
