// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CustomProviderDraft } from '@/containers/SettingsBuilder/CustomModelProviderForm.js';
import ModelSettings from '@/containers/SettingsBuilder/ModelSettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type {
  AgentBuilderCapabilitiesResponse,
  ConfigurationServer,
  ModelProviderBase,
  UpdateModelProviderRequest,
} from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog, tenantSessionSharing } from '../../server/mockServer.js';
import { allSettingsSections } from '../../server/settingsCapabilityFixture.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

const customProvider: ModelProviderBase<CustomProviderDraft['models'][number]> = {
  id: 'local-llama',
  type: 'custom',
  name: 'local-llama',
  baseUrl: 'http://localhost:11434/v1',
  models: [
    {
      id: 'llama3.1:70b',
      name: 'llama-3-1-70b',
      properties: {
        contextLength: 64000,
        maxOutputTokens: 2048,
        reasoningEfforts: ['high'],
      },
    },
  ],
};

const builtInProvider: ModelProviderBase = {
  id: 'openai',
  type: 'openai',
  name: 'OpenAI',
  models: [{ id: 'gpt-4.1', name: 'gpt-4-1' }],
};

describe('ModelSettings custom provider editing', () => {
  it('opens the custom provider modal from Edit and updates the provider from the prefilled form', async () => {
    const updateModelProvider = vi.fn(async (request: UpdateModelProviderRequest) => ({
      ...customProvider,
      baseUrl: request.baseUrl,
      models: request.models,
    }));
    const server = createMockAgentUIServer({
      catalog: createMockCatalog({
        modelCatalog: {
          getModelProviderCatalog: async () => [
            {
              type: 'custom',
              name: 'custom',
              models: [],
              supportedReasoningEfforts: ['low', 'high'],
            },
          ],
          listModelProviders: async () => [customProvider, builtInProvider],
          createModelProvider: vi.fn(),
          updateModelProvider,
        },
      }),
    });

    render(
      <ServerProvider server={server}>
        <ModelSettings />
      </ServerProvider>,
    );

    const editButton = await screen.findByRole('button', { name: 'Edit local-llama' });
    expect(screen.getByRole('button', { name: 'Edit OpenAI' })).toBeInTheDocument();
    fireEvent.click(editButton);

    expect(screen.getByRole('heading', { name: 'Edit local-llama' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('local-llama')).toHaveValue('local-llama');
    expect(screen.getByPlaceholderText('local-llama')).toHaveAttribute('readonly');
    expect(screen.getByPlaceholderText('http://localhost:11434/v1')).toHaveValue('http://localhost:11434/v1');
    expect(screen.getByPlaceholderText('llama3.1:70b')).toHaveValue('llama3.1:70b');
    expect(screen.getByPlaceholderText('128000')).toHaveValue(64000);
    expect(screen.getByPlaceholderText('4096')).toHaveValue(2048);

    fireEvent.change(screen.getByPlaceholderText('http://localhost:11434/v1'), {
      target: { value: 'http://localhost:11434/v2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateModelProvider).toHaveBeenCalledTimes(1));
    expect(updateModelProvider).toHaveBeenCalledWith({
      id: 'local-llama',
      type: 'custom',
      name: 'local-llama',
      baseUrl: 'http://localhost:11434/v2',
      apiKey: '',
      models: customProvider.models,
    });
  });
});

describe('ModelSettings removal', () => {
  const renderWithCatalog = ({
    deleteModelProvider,
    updateModelProvider = vi.fn(),
  }: {
    deleteModelProvider?: (req: { id: string }) => Promise<void>;
    updateModelProvider?: (request: UpdateModelProviderRequest) => Promise<ModelProviderBase>;
  }) => {
    const server = createMockAgentUIServer({
      catalog: createMockCatalog({
        modelCatalog: {
          getModelProviderCatalog: async () => [],
          listModelProviders: async () => [builtInProvider],
          createModelProvider: vi.fn(),
          updateModelProvider,
          ...(deleteModelProvider ? { deleteModelProvider } : {}),
        },
      }),
    });

    render(
      <ServerProvider server={server}>
        <ModelSettings />
      </ServerProvider>,
    );

    return { updateModelProvider };
  };

  it('removes the provider when its last model is removed', async () => {
    const deleteModelProvider = vi.fn(async () => {});
    const { updateModelProvider } = renderWithCatalog({ deleteModelProvider });

    fireEvent.click(await screen.findByRole('button', { name: 'Remove gpt-4-1' }));

    expect(await screen.findByText('Remove provider?')).toBeInTheDocument();
    expect(
      screen.getByText('“gpt-4-1” is the only model left in OpenAI, so the whole provider will be removed.'),
    ).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(deleteModelProvider).toHaveBeenCalledWith({ id: 'openai' }));
    expect(updateModelProvider).not.toHaveBeenCalled();
  });

  it('hides the last model’s remove button when the host cannot delete providers', async () => {
    renderWithCatalog({});

    await screen.findByText('gpt-4-1');
    expect(screen.queryByRole('button', { name: 'Remove gpt-4-1' })).toBeNull();
  });
});

describe('ModelSettings Auto mode switch', () => {
  const autoOn = { webSearch: { enabled: true }, memory: { enabled: true }, autoModelRouting: { enabled: true } };

  function renderAutoSettings({
    auto,
    manageProviders = true,
    configuration,
  }: {
    auto: AgentBuilderCapabilitiesResponse['data']['auto'];
    manageProviders?: boolean;
    configuration: ConfigurationServer;
  }) {
    const listModelProviders = vi.fn(async () => [builtInProvider]);
    const getCapabilities = vi.fn(async () => ({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        sessionSharing: tenantSessionSharing,
        settings: { ...allSettingsSections(true), modelProviders: { enabled: true, manageProviders } },
        auto,
      },
    }));
    const server = createMockAgentUIServer({
      catalog: createMockCatalog({
        modelCatalog: {
          getModelProviderCatalog: async () => [],
          listModelProviders,
          createModelProvider: vi.fn(),
          updateModelProvider: vi.fn(),
        },
      }),
      configuration,
      getCapabilities,
    });
    render(
      <ServerProvider server={server}>
        <ModelSettings />
      </ServerProvider>,
    );
    return { getCapabilities, listModelProviders };
  }

  it('saves only the Auto mode switch and refreshes capabilities so the picker updates', async () => {
    const updateConfiguration = vi.fn(async () => ({ ...autoOn, autoModelRouting: { enabled: false } }));
    const { getCapabilities } = renderAutoSettings({
      auto: { status: 'enabled' },
      configuration: { getConfiguration: async () => autoOn, updateConfiguration },
    });

    const toggle = await screen.findByRole('switch', { name: 'Allow Auto mode' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(getCapabilities).toHaveBeenCalled());
    const callsBeforeSave = getCapabilities.mock.calls.length;
    toggle.click();

    await waitFor(() => expect(updateConfiguration).toHaveBeenCalledWith({ autoModelRouting: { enabled: false } }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Allow Auto mode' })).toHaveAttribute('aria-checked', 'false'),
    );
    expect(getCapabilities.mock.calls.length).toBeGreaterThan(callsBeforeSave);
  });

  it('shows a skeleton in place of the switch while the setting loads', async () => {
    let resolveConfiguration: (value: typeof autoOn) => void = () => undefined;
    renderAutoSettings({
      auto: { status: 'enabled' },
      configuration: {
        getConfiguration: () =>
          new Promise<typeof autoOn>(resolve => {
            resolveConfiguration = resolve;
          }),
        updateConfiguration: vi.fn(),
      },
    });

    expect(await screen.findByTestId('auto-mode-setting-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Allow Auto mode' })).toBeNull();

    resolveConfiguration(autoOn);
    expect(await screen.findByRole('switch', { name: 'Allow Auto mode' })).toBeInTheDocument();
    expect(screen.queryByTestId('auto-mode-setting-skeleton')).toBeNull();
  });

  it('shows only the switch when the platform owns the providers', async () => {
    const { listModelProviders } = renderAutoSettings({
      auto: { status: 'enabled' },
      manageProviders: false,
      configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
    });

    await screen.findByRole('switch', { name: 'Allow Auto mode' });
    expect(screen.queryByRole('button', { name: /Add Custom Provider/ })).toBeNull();
    expect(listModelProviders).not.toHaveBeenCalled();
  });

  it('keeps the switch available while the tenant has Auto turned off', async () => {
    renderAutoSettings({
      auto: { status: 'disabled', reason: 'Auto mode is turned off for this tenant.' },
      configuration: {
        getConfiguration: async () => ({ ...autoOn, autoModelRouting: { enabled: false } }),
        updateConfiguration: vi.fn(),
      },
    });

    expect(await screen.findByRole('switch', { name: 'Allow Auto mode' })).toHaveAttribute('aria-checked', 'false');
  });

  it('shows no switch when the server does not set up Auto mode', async () => {
    renderAutoSettings({
      auto: { status: 'not_configured' },
      configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
    });

    await screen.findByText('gpt-4-1');
    expect(screen.queryByRole('switch', { name: 'Allow Auto mode' })).toBeNull();
    expect(screen.queryByTestId('auto-mode-setting-skeleton')).toBeNull();
  });
});
