// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ResetAgentBuilderButton } from '@/atoms/ResetAgentBuilderButton.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

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

  it('resets the builder from the chat header control using the live draft', () => {
    render(wrap(<Harness />));

    fireEvent.click(screen.getByRole('button', { name: 'Prep saved builder' }));
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

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
