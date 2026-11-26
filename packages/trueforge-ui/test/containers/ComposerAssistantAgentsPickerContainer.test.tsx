// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsProvider } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { ComposerAssistantAgentsPickerContainer } from '@/containers/ComposerAssistantAgentsPickerContainer.js';
import { resolveRoutesConfig } from '@/routing/paths.js';
import { ShellRouteSync } from '@/routing/ShellRouteSync.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode, type AgentConfig } from '@/server/ShellModeContext.js';
import type { AgentUIServer } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

const useAuiState = vi.hoisted(() => vi.fn());

vi.mock('@assistant-ui/react', () => ({
  useAuiState,
}));

const routes = resolveRoutesConfig();

let pathname = '';
let search = '';

function CaptureLocation() {
  const location = useLocation();
  pathname = location.pathname;
  search = location.search;
  useEffect(() => {
    pathname = location.pathname;
    search = location.search;
  }, [location.pathname, location.search]);
  return null;
}

function ModeProbe() {
  const shell = useShellMode();
  const label =
    shell.mode.status === 'active' && !shell.mode.isMutable
      ? (shell.mode.agentName ?? shell.mode.agentId ?? 'try')
      : shell.mode.status === 'active' && shell.mode.isMutable
        ? shell.mode.isCreateAgent
          ? 'builder'
          : 'draft'
        : 'idle';
  return <output aria-label="Shell mode">{label}</output>;
}

function ExternalTryButton() {
  const shell = useShellMode();
  return (
    <button
      type="button"
      onClick={() =>
        shell.selectLibraryAgent({
          isMutable: false,
          agentId: 'external-id',
          agentName: 'external-agent',
        })
      }
    >
      external try
    </button>
  );
}

function ExternalDraftButton() {
  const shell = useShellMode();
  return (
    <button type="button" onClick={() => shell.openDraft()}>
      external draft
    </button>
  );
}

function renderPicker({
  agentConfig = { mode: 'AgentLibraryWithComposer' },
  initialEntries = ['/'],
  server,
  track,
  isRunning = false,
  remoteId = null as string | null,
  messageCount = 0,
}: {
  agentConfig?: AgentConfig;
  initialEntries?: string[];
  server?: AgentUIServer;
  track?: (eventName: string, data?: Record<string, string | number | boolean | undefined>) => void;
  isRunning?: boolean;
  remoteId?: string | null;
  messageCount?: number;
} = {}) {
  useAuiState.mockImplementation((selector: (state: unknown) => unknown) =>
    selector({
      thread: {
        isRunning,
        isLoading: false,
        messages: Array.from({ length: messageCount }, (_, index) => ({ id: `m-${index}` })),
      },
      threads: { isLoading: false },
      threadListItem: { remoteId },
    }),
  );

  const mockServer =
    server ??
    createMockAgentUIServer({
      searchAgents: vi.fn(async () => ({
        data: [
          { name: 'alpha-bot', agentId: 'alpha-id' },
          { name: 'beta-bot', agentId: 'beta-id' },
        ],
      })),
    });

  function Harness({ children }: { children: ReactNode }) {
    const [remoteId, setRemoteId] = useState<string | undefined>(undefined);
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <SlotsProvider>
          <ServerProvider server={mockServer}>
            <ShellModeProvider agentConfig={agentConfig}>
              <ShellRouteSync routes={routes} activeRemoteId={remoteId} initialSettingsOpen={false} />
              <CaptureLocation />
              <ModeProbe />
              <ExternalTryButton />
              <ExternalDraftButton />
              <button type="button" onClick={() => setRemoteId('session-1')}>
                set remote
              </button>
              {children}
            </ShellModeProvider>
          </ServerProvider>
        </SlotsProvider>
      </MemoryRouter>
    );
  }

  const ui = <ComposerAssistantAgentsPickerContainer />;
  return render(track != null ? <AnalyticsProvider track={track}>{ui}</AnalyticsProvider> : ui, {
    wrapper: Harness,
  });
}

async function openAgentsSubmenu() {
  fireEvent.click(screen.getByRole('button', { name: /Chat mode:/ }));
  const agentsItem = await screen.findByRole('menuitem', { name: /Agents/ });
  fireEvent.mouseEnter(agentsItem);
  fireEvent.click(agentsItem);
  return waitFor(() => expect(screen.getByPlaceholderText('Search agent...')).toBeInTheDocument());
}

describe('ComposerAssistantAgentsPickerContainer', () => {
  beforeEach(() => {
    pathname = '';
    search = '';
    useAuiState.mockReset();
  });

  it('choosing an agent calls selectLibraryAgent with isMutable false and sets try_agent_name', async () => {
    const track = vi.fn();
    renderPicker({ track });

    expect(screen.getByRole('button', { name: 'Chat mode: Assistant' })).toBeInTheDocument();

    await openAgentsSubmenu();
    fireEvent.click(await screen.findByRole('option', { name: 'alpha-bot' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Shell mode')).toHaveTextContent('alpha-bot');
      expect(pathname).toBe('/agents/alpha-bot');
      expect(search).toBe('?try_agent_name=alpha-bot');
    });
    expect(screen.getByRole('button', { name: 'Chat mode: alpha-bot' })).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith(
      AnalyticsEvents.Composer.AGENT_SELECTED,
      expect.objectContaining({ agent_id: 'alpha-id', agent_name: 'alpha-bot' }),
    );
  });

  it('choosing Assistant returns to the draft and clears try_agent_name', async () => {
    renderPicker();

    await openAgentsSubmenu();
    fireEvent.click(await screen.findByRole('option', { name: 'beta-bot' }));
    await waitFor(() => expect(search).toBe('?try_agent_name=beta-bot'));

    fireEvent.click(screen.getByRole('button', { name: 'Chat mode: beta-bot' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Assistant/ }));

    await waitFor(() => {
      expect(screen.getByLabelText('Shell mode')).toHaveTextContent('draft');
      expect(pathname).toBe('/');
      expect(search).toBe('');
    });
    expect(screen.getByRole('button', { name: 'Chat mode: Assistant' })).toBeInTheDocument();
  });

  it('keeps the label in sync when mode changes externally', async () => {
    renderPicker();

    expect(screen.getByRole('button', { name: 'Chat mode: Assistant' })).toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'external try' }).click();
    });
    expect(screen.getByRole('button', { name: 'Chat mode: external-agent' })).toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'external draft' }).click();
    });
    expect(screen.getByRole('button', { name: 'Chat mode: Assistant' })).toBeInTheDocument();
  });

  it('hides the picker when the composer or library is disabled', () => {
    const { unmount } = renderPicker({ agentConfig: { mode: 'AgentComposer' } });
    expect(screen.queryByRole('button', { name: /Chat mode:/ })).not.toBeInTheDocument();
    unmount();

    renderPicker({ agentConfig: { mode: 'AgentLibrary' } });
    expect(screen.queryByRole('button', { name: /Chat mode:/ })).not.toBeInTheDocument();
  });

  it('hides the picker on older history chats', () => {
    renderPicker({ remoteId: 'session-from-history', messageCount: 2 });
    expect(screen.queryByRole('button', { name: /Chat mode:/ })).not.toBeInTheDocument();
  });

  it('disables the picker while a turn is streaming', () => {
    renderPicker({ isRunning: true });
    expect(screen.getByRole('button', { name: 'Chat mode: Assistant' })).toBeDisabled();
  });

  it('marks Assistant as checked in the menu while on a draft', async () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Chat mode: Assistant' }));
    const assistant = await screen.findByRole('menuitem', { name: /Assistant/ });
    expect(assistant).toHaveAttribute('aria-checked', 'true');
  });
});
