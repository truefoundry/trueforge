import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentRuntimeConfigFields } from '@/atoms/draft/AgentRuntimeConfigFields.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentRuntimeConfig } from '@/server/types.js';
import { createMockAgentUIServer, createMockSandboxEnvironmentServer } from '../../server/mockServer.js';

const setEnvironmentsOpen = vi.fn();

vi.mock('@/server/ShellModeContext.js', () => ({
  useOptionalShellMode: () => ({ setEnvironmentsOpen }),
}));

function renderRuntimeFields({
  value = { sandbox: { enabled: true } },
  layout = 'detailed',
  sandboxAvailable = true,
  hasSkills = false,
  environmentsEnabled = true,
  onChange = vi.fn(),
}: {
  value?: AgentRuntimeConfig;
  layout?: 'compact' | 'detailed';
  sandboxAvailable?: boolean;
  hasSkills?: boolean;
  environmentsEnabled?: boolean;
  onChange?: (val: AgentRuntimeConfig) => void;
} = {}) {
  const environmentServer = createMockSandboxEnvironmentServer({
    listEnvironments: async () => ({
      data: [
        {
          id: 'env-default',
          name: 'default',
          description: 'Default environment',
          status: 'ready',
          statusReason: null,
          manifest: { name: 'default', description: 'Default environment' },
          createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
          createdAt: '2026-09-01T10:00:00Z',
          updatedAt: '2026-09-01T10:00:00Z',
        },
        {
          id: 'env-1',
          name: 'python-dev',
          description: 'Python 3.11 environment',
          status: 'ready',
          statusReason: null,
          manifest: { name: 'python-dev', description: 'Python 3.11 environment' },
          createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
          createdAt: '2026-09-01T10:00:00Z',
          updatedAt: '2026-09-01T10:00:00Z',
        },
        {
          id: 'env-2',
          name: 'pending-env',
          description: '',
          status: 'pending',
          statusReason: null,
          manifest: { name: 'pending-env' },
          createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
          createdAt: '2026-09-01T10:00:00Z',
          updatedAt: '2026-09-01T10:00:00Z',
        },
      ],
    }),
  });

  const server = createMockAgentUIServer({
    ...(environmentsEnabled ? { sandboxEnvironments: environmentServer } : {}),
  });

  return render(
    <ServerProvider server={server}>
      <AgentRuntimeConfigFields
        value={value}
        sandboxAvailable={sandboxAvailable}
        hasSkills={hasSkills}
        layout={layout}
        onChange={onChange}
      />
    </ServerProvider>,
  );
}

describe('AgentRuntimeConfigFields', () => {
  it('hides environment controls when sandbox environments are disabled', () => {
    renderRuntimeFields({ environmentsEnabled: false });

    expect(screen.queryByText('Environment')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Manage Environments/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Environment' })).not.toBeInTheDocument();
  });

  it('renders environment row in detailed layout with Manage Environments link', async () => {
    renderRuntimeFields();

    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByText('Saved sandbox setup this agent uses when it runs.')).toBeInTheDocument();

    const manageBtn = screen.getByRole('button', { name: /Manage Environments/ });
    expect(manageBtn).toBeInTheDocument();
    fireEvent.click(manageBtn);
    expect(setEnvironmentsOpen).toHaveBeenCalledWith(true);
  });

  it('hides Manage Environments link when sandbox is off', () => {
    renderRuntimeFields({ value: { sandbox: { enabled: false } } });

    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Manage Environments/ })).not.toBeInTheDocument();
  });

  it('shows skills lock tooltip only when hovering the sandbox switch', () => {
    renderRuntimeFields({ hasSkills: true });

    const sandboxSwitch = screen.getByRole('switch', { name: 'Sandbox' });
    expect(sandboxSwitch).toBeDisabled();

    fireEvent.mouseEnter(screen.getByText('Sandbox'));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    fireEvent.mouseEnter(sandboxSwitch.parentElement!);
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip).toHaveTextContent('Always on while skills are attached — remove them to turn it off');
  });

  it('populates environment dropdown with default and ready environments only', async () => {
    const onChange = vi.fn();
    renderRuntimeFields({ onChange });

    const trigger = screen.getByRole('button', { name: 'Environment' });
    await waitFor(() => {
      expect(trigger).toHaveTextContent('default');
    });

    fireEvent.click(trigger);

    expect(await screen.findByRole('option', { name: 'python-dev' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'default' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'pending-env' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'python-dev' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: expect.objectContaining({
          environment_name: 'python-dev',
        }),
      }),
    );
  });
});
