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
  webSearch,
  memory,
  onChange = vi.fn(),
}: {
  value?: AgentRuntimeConfig;
  layout?: 'compact' | 'detailed';
  sandboxAvailable?: boolean;
  hasSkills?: boolean;
  webSearch?: { enabled: boolean; reason?: string };
  memory?: { enabled: boolean; reason?: string };
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
    sandboxEnvironments: environmentServer,
    getCapabilities: async () => ({
      data: {
        sandbox: { enabled: true, environments: { enabled: true } },
        skill: { enabled: true },
        ...(webSearch === undefined ? {} : { webSearch }),
        ...(memory === undefined ? {} : { memory }),
      },
    }),
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
  it('defaults the iteration limit to 1024', () => {
    renderRuntimeFields();

    expect(screen.getByRole('spinbutton', { name: 'Iteration limit' })).toHaveValue(1024);
  });

  it('preserves an explicit iteration limit', () => {
    renderRuntimeFields({ value: { iterationLimit: 512 } });

    expect(screen.getByRole('spinbutton', { name: 'Iteration limit' })).toHaveValue(512);
  });

  it('renders environment row in detailed layout with Manage Environments link', async () => {
    renderRuntimeFields();

    expect(await screen.findByText('Environment')).toBeInTheDocument();
    expect(screen.getByText('Saved sandbox setup this agent uses when it runs.')).toBeInTheDocument();

    const manageBtn = screen.getByRole('button', { name: /Manage Environments/ });
    expect(manageBtn).toBeInTheDocument();
    fireEvent.click(manageBtn);
    expect(setEnvironmentsOpen).toHaveBeenCalledWith(true);
  });

  it('hides Manage Environments link when sandbox is off', async () => {
    renderRuntimeFields({ value: { sandbox: { enabled: false } } });

    expect(await screen.findByText('Environment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Manage Environments/ })).not.toBeInTheDocument();
  });

  it('shows a sandbox-off warning only when a provider exists and the switch is off', () => {
    const warning = "Disabling sandbox will degrade trueforge's performance.";

    const { unmount: unmountOff } = renderRuntimeFields({ value: { sandbox: { enabled: false } } });
    expect(screen.getByRole('status')).toHaveTextContent(warning);
    unmountOff();

    const { unmount: unmountOn } = renderRuntimeFields();
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    unmountOn();

    const { unmount: unmountUnavailable } = renderRuntimeFields({
      value: { sandbox: { enabled: false } },
      sandboxAvailable: false,
    });
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    unmountUnavailable();

    renderRuntimeFields({ hasSkills: true, value: { sandbox: { enabled: true } } });
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
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

  it('keeps the web search switch visible and locked with the host reason', async () => {
    renderRuntimeFields({ webSearch: { enabled: false, reason: 'Web search is turned off for this tenant.' } });

    // Re-query each poll: the row only locks once capabilities resolve, which re-renders it.
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Web search' })).toBeDisabled();
    });
    const webSearchSwitch = screen.getByRole('switch', { name: 'Web search' });
    expect(webSearchSwitch).not.toBeChecked();

    fireEvent.mouseEnter(webSearchSwitch.parentElement!);
    expect(document.querySelector('[role="tooltip"]')).toHaveTextContent('Web search is turned off for this tenant.');
  });

  it('lets a spec that already searches the web turn it off while the host says no', async () => {
    const onChange = vi.fn();
    renderRuntimeFields({ value: { webSearch: { enabled: true } }, webSearch: { enabled: false }, onChange });

    const webSearchSwitch = screen.getByRole('switch', { name: 'Web search' });
    expect(webSearchSwitch).toBeEnabled();
    expect(webSearchSwitch).toBeChecked();

    // Turning it off is the last chance, so the row has to say so before the click.
    expect(await screen.findByText(/Turning it off here is final/)).toBeInTheDocument();

    fireEvent.click(webSearchSwitch);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ webSearch: { enabled: false } }));
  });

  it('does not caution a spec the host still allows', async () => {
    renderRuntimeFields({ value: { webSearch: { enabled: true } }, webSearch: { enabled: true } });

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Web search' })).toBeChecked();
    });
    expect(screen.queryByText(/Turning it off here is final/)).not.toBeInTheDocument();
  });

  it('populates environment dropdown with default and ready environments only', async () => {
    const onChange = vi.fn();
    renderRuntimeFields({ onChange });

    const trigger = await screen.findByRole('button', { name: 'Environment' });
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
          environmentName: 'python-dev',
        }),
      }),
    );
  });

  it('shows a missing agent-spec environment as the selected option', async () => {
    renderRuntimeFields({
      value: { sandbox: { enabled: true, environmentName: 'gone-env' } },
    });

    const trigger = await screen.findByRole('button', { name: 'Environment' });
    await waitFor(() => {
      expect(trigger).toHaveTextContent('gone-env');
    });
    expect(trigger).not.toHaveTextContent('unavailable');

    fireEvent.click(trigger);
    const missing = await screen.findByRole('option', { name: 'gone-env' });
    expect(missing).toBeDisabled();
    expect(missing).toHaveAttribute('aria-selected', 'true');
  });

  it('hides memory when the host does not offer it', async () => {
    renderRuntimeFields({ webSearch: { enabled: true } });

    expect(await screen.findByRole('switch', { name: 'Web search' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Memory' })).not.toBeInTheDocument();
    expect(screen.queryByText('Memory')).not.toBeInTheDocument();
  });

  it('toggles memory when the host offers it', async () => {
    const onChange = vi.fn();
    renderRuntimeFields({ memory: { enabled: true }, onChange });

    const memorySwitch = await screen.findByRole('switch', { name: 'Memory' });
    expect(memorySwitch).not.toBeDisabled();
    expect(memorySwitch).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(memorySwitch);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ memory: { enabled: true } }));
  });

  it('locks memory off with the host reason when the tenant turned it off', async () => {
    renderRuntimeFields({ memory: { enabled: false, reason: 'Memory is turned off for this tenant.' } });

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Memory' })).toBeDisabled();
    });
    const memorySwitch = screen.getByRole('switch', { name: 'Memory' });
    expect(memorySwitch).not.toBeChecked();

    fireEvent.mouseEnter(memorySwitch.parentElement ?? memorySwitch);
    expect(document.querySelector('[role="tooltip"]')).toHaveTextContent('Memory is turned off for this tenant.');
  });

  it('lets a spec with memory on turn it off while the tenant is off, and warns it is final', async () => {
    const onChange = vi.fn();
    renderRuntimeFields({ value: { memory: { enabled: true } }, memory: { enabled: false }, onChange });

    const memorySwitch = await screen.findByRole('switch', { name: 'Memory' });
    expect(memorySwitch).toBeEnabled();
    expect(memorySwitch).toBeChecked();
    expect(await screen.findByText(/Memory is off for this tenant/)).toBeInTheDocument();

    fireEvent.click(memorySwitch);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ memory: { enabled: false } }));
  });

  it('shows a wire-only sandbox environment name and clears it when default is chosen', async () => {
    const onChange = vi.fn();
    const sandbox: NonNullable<AgentRuntimeConfig['sandbox']> = { enabled: true };
    Reflect.set(sandbox, 'environment_name', 'test');
    renderRuntimeFields({ value: { sandbox }, onChange });

    const trigger = await screen.findByRole('button', { name: 'Environment' });
    await waitFor(() => {
      expect(trigger).toHaveTextContent('test');
    });

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'default' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: expect.objectContaining({ enabled: true, environmentName: undefined }),
      }),
    );
    const update: unknown = onChange.mock.calls[0]?.[0];
    if (typeof update !== 'object' || update === null || !('sandbox' in update)) {
      throw new Error('expected sandbox update');
    }
    expect(update.sandbox).not.toHaveProperty('environment_name');
  });
});
