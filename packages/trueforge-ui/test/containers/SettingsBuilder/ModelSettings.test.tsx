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
    autoModelRouting: { enabled: true, candidateModels: [] },
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
      autoModelRouting: { enabled: false, candidateModels: [] },
    }));
    const { getCapabilities } = renderAutoSettings({
      auto: { status: 'enabled' },
      configuration: { getConfiguration: async () => autoOn, updateConfiguration },
    });

    const toggle = await screen.findByRole('switch', { name: 'Enable Auto Model Routing' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(getCapabilities).toHaveBeenCalled());
    const callsBeforeSave = getCapabilities.mock.calls.length;
    toggle.click();

    await waitFor(() => expect(updateConfiguration).toHaveBeenCalledWith({ autoModelRouting: { enabled: false } }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Enable Auto Model Routing' })).toHaveAttribute(
        'aria-checked',
        'false',
      ),
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
    expect(screen.queryByRole('switch', { name: 'Enable Auto Model Routing' })).toBeNull();

    resolveConfiguration(autoOn);
    expect(await screen.findByRole('switch', { name: 'Enable Auto Model Routing' })).toBeInTheDocument();
    expect(screen.queryByTestId('auto-mode-setting-skeleton')).toBeNull();
  });

  it('shows only the switch when the platform owns the providers', async () => {
    const { listModelProviders } = renderAutoSettings({
      auto: { status: 'enabled' },
      manageProviders: false,
      configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
    });

    await screen.findByRole('switch', { name: 'Enable Auto Model Routing' });
    expect(screen.queryByRole('button', { name: /Add Custom Provider/ })).toBeNull();
    expect(listModelProviders).not.toHaveBeenCalled();
  });

  it('keeps the switch available while the tenant has Auto turned off', async () => {
    renderAutoSettings({
      auto: { status: 'disabled', reason: 'Auto mode is turned off for this tenant.' },
      configuration: {
        getConfiguration: async () => ({ ...autoOn, autoModelRouting: { enabled: false, candidateModels: [] } }),
        updateConfiguration: vi.fn(),
      },
    });

    expect(await screen.findByRole('switch', { name: 'Enable Auto Model Routing' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  describe('model candidate list', () => {
    const modelNames = ['acct/haiku', 'acct/sonnet'];
    const fiveModels = ['acct/haiku', 'acct/sonnet', 'acct/opus', 'acct/gemini', 'acct/grok'];
    const withModels = (candidateModels: string[]) => ({
      ...autoOn,
      autoModelRouting: { enabled: true, candidateModels },
    });
    const openPicker = async () => {
      fireEvent.click(await screen.findByRole('combobox', { name: 'Select models' }));
      return screen.findByRole('listbox', { name: 'Models Auto can choose from' });
    };
    const option = (name: string) => screen.getByRole('option', { name });

    it('offers the admin models in a dropdown with none selected when nothing is allowed yet', async () => {
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames,
        configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
      });

      expect(screen.queryByRole('listbox')).toBeNull();
      await openPicker();
      expect(option('acct/haiku')).toHaveAttribute('aria-selected', 'false');
      expect(option('acct/sonnet')).toHaveAttribute('aria-selected', 'false');
      expect(
        screen.getByText(/0 of 10 selected\. Pick 4 to 10 models; with none, Auto stays unavailable\./),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('puts the picker in the same card as the Auto switch, with no heading of its own', async () => {
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames,
        configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
      });

      const toggle = await screen.findByRole('switch', { name: 'Enable Auto Model Routing' });
      const picker = await screen.findByRole('combobox', { name: 'Select models' });

      const card = toggle.closest('.rounded-xl');
      expect(card).not.toBeNull();
      expect(card).toContainElement(picker);
      expect(screen.queryByRole('heading', { name: 'Models Auto can choose from' })).toBeNull();
    });

    it('narrows the dropdown with search', async () => {
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames,
        configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
      });

      await openPicker();
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: 'son' } });
      expect(screen.queryByRole('option', { name: 'acct/haiku' })).toBeNull();
      expect(option('acct/sonnet')).toBeInTheDocument();

      fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: 'nothing' } });
      expect(screen.getByText('No models match your search.')).toBeInTheDocument();
    });

    it('saves the chosen full model names and refreshes capabilities', async () => {
      const chosen = ['acct/sonnet', 'acct/opus', 'acct/gemini', 'acct/grok'];
      const updateConfiguration = vi.fn(async () => withModels(chosen));
      const { getCapabilities } = renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames: fiveModels,
        configuration: { getConfiguration: async () => autoOn, updateConfiguration },
      });

      await openPicker();
      for (const name of chosen) fireEvent.click(option(name));
      // The dropdown stays open for more picks, and each pick shows as a chip.
      expect(option('acct/sonnet')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('button', { name: 'Remove acct/sonnet' })).toBeInTheDocument();
      await waitFor(() => expect(getCapabilities).toHaveBeenCalled());
      const callsBeforeSave = getCapabilities.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(updateConfiguration).toHaveBeenCalledWith({ autoModelRouting: { candidateModels: chosen } }),
      );
      await waitFor(() => expect(getCapabilities.mock.calls.length).toBeGreaterThan(callsBeforeSave));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
      expect(screen.getByRole('button', { name: 'Remove acct/sonnet' })).toBeInTheDocument();
    });

    it('holds Save back until at least four models are chosen', async () => {
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames: fiveModels,
        configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
      });

      await openPicker();
      for (const name of fiveModels.slice(0, 3)) fireEvent.click(option(name));
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      expect(screen.getByText(/Pick at least 4 to save\./)).toBeInTheDocument();

      fireEvent.click(option('acct/gemini'));
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
      expect(screen.queryByText(/Pick at least 4 to save\./)).toBeNull();
    });

    it('stops at ten models and frees a slot when one is removed', async () => {
      const many = Array.from({ length: 12 }, (_, index) => `acct/model-${String(index).padStart(2, '0')}`);
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames: many,
        configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
      });

      await openPicker();
      for (const name of many.slice(0, 10)) {
        fireEvent.click(option(name));
      }

      expect(option('acct/model-10')).toBeDisabled();
      expect(option('acct/model-11')).toBeDisabled();
      expect(option('acct/model-00')).toBeEnabled();
      expect(screen.getByText(/10 of 10 selected\./)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Remove acct/model-00' }));
      expect(option('acct/model-10')).toBeEnabled();
    });

    it('saves an empty list to take every model away', async () => {
      const updateConfiguration = vi.fn(async () => autoOn);
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames,
        configuration: { getConfiguration: async () => withModels(['acct/haiku']), updateConfiguration },
      });

      fireEvent.click(await screen.findByRole('button', { name: 'Remove acct/haiku' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(updateConfiguration).toHaveBeenCalledWith({ autoModelRouting: { candidateModels: [] } }),
      );
    });

    it('flags a saved model the admin cannot see and holds Save until it is removed', async () => {
      const saved = ['acct/haiku', 'acct/hidden'];
      const next = ['acct/haiku', 'acct/sonnet', 'acct/opus', 'acct/gemini'];
      const updateConfiguration = vi.fn(async () => withModels(next));
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames: fiveModels,
        configuration: { getConfiguration: async () => withModels(saved), updateConfiguration },
      });

      const hiddenChip = (await screen.findByRole('button', { name: 'Remove acct/hidden' })).parentElement;
      expect(hiddenChip).not.toBeNull();
      expect(within(hiddenChip as HTMLElement).getByText('Not visible to you')).toBeInTheDocument();
      const haikuChip = screen.getByRole('button', { name: 'Remove acct/haiku' }).parentElement;
      expect(within(haikuChip as HTMLElement).queryByText('Not visible to you')).toBeNull();

      await openPicker();
      for (const name of ['acct/sonnet', 'acct/opus', 'acct/gemini']) fireEvent.click(option(name));
      // Five picks, but the server would refuse the one the admin cannot use.
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      expect(screen.getByText(/Remove the models marked "Not visible to you" to save\./)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Remove acct/hidden' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(updateConfiguration).toHaveBeenCalledWith({ autoModelRouting: { candidateModels: next } }),
      );
    });

    it('restores the saved selection on Reset', async () => {
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames,
        configuration: { getConfiguration: async () => withModels(['acct/haiku']), updateConfiguration: vi.fn() },
      });

      await openPicker();
      fireEvent.click(option('acct/sonnet'));
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

      expect(screen.queryByRole('button', { name: 'Remove acct/sonnet' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Remove acct/haiku' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('closes the dropdown on Escape', async () => {
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames,
        configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
      });

      await openPicker();
      fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search models' }), { key: 'Escape' });
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('closes the dropdown on an outside click, and Save still works while it is open', async () => {
      const chosen = ['acct/haiku', 'acct/sonnet', 'acct/opus', 'acct/gemini'];
      const updateConfiguration = vi.fn(async () => withModels(chosen));
      renderAutoSettings({
        auto: { status: 'enabled' },
        modelNames: fiveModels,
        configuration: { getConfiguration: async () => autoOn, updateConfiguration },
      });

      await openPicker();
      for (const name of chosen) fireEvent.click(option(name));
      // Save is reachable with the list open: it sits below the list rather than under it.
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(updateConfiguration).toHaveBeenCalled());

      await openPicker();
      fireEvent.click(document.body);
      expect(screen.queryByRole('listbox')).toBeNull();
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
          getConfiguration: async () => ({ ...autoOn, autoModelRouting: { enabled: false, candidateModels: [] } }),
          updateConfiguration: vi.fn(),
        },
      });

      await screen.findByRole('switch', { name: 'Enable Auto Model Routing' });
      expect(screen.queryByRole('combobox', { name: 'Select models' })).toBeNull();
    });
  });

  it('shows no switch when the server does not set up Auto mode', async () => {
    renderAutoSettings({
      auto: { status: 'not_configured' },
      configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
    });

    await screen.findByText('gpt-4-1');
    expect(screen.queryByRole('switch', { name: 'Enable Auto Model Routing' })).toBeNull();
    expect(screen.queryByTestId('auto-mode-setting-skeleton')).toBeNull();
  });
});
