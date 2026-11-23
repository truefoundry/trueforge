// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftModelSelector, type DraftModelSelectorProps } from '@/atoms/draft/DraftModelSelector.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { AgentSpec, AgentUIServer, ModelSelection } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog, tenantSessionSharing } from '../../server/mockServer.js';
import { allSettingsSections } from '../../server/settingsCapabilityFixture.js';

let agentSpec: AgentSpec | undefined;
const updateAgentSpec = vi.fn();

vi.mock('@truefoundry/trueforge-assistant-ui-runtime', () => ({
  useTrueForgeAgentSpec: () => ({ agentSpec }),
  useTrueForgeUpdateAgentSpec: () => updateAgentSpec,
}));

const models: ModelSelection[] = [
  {
    id: 'gpt-4.1',
    name: 'openai/gpt-4.1',
    provider: { name: 'OpenAI', logo: 'https://assets.example/openai.svg' },
    properties: {
      contextLength: 128_000,
      maxOutputTokens: 16_384,
    },
  },
  {
    id: 'claude-3.7-sonnet',
    name: 'anthropic/claude-3.7-sonnet',
    provider: { name: 'Anthropic' },
    properties: { reasoningEfforts: ['low', 'high'] },
  },
];

function SettingsOpenProbe() {
  const { settingsOpen } = useShellMode();
  return <div data-testid="settings-open">{String(settingsOpen)}</div>;
}

function renderSelector(
  props: DraftModelSelectorProps = {},
  serverOverrides: Partial<AgentUIServer> = { getModels: async () => models },
) {
  const server = createMockAgentUIServer(serverOverrides);

  return render(
    <ServerProvider server={server}>
      <ShellModeProvider>
        <DraftCatalogProvider>
          <DraftModelSelector {...props} />
          <SettingsOpenProbe />
        </DraftCatalogProvider>
      </ShellModeProvider>
    </ServerProvider>,
  );
}

async function expectOnlyDisabledAutoOption() {
  const listbox = screen.getByRole('listbox', { name: 'Select model' });
  const options = await within(listbox).findAllByRole('option');
  expect(options).toHaveLength(1);
  expect(options[0]).toHaveTextContent('Auto');
  expect(options[0]).toBeDisabled();
  expect(within(listbox).queryByRole('group')).toBeNull();
  expect(screen.queryByText('No models')).toBeNull();
}

describe('DraftModelSelector', () => {
  beforeEach(() => {
    agentSpec = {
      model: {
        name: 'openai/gpt-4.1',
        params: { maxTokens: 512, reasoningEffort: 'medium' },
      },
    };
    updateAgentSpec.mockReset();
  });

  it('shows a model warning on the closed control and its list row', async () => {
    const warning = "Reasoning effort is not configured for this model, which may affect TrueForge's performance.";
    renderSelector(
      {},
      {
        getModels: async () => [
          {
            id: 'gpt-4.1',
            name: 'openai/gpt-4.1',
            provider: { name: 'OpenAI' },
            properties: {},
            warning,
          },
          {
            id: 'claude-3.7-sonnet',
            name: 'anthropic/claude-3.7-sonnet',
            provider: { name: 'Anthropic' },
            properties: { reasoningEfforts: ['low', 'high'] },
          },
        ],
      },
    );

    const trigger = await screen.findByRole('button', { name: 'Select model' });
    await waitFor(() => expect(trigger).toHaveTextContent('gpt-4.1'));
    const closedWarning = screen.getByRole('img', { name: warning });
    expect(closedWarning.closest('button')).toBeNull();
    fireEvent.mouseEnter(closedWarning.parentElement ?? closedWarning);
    expect(screen.getByRole('tooltip')).toHaveTextContent(warning);

    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox', { name: 'Select model' });
    const warnedOption = within(listbox).getByRole('option', { name: /gpt-4.1/i });
    expect(within(warnedOption).getByRole('img', { name: warning })).toBeInTheDocument();
    expect(
      within(listbox)
        .getByRole('option', { name: /claude-3.7-sonnet/i })
        .querySelector('[role="img"]'),
    ).toBeNull();
  });

  it('shows the full model name in a tooltip on hover', async () => {
    const longName = 'global.anthropic.claude-sonnet-4-20250514';
    agentSpec = { model: { name: longName } };
    renderSelector(
      {},
      {
        getModels: async () => [
          {
            id: 'claude-sonnet-4',
            name: longName,
            provider: { name: 'Anthropic' },
            properties: {},
          },
        ],
      },
    );

    const trigger = await screen.findByRole('button', { name: 'Select model' });
    await waitFor(() => expect(trigger).toHaveTextContent(longName));
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent(longName);
  });

  it('lists Auto when the server offers it, disabled with its reason while the tenant has it off', async () => {
    const reason = 'Auto mode is turned off for this tenant - an admin can turn it back on in settings.';
    const base = createMockAgentUIServer();
    renderSelector(
      {},
      {
        getModels: async () => models,
        getCapabilities: async () => {
          const { data } = await base.getCapabilities();
          return { data: { ...data, auto: { enabled: false, reason } } };
        },
      },
    );

    const trigger = await screen.findByRole('button', { name: 'Select model' });
    await waitFor(() => expect(trigger).toHaveTextContent('gpt-4.1'));
    fireEvent.click(trigger);

    const auto = await screen.findByRole('option', { name: /Auto/ });
    expect(auto).toBeDisabled();
    expect(auto).toHaveTextContent(reason);
  });

  it('filters models and updates the agent spec when a model is selected', async () => {
    renderSelector();

    const trigger = await screen.findByRole('button', { name: 'Select model' });
    await waitFor(() => expect(trigger).toHaveTextContent('gpt-4.1'));
    expect(trigger.querySelector('img')?.getAttribute('src')).toBe('https://assets.example/openai.svg');
    fireEvent.click(trigger);

    const listbox = screen.getByRole('listbox', { name: 'Select model' });
    expect(
      within(listbox)
        .getAllByRole('option')
        .map(option => option.textContent),
    ).toEqual([
      expect.stringContaining('Auto'),
      expect.stringContaining('gpt-4.1'),
      expect.stringContaining('claude-3.7-sonnet'),
    ]);
    expect(within(listbox).getByText(/128K context/)).toBeInTheDocument();
    const providerGroups = within(listbox).getAllByRole('group');
    expect(providerGroups).toHaveLength(2);
    expect(providerGroups[0]).toHaveTextContent(/openai/i);
    expect(providerGroups[1]).toHaveTextContent(/anthropic/i);
    expect(
      within(listbox)
        .getByRole('group', { name: /openai/i })
        .querySelector('img')
        ?.getAttribute('src'),
    ).toBe('https://assets.example/openai.svg');
    expect(
      within(listbox)
        .getByRole('option', { name: /gpt-4.1/i })
        .querySelector('img'),
    ).toBeNull();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'anthropic' } });
    expect(within(listbox).getAllByRole('option')).toHaveLength(1);
    expect(within(listbox).getAllByRole('group')).toHaveLength(1);
    expect(within(listbox).getByRole('option')).toHaveTextContent('claude-3.7-sonnet');

    fireEvent.click(within(listbox).getByRole('option'));

    expect(updateAgentSpec).toHaveBeenCalledWith({
      model: {
        name: 'anthropic/claude-3.7-sonnet',
        params: { maxTokens: 512, reasoningEffort: 'high' },
      },
    });
    expect(screen.queryByRole('listbox', { name: 'Select model' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('clears sticky reasoningEffort when switching to a model without efforts', async () => {
    agentSpec = {
      model: {
        name: 'anthropic/claude-3.7-sonnet',
        params: { maxTokens: 512, reasoningEffort: 'high' },
      },
    };
    renderSelector();

    const trigger = await screen.findByRole('button', { name: 'Select model' });
    await waitFor(() => expect(trigger).toHaveTextContent('claude-3.7-sonnet'));
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /gpt-4.1/i }));

    expect(updateAgentSpec).toHaveBeenCalledWith({
      model: {
        name: 'openai/gpt-4.1',
        params: { maxTokens: 512, reasoningEffort: undefined },
      },
    });
  });

  it('shows row efforts and sets one from the Reasoning menu, selecting that model', async () => {
    renderSelector();

    const trigger = await screen.findByRole('button', { name: 'Select model' });
    await waitFor(() => expect(trigger).toHaveTextContent('gpt-4.1'));
    fireEvent.click(trigger);

    const listbox = screen.getByRole('listbox', { name: 'Select model' });
    const plain = within(listbox).getByRole('option', { name: /gpt-4.1/i });
    expect(within(plain).queryByRole('button', { name: 'Edit reasoning effort' })).toBeNull();
    const reasoning = within(listbox).getByRole('option', { name: /claude-3.7-sonnet/i });
    expect(reasoning).toHaveTextContent('High');

    fireEvent.click(within(reasoning).getByRole('button', { name: 'Edit reasoning effort' }));
    expect(updateAgentSpec).not.toHaveBeenCalled();
    const menu = screen.getByRole('menu', { name: 'Reasoning effort' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map(item => item.textContent),
    ).toEqual(['Default', 'Low', 'High']);
    expect(within(menu).getByRole('menuitemradio', { name: 'High' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Low' }));
    expect(updateAgentSpec).toHaveBeenCalledWith({
      model: { name: 'anthropic/claude-3.7-sonnet', params: { maxTokens: 512, reasoningEffort: 'low' } },
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it("shows the selected model's reasoning effort next to its name", async () => {
    agentSpec = { model: { name: 'anthropic/claude-3.7-sonnet', params: { reasoningEffort: 'high' } } };
    renderSelector();

    const trigger = await screen.findByRole('button', { name: 'Select model' });
    await waitFor(() => expect(trigger).toHaveTextContent('claude-3.7-sonnetHigh'));
  });

  it('shows no reasoning effort for a selected model without efforts', async () => {
    renderSelector();

    const trigger = await screen.findByRole('button', { name: 'Select model' });
    await waitFor(() => expect(trigger).toHaveTextContent('gpt-4.1'));
    expect(trigger).not.toHaveTextContent('Medium');
  });

  it('clears reasoningEffort when Default is chosen', async () => {
    agentSpec = { model: { name: 'anthropic/claude-3.7-sonnet', params: { maxTokens: 512, reasoningEffort: 'high' } } };
    renderSelector();

    const trigger = await screen.findByRole('button', { name: 'Select model' });
    await waitFor(() => expect(trigger).toHaveTextContent('claude-3.7-sonnet'));
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Edit reasoning effort' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Default' }));

    expect(updateAgentSpec).toHaveBeenCalledWith({
      model: { name: 'anthropic/claude-3.7-sonnet', params: { maxTokens: 512, reasoningEffort: undefined } },
    });
  });

  describe('with Auto available', () => {
    const withAuto: Partial<AgentUIServer> = {
      getModels: async () => models,
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true, environments: { enabled: true } },
          skill: { enabled: true },
          sessionSharing: tenantSessionSharing,
          settings: allSettingsSections(true),
          auto: { enabled: true },
        },
      }),
    };

    it('unsets every model param when Auto is selected', async () => {
      renderSelector({}, withAuto);

      const trigger = await screen.findByRole('button', { name: 'Select model' });
      await waitFor(() => expect(trigger).toHaveTextContent('gpt-4.1'));
      fireEvent.click(trigger);
      const auto = await screen.findByRole('option', { name: /Auto/ });
      await waitFor(() => expect(auto).toBeEnabled());
      fireEvent.click(auto);

      expect(updateAgentSpec).toHaveBeenCalledWith({
        model: {
          name: 'auto',
          params: {
            maxTokens: undefined,
            reasoningEffort: undefined,
            temperature: undefined,
            topP: undefined,
            topK: undefined,
            parallelToolCalls: undefined,
          },
        },
      });
    });

    it('shows no empty state when the search only matches Auto', async () => {
      renderSelector({}, withAuto);

      const trigger = await screen.findByRole('button', { name: 'Select model' });
      await waitFor(() => expect(trigger).toHaveTextContent('gpt-4.1'));
      fireEvent.click(trigger);
      fireEvent.change(screen.getByPlaceholderText('Search models'), { target: { value: 'auto' } });

      expect(screen.getByRole('option', { name: /Auto/ })).toBeInTheDocument();
      expect(screen.queryByText('No models')).toBeNull();
    });
  });

  it('uses the first catalog model when the runtime has no draft spec', async () => {
    agentSpec = undefined;
    renderSelector();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent('gpt-4.1'));
    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({
        model: { name: 'openai/gpt-4.1' },
      });
    });
  });

  it('replaces a stale agentSpec model that is missing from the catalog', async () => {
    agentSpec = { model: { name: 'openai-main/gpt-4.1' } };
    renderSelector();

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({
        model: { name: 'openai/gpt-4.1' },
      });
    });
  });

  it('does not rewrite agentSpec when the selected model is already in the catalog', async () => {
    renderSelector();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Select model' })).toHaveTextContent('gpt-4.1'));
    expect(updateAgentSpec).not.toHaveBeenCalled();
  });

  it('disables selection while disabled', () => {
    render(<DraftModelSelector disabled />);

    expect(screen.getByRole('button', { name: 'Select model' })).toBeDisabled();
  });

  it('shows Configure model when settings chrome is available and no models', async () => {
    renderSelector(
      {},
      {
        getModels: async () => [],
        catalog: createMockCatalog(),
      },
    );

    const cta = await screen.findByRole('button', { name: 'Configure model' });
    expect(screen.queryByRole('button', { name: 'Select model' })).not.toBeInTheDocument();

    fireEvent.click(cta);
    expect(screen.queryByRole('listbox', { name: 'Select model' })).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-open')).toHaveTextContent('true');
  });

  it('does not flash Configure model before the catalog finishes loading', async () => {
    let resolveModels!: (value: ModelSelection[]) => void;
    const modelsPromise = new Promise<ModelSelection[]>(resolve => {
      resolveModels = resolve;
    });

    renderSelector(
      {},
      {
        getModels: () => modelsPromise,
        catalog: createMockCatalog(),
      },
    );

    expect(await screen.findByRole('button', { name: 'Select model' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configure model' })).not.toBeInTheDocument();

    resolveModels([]);
    expect(await screen.findByRole('button', { name: 'Configure model' })).toBeInTheDocument();
  });

  it('keeps the model picker when settings chrome is disabled', async () => {
    renderSelector(
      {},
      {
        getModels: async () => [],
        catalog: createMockCatalog(),
        getCapabilities: async () => ({
          data: {
            sandbox: { enabled: true, environments: { enabled: true } },
            skill: { enabled: true },
            auto: { enabled: false },
            sessionSharing: tenantSessionSharing,
            settings: allSettingsSections(false),
          },
        }),
      },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Select model' }));
    await expectOnlyDisabledAutoOption();
    expect(screen.queryByRole('button', { name: 'Configure model' })).not.toBeInTheDocument();
  });

  it('keeps the model picker when the caller cannot manage model providers', async () => {
    renderSelector(
      {},
      {
        getModels: async () => [],
        catalog: createMockCatalog(),
        getCapabilities: async () => ({
          data: {
            sandbox: { enabled: true, environments: { enabled: true } },
            skill: { enabled: true },
            auto: { enabled: false },
            sessionSharing: tenantSessionSharing,
            settings: { ...allSettingsSections(true), modelProviders: { enabled: true, manageProviders: false } },
          },
        }),
      },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Select model' }));
    await expectOnlyDisabledAutoOption();
    expect(screen.queryByRole('button', { name: 'Configure model' })).not.toBeInTheDocument();
  });

  it('lists only a disabled Auto option when the catalog is not configured', async () => {
    renderSelector({}, { getModels: async () => [] });

    fireEvent.click(await screen.findByRole('button', { name: 'Select model' }));
    await expectOnlyDisabledAutoOption();
    expect(screen.queryByRole('button', { name: 'Configure model' })).not.toBeInTheDocument();
  });
});
