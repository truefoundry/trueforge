// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftModelSelector, type DraftModelSelectorProps } from '@/atoms/draft/DraftModelSelector.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { AgentSpec, AgentUIServer, ModelSelection } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

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

  it('filters models and updates the agent spec when a model is selected', async () => {
    renderSelector();

    const trigger = await screen.findByRole('button', { name: 'Select model' });
    await waitFor(() => expect(trigger).toHaveTextContent('gpt-4.1'));
    expect(trigger.querySelector('img')?.getAttribute('src')).toBe('https://assets.example/openai.svg');
    fireEvent.click(trigger);

    const listbox = screen.getByRole('listbox', { name: 'Select model' });
    expect(within(listbox).getAllByRole('option')).toHaveLength(2);
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

  it('disables selection while disabled or running', () => {
    const { rerender } = render(<DraftModelSelector disabled />);

    expect(screen.getByRole('button', { name: 'Select model' })).toBeDisabled();

    rerender(<DraftModelSelector isRunning />);
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
          data: { sandbox: { enabled: true }, skill: { enabled: true }, settings: { enabled: false } },
        }),
      },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Select model' }));
    await waitFor(() => expect(screen.getByText('No models')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Configure model' })).not.toBeInTheDocument();
  });

  it('shows No models when the catalog is not configured', async () => {
    renderSelector({}, { getModels: async () => [] });

    fireEvent.click(await screen.findByRole('button', { name: 'Select model' }));
    await waitFor(() => expect(screen.getByText('No models')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Configure model' })).not.toBeInTheDocument();
  });
});
