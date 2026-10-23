// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResetAgentBuilderButton } from '@/atoms/ResetAgentBuilderButton.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
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

vi.mock('@truefoundry/trueforge-assistant-ui-runtime', () => ({
  useTrueForgeAgentSpec: () => ({
    agentSpec: {
      model: { name: 'live/model' },
      mcpServers: [{ name: 'exa' }],
      config: { sandbox: { enabled: true } },
    },
  }),
}));

function wrap(ui: ReactNode) {
  return (
    <SlotsProvider>
      <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>{ui}</ShellModeProvider>
    </SlotsProvider>
  );
}

function Harness() {
  const shell = useShellMode();
  return (
    <>
      <output data-testid="mode">
        {shell.mode.status === 'active'
          ? JSON.stringify({
              isCreateAgent: shell.mode.isCreateAgent,
              agentId: shell.mode.agentId ?? null,
              agentSpec: shell.mode.agentSpec ?? null,
            })
          : shell.mode.status}
      </output>
      <button
        type="button"
        onClick={() => {
          shell.openAgentBuilder();
          shell.bindMutableAgent({
            agentId: 'saved',
            agentName: 'saved',
            agentSpec: {
              model: { name: 'saved/model' },
              mcpServers: [{ name: 'exa' }],
              config: { sandbox: { enabled: true } },
            },
          });
        }}
      >
        Prep saved builder
      </button>
      <ResetAgentBuilderButton />
    </>
  );
}

describe('ResetAgentBuilderButton', () => {
  it('is hidden outside Build Agent', () => {
    render(wrap(<ResetAgentBuilderButton />));
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  });

  it('asks before resetting the builder from the live draft', () => {
    render(wrap(<Harness />));

    fireEvent.click(screen.getByRole('button', { name: 'Prep saved builder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    const dialog = screen.getByRole('dialog', { name: 'Reset agent config' });
    expect(dialog).toHaveTextContent('Instructions, connectors, and skills will be cleared');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Reset agent config' })).not.toBeInTheDocument();

    const afterCancel = JSON.parse(screen.getByTestId('mode').textContent ?? '{}') as {
      agentId: string | null;
    };
    expect(afterCancel.agentId).toBe('saved');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Reset agent config' })).getByRole('button', { name: 'Reset' }),
    );

    const mode = JSON.parse(screen.getByTestId('mode').textContent ?? '{}') as {
      isCreateAgent: boolean;
      agentId: string | null;
      agentSpec: { model: { name: string }; mcpServers?: unknown[]; config?: unknown };
    };
    expect(mode).toMatchObject({
      isCreateAgent: true,
      agentId: null,
      agentSpec: {
        model: { name: 'live/model' },
        config: { sandbox: { enabled: true } },
      },
    });
    expect(mode.agentSpec).not.toHaveProperty('mcpServers');
  });
});
