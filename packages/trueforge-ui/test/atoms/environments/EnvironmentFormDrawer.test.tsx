// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentFormDrawer } from '@/atoms/environments/EnvironmentFormDrawer.js';
import { ToasterProvider } from '@/containers/ToasterContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { SandboxEnvironmentServer } from '@/server/types.js';
import { createMockAgentUIServer, createMockSandboxEnvironmentServer } from '../../server/mockServer.js';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});

afterEach(() => {
  if (originalShowModal === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  }
  if (originalClose === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  }
});

function renderDrawer({
  environmentOverrides = {},
  onSaved = vi.fn(),
}: {
  environmentOverrides?: Partial<SandboxEnvironmentServer>;
  onSaved?: () => void;
} = {}) {
  const createOrUpdateEnvironment = vi.fn(async ({ manifest }) => ({
    id: 'e1',
    name: manifest.name,
    description: manifest.description ?? '',
    status: 'pending' as const,
    statusReason: null,
    manifest,
    createdBySubject: {
      subjectId: 'user-1',
      subjectType: 'user',
      subjectDisplayName: 'alice',
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }));
  const environmentServer = createMockSandboxEnvironmentServer({
    createOrUpdateEnvironment,
    ...environmentOverrides,
  });
  const server = createMockAgentUIServer({ sandboxEnvironments: environmentServer });
  const onOpenChange = vi.fn();

  render(
    <ServerProvider server={server}>
      <ToasterProvider>
        <EnvironmentFormDrawer open mode="create" onOpenChange={onOpenChange} onSaved={onSaved} />
      </ToasterProvider>
    </ServerProvider>,
  );

  return { createOrUpdateEnvironment, onOpenChange, onSaved };
}

describe('EnvironmentFormDrawer', () => {
  it('saves UI form values', async () => {
    const { createOrUpdateEnvironment, onSaved } = renderDrawer();
    const nameInput = screen.getByPlaceholderText('my-environment');
    fireEvent.change(nameInput, { target: { value: 'node-web' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(createOrUpdateEnvironment).toHaveBeenCalled();
    });
    expect(createOrUpdateEnvironment.mock.calls[0]?.[0]?.manifest.name).toBe('node-web');
    expect(onSaved).toHaveBeenCalled();
  });

  it('confirms when switching modes while dirty', async () => {
    renderDrawer();
    fireEvent.change(screen.getByPlaceholderText('my-environment'), { target: { value: 'dirty-env' } });
    fireEvent.click(screen.getByRole('button', { name: 'YAML' }));
    expect(await screen.findByRole('button', { name: 'Yes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('my-environment')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument();
  });
});
