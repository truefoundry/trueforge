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
});
