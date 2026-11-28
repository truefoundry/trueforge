// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OnboardingGate } from '@/containers/Onboarding/OnboardingGate.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { ModelProviderBase } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import {
  autoNotConfigured,
  createMockAgentUIServer,
  createMockCatalog,
  tenantSessionSharing,
} from '../../server/mockServer.js';
import { allSettingsSections } from '../../server/settingsCapabilityFixture.js';

const existingProvider: ModelProviderBase = {
  id: 'openai',
  type: 'openai',
  name: 'OpenAI',
  models: [{ id: 'gpt-4.1', name: 'gpt-4-1' }],
};

function renderGate({
  listModelProviders,
  manageProviders = true,
}: {
  listModelProviders: () => Promise<ModelProviderBase[]>;
  manageProviders?: boolean;
}) {
  const server = createMockAgentUIServer({
    catalog: createMockCatalog({
      modelCatalog: {
        getModelProviderCatalog: async () => [],
        listModelProviders,
        createModelProvider: vi.fn(),
        updateModelProvider: vi.fn(),
      },
    }),
    getCapabilities: async () => ({
      data: {
        sandbox: { enabled: true, environments: { enabled: true } },
        skill: { enabled: true },
        auto: autoNotConfigured,
        sessionSharing: tenantSessionSharing,
        settings: { ...allSettingsSections(true), modelProviders: { enabled: true, manageProviders } },
      },
    }),
  });
  return render(
    <ServerProvider server={server}>
      <ShellModeProvider>
        <ShellProbe />
        <SlotsProvider
          overrides={{
            Onboarding: ({ onComplete }) => (
              <button type="button" onClick={onComplete}>
                onboarding
              </button>
            ),
          }}
        >
          <OnboardingGate />
        </SlotsProvider>
      </ShellModeProvider>
    </ServerProvider>,
  );
}

/** Exposes Settings state and a way to open it, so tests can check what onboarding leaves behind. */
function ShellProbe() {
  const shell = useShellMode();
  return (
    <>
      <span>{shell.settingsOpen ? 'settings-open' : 'settings-closed'}</span>
      <button type="button" onClick={() => shell.setSettingsOpen(true, 'models')}>
        open settings
      </button>
    </>
  );
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe('OnboardingGate', () => {
  it('opens onboarding when no model provider exists yet', async () => {
    renderGate({ listModelProviders: async () => [] });
    expect(await screen.findByRole('button', { name: 'onboarding' })).toBeInTheDocument();
  });

  it('closes once onboarding completes', async () => {
    renderGate({ listModelProviders: async () => [] });
    fireEvent.click(await screen.findByRole('button', { name: 'onboarding' }));
    expect(screen.queryByRole('button', { name: 'onboarding' })).not.toBeInTheDocument();
  });

  it('closes Settings when onboarding completes over a Settings page', async () => {
    renderGate({ listModelProviders: async () => [] });
    const onboarding = await screen.findByRole('button', { name: 'onboarding' });
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'open settings' }));
      expect(screen.getByText('settings-open')).toBeInTheDocument();
    });

    fireEvent.click(onboarding);
    expect(screen.getByText('settings-closed')).toBeInTheDocument();
  });

  it('stays closed when a provider is already configured', async () => {
    const listModelProviders = vi.fn(async () => [existingProvider]);
    renderGate({ listModelProviders });
    await waitFor(() => expect(listModelProviders).toHaveBeenCalled());
    await settle();
    expect(screen.queryByRole('button', { name: 'onboarding' })).not.toBeInTheDocument();
  });

  it('never opens for callers who cannot manage providers', async () => {
    const listModelProviders = vi.fn(async () => []);
    renderGate({ listModelProviders, manageProviders: false });
    await settle();
    expect(listModelProviders).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'onboarding' })).not.toBeInTheDocument();
  });

  it('does not block the app when the provider lookup fails', async () => {
    const listModelProviders = vi.fn(() => Promise.reject(new Error('boom')));
    renderGate({ listModelProviders });
    await waitFor(() => expect(listModelProviders).toHaveBeenCalled());
    await settle();
    expect(screen.queryByRole('button', { name: 'onboarding' })).not.toBeInTheDocument();
  });
});
