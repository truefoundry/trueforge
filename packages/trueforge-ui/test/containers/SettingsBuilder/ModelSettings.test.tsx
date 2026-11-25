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
  const autoOn = {
    webSearch: { enabled: true },
    memory: { enabled: true },
    autoModelRouting: { enabled: true, allowedModels: [] },
  };

  function renderAutoSettings({
    auto,
    manageProviders = true,
    configuration,
    modelNames = [],
  }: {
    auto: AgentBuilderCapabilitiesResponse['data']['auto'];
    manageProviders?: boolean;
    configuration: ConfigurationServer;
    modelNames?: string[];
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
      getModels: async () => modelNames.map(name => ({ id: name, name, provider: { name: 'acct' }, properties: {} })),
    });
    render(
      <ServerProvider server={server}>
        <ModelSettings />
      </ServerProvider>,
    );
    return { getCapabilities, listModelProviders };
  }

  it('saves only the Auto mode switch and refreshes capabilities so the picker updates', async () => {
    const updateConfiguration = vi.fn(async () => ({
      ...autoOn,
      autoModelRouting: { enabled: false, allowedModels: [] },
    }));
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
        getConfiguration: async () => ({ ...autoOn, autoModelRouting: { enabled: false, allowedModels: [] } }),
        updateConfiguration: vi.fn(),
      },
    });

    expect(await screen.findByRole('switch', { name: 'Allow Auto mode' })).toHaveAttribute('aria-checked', 'false');
  });

  describe('model allow-list', () => {
    const modelNames = ['acct/haiku', 'acct/sonnet'];
    const withModels = (allowedModels: string[]) => ({
      ...autoOn,
      autoModelRouting: { enabled: true, allowedModels },
    });

    it('lists the admin models with none selected when nothing is allowed yet', async () => {
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames,
        configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
      });

      const haiku = await screen.findByRole('checkbox', { name: 'acct/haiku' });
      expect(haiku).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('checkbox', { name: 'acct/sonnet' })).toHaveAttribute('aria-checked', 'false');
      expect(
        screen.getByText(/0 of 10 selected\. With none selected, Auto has no model to pick\./),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('saves the chosen full model names and refreshes capabilities', async () => {
      const updateConfiguration = vi.fn(async () => withModels(['acct/sonnet']));
      const { getCapabilities } = renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames,
        configuration: { getConfiguration: async () => autoOn, updateConfiguration },
      });

      fireEvent.click(await screen.findByRole('checkbox', { name: 'acct/sonnet' }));
      await waitFor(() => expect(getCapabilities).toHaveBeenCalled());
      const callsBeforeSave = getCapabilities.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(updateConfiguration).toHaveBeenCalledWith({ autoModelRouting: { allowedModels: ['acct/sonnet'] } }),
      );
      await waitFor(() => expect(getCapabilities.mock.calls.length).toBeGreaterThan(callsBeforeSave));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
      expect(screen.getByRole('checkbox', { name: 'acct/sonnet' })).toHaveAttribute('aria-checked', 'true');
    });

    it('stops at ten models and frees a slot when one is deselected', async () => {
      const many = Array.from({ length: 12 }, (_, index) => `acct/model-${String(index).padStart(2, '0')}`);
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames: many,
        configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
      });

      for (const name of many.slice(0, 10)) {
        fireEvent.click(await screen.findByRole('checkbox', { name }));
      }

      expect(screen.getByRole('checkbox', { name: 'acct/model-10' })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: 'acct/model-11' })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: 'acct/model-00' })).toBeEnabled();
      expect(screen.getByText(/10 of 10 selected\./)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('checkbox', { name: 'acct/model-00' }));
      expect(screen.getByRole('checkbox', { name: 'acct/model-10' })).toBeEnabled();
    });

    it('saves an empty list to take every model away', async () => {
      const updateConfiguration = vi.fn(async () => autoOn);
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames,
        configuration: { getConfiguration: async () => withModels(['acct/haiku']), updateConfiguration },
      });

      const haiku = await screen.findByRole('checkbox', { name: 'acct/haiku' });
      expect(haiku).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(haiku);
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(updateConfiguration).toHaveBeenCalledWith({ autoModelRouting: { allowedModels: [] } }),
      );
    });

    it('keeps a saved model the admin cannot see, so saving does not drop it', async () => {
      const updateConfiguration = vi.fn(async () => withModels(['acct/haiku', 'acct/hidden', 'acct/sonnet']));
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames,
        configuration: {
          getConfiguration: async () => withModels(['acct/haiku', 'acct/hidden']),
          updateConfiguration,
        },
      });

      const hidden = await screen.findByRole('checkbox', { name: 'acct/hidden' });
      expect(hidden).toHaveAttribute('aria-checked', 'true');
      expect(within(hidden).getByText('Not visible to you')).toBeInTheDocument();
      expect(within(screen.getByRole('checkbox', { name: 'acct/haiku' })).queryByText('Not visible to you')).toBeNull();
      fireEvent.click(screen.getByRole('checkbox', { name: 'acct/sonnet' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(updateConfiguration).toHaveBeenCalledWith({
          autoModelRouting: { allowedModels: ['acct/haiku', 'acct/hidden', 'acct/sonnet'] },
        }),
      );
    });

    it('restores the saved selection on Reset', async () => {
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames,
        configuration: { getConfiguration: async () => withModels(['acct/haiku']), updateConfiguration: vi.fn() },
      });

      fireEvent.click(await screen.findByRole('checkbox', { name: 'acct/sonnet' }));
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

      expect(screen.getByRole('checkbox', { name: 'acct/sonnet' })).toHaveAttribute('aria-checked', 'false');
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('shows the server reason when the allowed models cannot route', async () => {
      renderAutoSettings({
        auto: { status: 'disabled', reason: 'Auto mode has no usable models selected.' },
        modelNames,
        configuration: { getConfiguration: async () => withModels(['acct/haiku']), updateConfiguration: vi.fn() },
      });

      expect(await screen.findByRole('status')).toHaveTextContent('Auto mode has no usable models selected.');
    });

    it('hides the list while the tenant has Auto turned off', async () => {
      renderAutoSettings({
        auto: { status: 'disabled', reason: 'Auto mode is turned off for this tenant.' },
        modelNames,
        configuration: {
          getConfiguration: async () => ({ ...autoOn, autoModelRouting: { enabled: false, allowedModels: [] } }),
          updateConfiguration: vi.fn(),
        },
      });

      await screen.findByRole('switch', { name: 'Allow Auto mode' });
      expect(screen.queryByRole('group', { name: 'Models Auto can choose from' })).toBeNull();
    });
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
