// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsProvider } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import type { TrackAnalytics } from '@/analytics/types.js';
import { EnvironmentFormDrawer } from '@/atoms/environments/EnvironmentFormDrawer.js';
import { ToasterProvider } from '@/containers/ToasterContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { SandboxEnvironment, SandboxEnvironmentServer } from '@/server/types.js';
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

const editEnvironment: SandboxEnvironment = {
  id: 'e1',
  name: 'node-web',
  description: '',
  status: 'ready',
  statusReason: null,
  manifest: { name: 'node-web', description: '' },
  createdBySubject: {
    subjectId: 'user-1',
    subjectType: 'user',
    subjectDisplayName: 'alice',
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function renderDrawer({
  mode = 'create',
  environment,
  environmentOverrides = {},
  onSaved = vi.fn(),
  track,
}: {
  mode?: 'create' | 'edit';
  environment?: SandboxEnvironment;
  environmentOverrides?: Partial<SandboxEnvironmentServer>;
  onSaved?: () => void;
  track?: TrackAnalytics;
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

  const tree = (
    <ServerProvider server={server}>
      <ToasterProvider>
        <EnvironmentFormDrawer
          open
          mode={mode}
          environment={environment}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      </ToasterProvider>
    </ServerProvider>
  );
  render(track != null ? <AnalyticsProvider track={track}>{tree}</AnalyticsProvider> : tree);

  return { createOrUpdateEnvironment, onOpenChange, onSaved, track };
}

describe('EnvironmentFormDrawer', () => {
  it('saves UI form values', async () => {
    const track = vi.fn();
    const { createOrUpdateEnvironment, onSaved } = renderDrawer({ track });
    expect(screen.queryByRole('button', { name: 'YAML' })).not.toBeInTheDocument();
    const nameInput = screen.getByPlaceholderText('my-environment');
    fireEvent.change(nameInput, { target: { value: 'node-web' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(createOrUpdateEnvironment).toHaveBeenCalled();
    });
    expect(createOrUpdateEnvironment.mock.calls[0]?.[0]?.manifest.name).toBe('node-web');
    expect(onSaved).toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Environment.CREATED, {
      environment_name: 'node-web',
      environment_id: 'e1',
    });
  });

  it('saves UI form values in edit without a YAML switch', async () => {
    const { createOrUpdateEnvironment, onSaved } = renderDrawer({ mode: 'edit', environment: editEnvironment });
    expect(screen.queryByRole('button', { name: 'YAML' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('write description ...'), {
      target: { value: 'updated description' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(createOrUpdateEnvironment).toHaveBeenCalled();
    });
    expect(createOrUpdateEnvironment.mock.calls[0]?.[0]?.manifest.description).toBe('updated description');
    expect(onSaved).toHaveBeenCalled();
  });
});
