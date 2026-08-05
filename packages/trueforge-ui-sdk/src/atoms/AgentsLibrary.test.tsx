// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ServerProvider } from '../server/ServerContext.js';
import { ShellModeProvider } from '../server/ShellModeContext.js';
import type { AgentUIServer } from '../server/types.js';
import { SlotsProvider } from '../theme/SlotsProvider.js';
import { AgentsLibrary } from './AgentsLibrary.js';
import { AgentsLibraryButton } from './AgentsLibraryButton.js';
import { CenteredModal } from './primitives/CenteredModal.js';

beforeAll(() => {
  // jsdom does not implement HTMLDialogElement showModal/close.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

function mockServer(agents: Array<{ name: string }> = [{ name: 'alpha-agent' }]): AgentUIServer {
  return {
    searchAgents: vi.fn(async () => agents),
  } as unknown as AgentUIServer;
}

describe('CenteredModal', () => {
  it('opens with desktop-centered and mobile bottom-sheet classes', () => {
    render(
      <CenteredModal open onOpenChange={() => undefined} title="Demo">
        <p>body</p>
      </CenteredModal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Demo' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog.className).toContain('mt-auto');
    expect(dialog.className).toContain('md:m-auto');
    expect(dialog.className).toContain('rounded-t-xl');
    expect(dialog.className).toContain('md:rounded-xl');
    expect(dialog.className).toContain('md:max-w-5xl');
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('closes via the close button', () => {
    const onOpenChange = vi.fn();
    render(
      <CenteredModal open onOpenChange={onOpenChange} title="Demo">
        <p>body</p>
      </CenteredModal>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('AgentsLibrary', () => {
  it('lists agents and selects a named agent', async () => {
    const server = mockServer([{ name: 'alpha-agent' }, { name: 'beta-agent' }]);
    const onSelectAgent = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <AgentsLibrary open onOpenChange={onOpenChange} onSelectAgent={onSelectAgent} />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    expect(screen.getByRole('dialog', { name: 'Agents Library' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try agent alpha-agent' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Try agent beta-agent' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSelectAgent).toHaveBeenCalledWith('beta-agent');
  });
});

describe('AgentsLibraryButton', () => {
  it('opens the Agents Library dialog from the trigger', async () => {
    const server = mockServer([{ name: 'alpha-agent' }]);

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <AgentsLibraryButton />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Agents Library/ }));
    expect(screen.getByRole('dialog', { name: 'Agents Library' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try agent alpha-agent' })).toBeInTheDocument();
    });
  });
});
