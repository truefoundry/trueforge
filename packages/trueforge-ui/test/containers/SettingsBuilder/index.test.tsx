// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import TruefoundrySettingsBuilder from '@/containers/SettingsBuilder/index.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { AgentUIServer, SandboxCatalogServer, SkillCatalogServer } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

vi.mock('@/containers/SettingsBuilder/ModelSettings.js', () => ({
  default: () => <div>Model settings content</div>,
}));

vi.mock('@/containers/SettingsBuilder/ConnectorSettings.js', () => ({
  default: () => <div>Connector settings content</div>,
}));

vi.mock('@/containers/SettingsBuilder/SkillSettings.js', () => ({
  default: () => <div>Skill settings content</div>,
}));

vi.mock('@/containers/SettingsBuilder/SandboxSettings.js', () => ({
  default: () => <div>Sandbox settings content</div>,
}));

async function unavailable(): Promise<never> {
  throw new Error('Unexpected settings section call');
}

const skillCatalog: SkillCatalogServer = {
  getSkillCatalog: async () => [],
  listSkills: async () => [],
  createSkill: unavailable,
};

const sandboxCatalog: SandboxCatalogServer = {
  getSandboxProviderCatalog: async () => [],
  listSandboxProviders: async () => [],
  createSandboxProvider: unavailable,
  updateSandboxProvider: unavailable,
};

function createServer(options: { catalog?: boolean; skills?: boolean; sandbox?: boolean } = {}): AgentUIServer {
  if (options.catalog === false) {
    return createMockAgentUIServer();
  }
  return createMockAgentUIServer({
    catalog: createMockCatalog({
      ...(options.skills ? { skillCatalog } : {}),
      ...(options.sandbox ? { sandboxCatalog } : {}),
    }),
  });
}

function SettingsControls() {
  const { setSettingsOpen } = useShellMode();
  return (
    <>
      <button type="button" onClick={() => setSettingsOpen(true)}>
        Open settings
      </button>
      <button type="button" onClick={() => setSettingsOpen(false)}>
        Switch to agent
      </button>
    </>
  );
}

function TestShell({ server, children }: { server?: AgentUIServer; children?: ReactNode }) {
  const content = (
    <DraftCatalogProvider>
      <ShellModeProvider>
        <SettingsControls />
        <TruefoundrySettingsBuilder />
        {children}
      </ShellModeProvider>
    </DraftCatalogProvider>
  );
  return server === undefined ? content : <ServerProvider server={server}>{content}</ServerProvider>;
}

async function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });
}

describe('TruefoundrySettingsBuilder', () => {
  it('stays hidden while closed and when no settings catalog is available', async () => {
    const { rerender } = render(<TestShell server={createServer()} />);

    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();

    await openSettings();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();

    rerender(<TestShell server={createServer({ catalog: false })} />);
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();

    rerender(<TestShell />);
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('only exposes optional sections backed by catalogs', async () => {
    const { rerender } = render(<TestShell server={createServer()} />);
    await openSettings();

    expect(screen.getByRole('button', { name: 'Models' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Connectors' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skills' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sandbox' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Model settings content')).toBeInTheDocument();
    });

    rerender(<TestShell server={createServer({ skills: true, sandbox: true })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    await waitFor(() => {
      expect(screen.getByText('Skill settings content')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sandbox providers' }));
    await waitFor(() => {
      expect(screen.getByText('Sandbox settings content')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
    await waitFor(() => {
      expect(screen.getByText('Connector settings content')).toBeInTheDocument();
    });
  });

  it('resets a stale optional section when its catalog disappears', async () => {
    const { rerender } = render(<TestShell server={createServer({ skills: true })} />);
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));

    await waitFor(() => {
      expect(screen.getByText('Skill settings content')).toBeInTheDocument();
    });

    rerender(<TestShell server={createServer()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Models' })).toHaveAttribute('aria-current', 'page');
    });
    await waitFor(() => {
      expect(screen.getByText('Model settings content')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Skills' })).not.toBeInTheDocument();
  });

  it('closes on Escape without leaking the event to a parent handler', async () => {
    const parentKeyDown = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <TestShell server={createServer()} />
      </div>,
    );
    await openSettings();

    fireEvent.keyDown(screen.getByRole('heading', { name: 'Settings' }), { key: 'Escape' });

    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('closes via the Back control', async () => {
    render(<TestShell server={createServer()} />);
    await openSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
  });

  async function expectCatalogsRefreshOnClose(close: () => void) {
    const getModels = vi.fn(async () => []);
    const getSkills = vi.fn(async () => []);
    const getMcp = vi.fn(async () => []);
    const getCapabilities = vi.fn(async () => ({
      data: { sandbox: { enabled: true }, skill: { enabled: true } },
    }));
    const server = createMockAgentUIServer({
      catalog: createMockCatalog(),
      getModels,
      getSkills,
      getMcp,
      getCapabilities,
    });
    render(<TestShell server={server} />);
    await openSettings();
    await waitFor(() => expect(getCapabilities).toHaveBeenCalled());
    const capabilitiesCallsAfterOpen = getCapabilities.mock.calls.length;

    close();

    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    await waitFor(() => expect(getModels).toHaveBeenCalledOnce());
    expect(getSkills).toHaveBeenCalledOnce();
    expect(getMcp).toHaveBeenCalledOnce();
    await waitFor(() => expect(getCapabilities.mock.calls.length).toBeGreaterThan(capabilitiesCallsAfterOpen));
  }

  it('refreshes composer catalogs when settings close', async () => {
    await expectCatalogsRefreshOnClose(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
  });

  it('refreshes composer catalogs when leaving settings for a chat or named agent', async () => {
    await expectCatalogsRefreshOnClose(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Switch to agent' }));
    });
  });

  it('does not reopen settings when a stale optional section is reset while closed', async () => {
    const { rerender } = render(<TestShell server={createServer({ skills: true })} />);
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    await waitFor(() => {
      expect(screen.getByText('Skill settings content')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch to agent' }));
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();

    rerender(<TestShell server={createServer()} />);

    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
