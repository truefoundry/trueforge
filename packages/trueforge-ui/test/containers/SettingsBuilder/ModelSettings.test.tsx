// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CustomProviderDraft } from '@/containers/SettingsBuilder/CustomModelProviderForm.js';
import ModelSettings from '@/containers/SettingsBuilder/ModelSettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type {
  AgentBuilderCapabilitiesResponse,
  AutoRoutingCategory,
  ConfigurationServer,
  ModelProviderBase,
  ModelSelection,
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

/** A model as `getModels` lists it: tiers when Auto can route to it, a reason when it can't, nothing when unreported. */
type TestModel =
  { name: string; categories: AutoRoutingCategory[] } | { name: string; unsupportedReason: string } | { name: string };

function toModelSelection(model: TestModel): ModelSelection {
  const [account = 'acct', id = model.name] = model.name.split('/');
  const autoRouting =
    'categories' in model
      ? { supported: true as const, enabled: false, categories: model.categories }
      : 'unsupportedReason' in model
        ? { supported: false as const, unsupportedReason: model.unsupportedReason }
        : undefined;
  return {
    id,
    name: model.name,
    provider: { name: account },
    properties: autoRouting === undefined ? {} : { autoRouting },
  };
}

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
    models = [],
  }: {
    auto: AgentBuilderCapabilitiesResponse['data']['auto'];
    manageProviders?: boolean;
    configuration: ConfigurationServer;
    models?: TestModel[];
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
      getModels: async () => models.map(toModelSelection),
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

    const toggle = await screen.findByRole('switch', { name: 'Auto model routing' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(getCapabilities).toHaveBeenCalled());
    const callsBeforeSave = getCapabilities.mock.calls.length;
    toggle.click();

    await waitFor(() => expect(updateConfiguration).toHaveBeenCalledWith({ autoModelRouting: { enabled: false } }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Auto model routing' })).toHaveAttribute('aria-checked', 'false'),
    );
    expect(getCapabilities.mock.calls.length).toBeGreaterThan(callsBeforeSave);
  });

  it('flips the switch and hides the model list at once, before the save finishes', async () => {
    let finishSave: (value: typeof autoOn) => void = () => undefined;
    const updateConfiguration = vi.fn(
      () =>
        new Promise<typeof autoOn>(resolve => {
          finishSave = resolve;
        }),
    );
    renderAutoSettings({
      auto: { status: 'enabled' },
      models: [{ name: 'acct/haiku', categories: ['answer', 'execute'] }],
      configuration: { getConfiguration: async () => autoOn, updateConfiguration },
    });

    const toggle = await screen.findByRole('switch', { name: 'Auto model routing' });
    await screen.findByRole('button', { name: 'Add models' });
    expect(screen.getByText(/Each task is matched to a tier/)).toBeInTheDocument();
    expect(screen.queryByText(/Intelligently picks a suitable model/)).toBeNull();
    toggle.click();

    // The save has not returned, yet the card already shows the new state, and the switch isn't dimmed.
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Auto model routing' })).toHaveAttribute('aria-checked', 'false'),
    );
    expect(screen.queryByRole('button', { name: 'Add models' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Auto model routing' })).toHaveClass('disabled:opacity-100');

    finishSave({ ...autoOn, autoModelRouting: { enabled: false, candidateModels: [] } });
    await waitFor(() => expect(screen.getByText(/Intelligently picks a suitable model/)).toBeInTheDocument());
    expect(screen.queryByText(/Each task is matched to a tier/)).toBeNull();
  });

  it('puts the switch back when the save fails', async () => {
    const updateConfiguration = vi.fn(() => Promise.reject(new Error('Save failed')));
    renderAutoSettings({
      auto: { status: 'enabled' },
      models: [{ name: 'acct/haiku', categories: ['answer', 'execute'] }],
      configuration: { getConfiguration: async () => autoOn, updateConfiguration },
    });

    const toggle = await screen.findByRole('switch', { name: 'Auto model routing' });
    toggle.click();

    expect(await screen.findByText('Save failed')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Auto model routing' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Add models' })).toBeInTheDocument();
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
    expect(screen.queryByRole('switch', { name: 'Auto model routing' })).toBeNull();

    resolveConfiguration(autoOn);
    expect(await screen.findByRole('switch', { name: 'Auto model routing' })).toBeInTheDocument();
    expect(screen.queryByTestId('auto-mode-setting-skeleton')).toBeNull();
  });

  it('shows only the switch when the platform owns the providers', async () => {
    const { listModelProviders } = renderAutoSettings({
      auto: { status: 'enabled' },
      manageProviders: false,
      configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
    });

    await screen.findByRole('switch', { name: 'Auto model routing' });
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

    expect(await screen.findByRole('switch', { name: 'Auto model routing' })).toHaveAttribute('aria-checked', 'false');
  });

  describe('model candidate list', () => {
    const haiku = { name: 'acct/haiku', categories: ['answer', 'execute'] } satisfies TestModel;
    const sonnet = { name: 'acct/sonnet', categories: ['execute', 'analyze'] } satisfies TestModel;
    const opus = { name: 'acct/opus', categories: ['analyze', 'frontier'] } satisfies TestModel;
    const gemini = { name: 'acct/gemini', categories: ['execute'] } satisfies TestModel;
    const grok = { name: 'acct/grok', categories: ['answer'] } satisfies TestModel;
    const fable = { name: 'acct/fable', unsupportedReason: 'This model does not support tool calling.' };
    const catalog: TestModel[] = [haiku, sonnet, opus, gemini, grok, fable];
    // Together these cover every tier.
    const covering = [haiku, sonnet, opus, gemini].map(model => model.name);

    const withModels = (candidateModels: string[]) => ({
      ...autoOn,
      autoModelRouting: { enabled: true, candidateModels },
    });
    const renderPicker = ({
      saved = [],
      models = catalog,
      updateConfiguration = vi.fn(async () => withModels(saved)),
    }: {
      saved?: string[];
      models?: TestModel[];
      updateConfiguration?: ConfigurationServer['updateConfiguration'];
    } = {}) =>
      renderAutoSettings({
        auto: { status: 'enabled' },
        models,
        configuration: { getConfiguration: async () => withModels(saved), updateConfiguration },
      });
    const openPicker = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Add models' }));
      return screen.findByRole('listbox', { name: 'Models Auto can choose from' });
    };
    // Options are named by the model's own id; the full name is on the remove button and in saves.
    const option = (id: string) => screen.getByRole('option', { name: id });
    const rowOf = (name: string) => {
      const row = screen.getByRole('button', { name: `Remove ${name}` }).parentElement;
      if (row === null) throw new Error(`No row for ${name}`);
      return row;
    };
    const update = () => screen.getByRole('button', { name: 'Update' });

    it('draws each saved model against the tiers it covers, with a coverage count per tier', async () => {
      renderPicker({ saved: covering });

      await screen.findByRole('button', { name: 'Add models' });
      const row = rowOf('acct/haiku');
      expect(within(row).getByText('haiku')).toBeInTheDocument();
      expect(within(row).getByText('acct · Answer – Execute')).toBeInTheDocument();
      expect(within(row).getByRole('img', { name: 'Covers Answer' })).toBeInTheDocument();
      expect(within(row).getByRole('img', { name: 'Covers Execute' })).toBeInTheDocument();
      expect(within(row).getByRole('img', { name: 'Does not cover Analyze' })).toBeInTheDocument();
      expect(within(row).getByRole('img', { name: 'Does not cover Frontier' })).toBeInTheDocument();
      expect(within(rowOf('acct/gemini')).getByText('acct · Execute')).toBeInTheDocument();

      expect(screen.getAllByText('1 model')).toHaveLength(2);
      expect(screen.getAllByText('3 models')).toHaveLength(1);
      expect(screen.getAllByText('2 models')).toHaveLength(1);
      expect(screen.getByRole('status')).toHaveTextContent('4 of 5 selected · every tier covered');
      expect(screen.queryByText('No model')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    });

    it('warns about a tier no saved model covers', async () => {
      renderPicker({ saved: [haiku, sonnet, gemini, grok].map(model => model.name) });

      expect(await screen.findByText('No model')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Frontier has no model. Add a model that covers it.');
    });

    it('starts empty with a prompt to add models', async () => {
      renderPicker();

      expect(await screen.findByText('Add the models Auto may route to.')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(
        'No models selected. With none selected, Auto stays unavailable.',
      );
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    });

    it('lists every model by provider with its tiers, and shows unsupported ones as not supported', async () => {
      renderPicker({ saved: covering });

      await openPicker();
      expect(option('haiku')).toHaveAttribute('aria-selected', 'true');
      expect(option('grok')).toHaveAttribute('aria-selected', 'false');
      expect(within(option('sonnet')).getByText('Execute – Analyze')).toBeInTheDocument();
      expect(within(option('fable')).getByText('Not supported')).toBeInTheDocument();
      expect(option('fable')).toHaveAttribute('aria-disabled', 'true');
      expect(option('grok')).not.toHaveAttribute('aria-disabled');
      expect(screen.getByRole('group', { name: 'acct' })).toBeInTheDocument();
    });

    it('treats a model whose Auto routing support is not reported as unsupported', async () => {
      renderPicker({ models: [{ name: 'acct/legacy' }] });

      await openPicker();
      expect(option('legacy')).toHaveAttribute('aria-disabled', 'true');
      fireEvent.focus(option('legacy'));
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'Auto routing support is not reported for this model.',
      );
    });

    it('puts the picker in the same card as the Auto switch, with no heading of its own', async () => {
      renderPicker();

      const toggle = await screen.findByRole('switch', { name: 'Auto model routing' });
      const add = await screen.findByRole('button', { name: 'Add models' });

      const card = toggle.closest('.rounded-xl');
      expect(card).not.toBeNull();
      expect(card).toContainElement(add);
      expect(screen.queryByRole('heading', { name: 'Models Auto can choose from' })).toBeNull();
    });

    it('narrows the list with search', async () => {
      renderPicker();

      await openPicker();
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: 'son' } });
      expect(screen.queryByRole('option', { name: 'haiku' })).toBeNull();
      expect(option('sonnet')).toBeInTheDocument();

      fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: 'nothing' } });
      expect(screen.getByText('No models match.')).toBeInTheDocument();
    });

    it('keeps the list open while models are ticked, and shows the new row at once', async () => {
      renderPicker();

      await openPicker();
      fireEvent.click(option('haiku'));
      fireEvent.click(option('opus'));

      expect(screen.getByRole('listbox', { name: 'Models Auto can choose from' })).toBeInTheDocument();
      expect(option('haiku')).toHaveAttribute('aria-selected', 'true');
      expect(within(rowOf('acct/opus')).getByText('acct · Analyze – Frontier')).toBeInTheDocument();
      // Two models already cover every tier, but Auto needs at least four to be saved.
      expect(screen.getByRole('status')).toHaveTextContent(
        '2 of 5 selected · every tier covered. Pick at least 4 to update.',
      );
    });

    it('saves the chosen full model names and refreshes capabilities', async () => {
      const updateConfiguration = vi.fn(async () => withModels(covering));
      const { getCapabilities } = renderPicker({ updateConfiguration });

      await openPicker();
      for (const model of [haiku, sonnet, opus, gemini]) fireEvent.click(option(model.name.replace('acct/', '')));
      expect(screen.getByRole('button', { name: 'Remove acct/sonnet' })).toBeInTheDocument();
      await waitFor(() => expect(getCapabilities).toHaveBeenCalled());
      const callsBeforeSave = getCapabilities.mock.calls.length;
      fireEvent.click(update());

      await waitFor(() =>
        expect(updateConfiguration).toHaveBeenCalledWith({ autoModelRouting: { candidateModels: covering } }),
      );
      await waitFor(() => expect(getCapabilities.mock.calls.length).toBeGreaterThan(callsBeforeSave));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Update' })).toBeNull());
      expect(screen.getByRole('button', { name: 'Remove acct/sonnet' })).toBeInTheDocument();
    });

    it('holds Update back until at least four models are chosen', async () => {
      renderPicker();

      await openPicker();
      // Three models already cover every tier, so only the minimum count is missing.
      for (const id of ['haiku', 'sonnet', 'opus']) fireEvent.click(option(id));
      expect(update()).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('Pick at least 4 to update.');

      fireEvent.click(option('gemini'));
      expect(update()).toBeEnabled();
      expect(screen.getByRole('status')).not.toHaveTextContent('Pick at least 4');
    });

    it('holds Update back while a tier has no model, and says which', async () => {
      renderPicker({ saved: covering });

      fireEvent.click(await screen.findByRole('button', { name: 'Remove acct/opus' }));

      expect(screen.getByText('No model')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Frontier has no model. Add a model that covers it.');
      expect(update()).toBeDisabled();

      // Back at four models, the missing tier is all that holds Update back.
      await openPicker();
      fireEvent.click(option('grok'));
      expect(screen.getByRole('status')).toHaveTextContent('Frontier has no model');
      expect(update()).toBeDisabled();
      fireEvent.click(option('grok'));

      // Returning opus restores the saved set, so there is nothing left to update.
      fireEvent.click(option('opus'));
      expect(screen.queryByText('No model')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    });

    it('names every tier that has no model', async () => {
      renderPicker({ saved: [gemini.name] });

      await screen.findByRole('button', { name: 'Add models' });
      expect(screen.getByRole('status')).toHaveTextContent(
        'Answer, Analyze, Frontier have no model. Add a model that covers them.',
      );
    });

    it('does not select a model that does not support Auto routing, and says why on hover and focus', async () => {
      renderPicker();

      await openPicker();
      fireEvent.click(option('fable'));
      expect(option('fable')).toHaveAttribute('aria-selected', 'false');
      expect(screen.queryByRole('button', { name: 'Remove acct/fable' })).toBeNull();
      // Enter and Space activate a focused button through its click, so a blocked click covers the keyboard too.
      fireEvent.keyDown(option('fable'), { key: 'Enter' });
      expect(option('fable')).toHaveAttribute('aria-selected', 'false');

      const wrapper = option('fable').parentElement;
      expect(wrapper).not.toBeNull();
      fireEvent.mouseEnter(wrapper as HTMLElement);
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent('Not available for auto routing');
      expect(tooltip).toHaveTextContent('This model does not support tool calling.');
      fireEvent.mouseLeave(wrapper as HTMLElement);
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

      fireEvent.focus(option('fable'));
      expect(await screen.findByRole('tooltip')).toHaveTextContent('This model does not support tool calling.');
      fireEvent.blur(option('fable'));
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    });

    it('stops at ten models and frees a slot when one is removed', async () => {
      const many = Array.from({ length: 12 }, (_, index) => ({
        name: `acct/model-${String(index).padStart(2, '0')}`,
        categories: ['answer', 'execute', 'analyze', 'frontier'] satisfies AutoRoutingCategory[],
      }));
      renderPicker({ models: many });

      await openPicker();
      for (const model of many.slice(0, 10)) fireEvent.click(option(model.name.replace('acct/', '')));

      expect(option('model-10')).toHaveAttribute('aria-disabled', 'true');
      expect(option('model-11')).toHaveAttribute('aria-disabled', 'true');
      expect(option('model-00')).not.toHaveAttribute('aria-disabled');
      expect(screen.getByRole('status')).toHaveTextContent('10 of 12 selected');
      expect(screen.getByRole('status')).toHaveTextContent('Remove one to add another.');
      fireEvent.focus(option('model-10'));
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Auto can use at most 10 models.');

      fireEvent.click(option('model-10'));
      expect(option('model-10')).toHaveAttribute('aria-selected', 'false');

      fireEvent.click(screen.getByRole('button', { name: 'Remove acct/model-00' }));
      expect(option('model-10')).not.toHaveAttribute('aria-disabled');
    });

    it('does not let the saved list be emptied', async () => {
      renderPicker({ saved: [haiku.name] });

      fireEvent.click(await screen.findByRole('button', { name: 'Remove acct/haiku' }));

      expect(update()).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('Pick at least 4 to update.');
    });

    it('flags a saved model the admin cannot see and holds Update until it is removed', async () => {
      const next = [haiku, sonnet, opus, gemini].map(model => model.name);
      const updateConfiguration = vi.fn(async () => withModels(next));
      renderPicker({ saved: [haiku.name, 'acct/hidden'], updateConfiguration });

      const hiddenRow = await waitFor(() => rowOf('acct/hidden'));
      expect(within(hiddenRow).getByText('Not visible to you')).toBeInTheDocument();
      expect(within(rowOf('acct/haiku')).queryByText('Not visible to you')).toBeNull();

      await openPicker();
      for (const id of ['sonnet', 'opus', 'gemini']) fireEvent.click(option(id));
      // Five picks covering every tier, but the server would refuse the one the admin cannot use.
      expect(update()).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('Remove the flagged models to update.');

      fireEvent.click(screen.getByRole('button', { name: 'Remove acct/hidden' }));
      fireEvent.click(update());

      await waitFor(() =>
        expect(updateConfiguration).toHaveBeenCalledWith({ autoModelRouting: { candidateModels: next } }),
      );
    });

    it('flags a saved model that no longer supports Auto routing, and still lets it be unticked in the list', async () => {
      renderPicker({ saved: [...covering, fable.name] });

      const fableRow = await waitFor(() => rowOf('acct/fable'));
      expect(within(fableRow).getByText(/Not available for auto routing/)).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'Add models' }));
      expect(option('fable')).toHaveAttribute('aria-selected', 'true');
      fireEvent.click(option('fable'));

      expect(screen.queryByRole('button', { name: 'Remove acct/fable' })).toBeNull();
    });

    it('closes the list on Escape and returns focus to the button', async () => {
      renderPicker();

      await openPicker();
      fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search models' }), { key: 'Escape' });
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(screen.getByRole('button', { name: 'Add models' })).toHaveFocus();
    });

    it('closes the list on an outside click or by pressing the button again, not on a click inside', async () => {
      renderPicker();

      await openPicker();
      fireEvent.mouseDown(option('haiku'));
      expect(screen.getByRole('listbox', { name: 'Models Auto can choose from' })).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole('listbox')).toBeNull();

      await openPicker();
      fireEvent.click(screen.getByRole('button', { name: 'Add models' }));
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('hides the list while the tenant has Auto turned off', async () => {
      renderAutoSettings({
        auto: { status: 'disabled', reason: 'Auto mode is turned off for this tenant.' },
        models: catalog,
        configuration: {
          getConfiguration: async () => ({ ...autoOn, autoModelRouting: { enabled: false, candidateModels: [] } }),
          updateConfiguration: vi.fn(),
        },
      });

      await screen.findByRole('switch', { name: 'Auto model routing' });
      expect(screen.queryByRole('button', { name: 'Add models' })).toBeNull();
    });
  });

  it('shows no switch when the server does not set up Auto mode', async () => {
    renderAutoSettings({
      auto: { status: 'not_configured' },
      configuration: { getConfiguration: async () => autoOn, updateConfiguration: vi.fn() },
    });

    await screen.findByText('gpt-4-1');
    expect(screen.queryByRole('switch', { name: 'Auto model routing' })).toBeNull();
    expect(screen.queryByTestId('auto-mode-setting-skeleton')).toBeNull();
  });
});
