// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import AddMcpServerForm from '@/containers/SettingsBuilder/AddMcpServerForm.js';

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
    const onAdd = vi.fn(async () => undefined);

    render(<AddMcpServerForm open onOpenChange={() => undefined} onAdd={onAdd} />);

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
      expect(onAdd).toHaveBeenCalledWith({
        name: 'analytics-postgres-mcp',
        url: 'https://mcp.example.com/mcp',
        description: 'Query analytics from Postgres',
        auth: { type: 'dcr' },
      });
    });
  });

  it('disables submit until description is filled', () => {
    const onAdd = vi.fn(async () => undefined);

    render(<AddMcpServerForm open onOpenChange={() => undefined} onAdd={onAdd} />);

    fireEvent.change(screen.getByPlaceholderText('analytics-postgres-mcp'), {
      target: { value: 'custom-mcp' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://mcp.example.com/mcp'), {
      target: { value: 'https://mcp.example.com/mcp' },
    });

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Query analytics from Postgres'), {
      target: { value: 'Custom MCP tools' },
    });

    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('shows field-level format and duplicate errors before submitting', () => {
    const onAdd = vi.fn(async () => undefined);

    render(<AddMcpServerForm open onOpenChange={() => undefined} onAdd={onAdd} existingNames={['existing-mcp']} />);

    const name = screen.getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'existing-mcp' } });
    fireEvent.blur(name);
    expect(screen.getByText('Connector name “existing-mcp” already exists.')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');

    const url = screen.getByLabelText('URL');
    fireEvent.change(url, { target: { value: 'ftp://example.com/mcp' } });
    fireEvent.blur(url);
    expect(screen.getByText('URL must use http:// or https://.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('validates API-key auth fields', () => {
    render(<AddMcpServerForm open onOpenChange={() => undefined} onAdd={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByLabelText('API Key'));
    const apiKey = screen.getByLabelText('API key');
    fireEvent.blur(apiKey);
    expect(screen.getByText('API key is required.')).toBeInTheDocument();

    const headerName = screen.getByLabelText(/Header name/);
    fireEvent.change(headerName, { target: { value: 'Bad Header' } });
    fireEvent.blur(headerName);
    expect(screen.getByText(/standard HTTP header symbols/)).toBeInTheDocument();
  });
});
