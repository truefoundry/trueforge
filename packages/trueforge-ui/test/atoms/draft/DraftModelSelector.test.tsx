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

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({ agentSpec }),
  useTrueFoundryUpdateAgentSpec: () => updateAgentSpec,
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

  it('filters models and updates the agent spec when a model is selected', async () => {
    renderSelector();

    const trigger = await screen.findByTitle('Select model');
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
        params: { maxTokens: 512, reasoningEffort: 'low' },
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

    const trigger = await screen.findByTitle('Select model');
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

    await waitFor(() => expect(screen.getByTitle('Select model')).toHaveTextContent('gpt-4.1'));
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

    await waitFor(() => expect(screen.getByTitle('Select model')).toHaveTextContent('gpt-4.1'));
    expect(updateAgentSpec).not.toHaveBeenCalled();
  });

  it('disables selection while disabled or running', () => {
    const { rerender } = render(<DraftModelSelector disabled />);

    expect(screen.getByTitle('Select model')).toBeDisabled();

    rerender(<DraftModelSelector isRunning />);
    expect(screen.getByTitle('Select model')).toBeDisabled();
  });

  it('shows a settings CTA when the host has a catalog and no models', async () => {
    renderSelector(
      {},
      {
        getModels: async () => [],
        catalog: createMockCatalog(),
      },
    );

    fireEvent.click(await screen.findByTitle('Select model'));
    const cta = await screen.findByRole('button', { name: /Please configure Models in the settings/i });
    expect(cta.querySelector('.underline')).toHaveTextContent('settings');

    fireEvent.click(cta);
    expect(screen.queryByRole('listbox', { name: 'Select model' })).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-open')).toHaveTextContent('true');
  });

  it('shows No models when the catalog is not configured', async () => {
    renderSelector({}, { getModels: async () => [] });

    fireEvent.click(await screen.findByTitle('Select model'));
    await waitFor(() => expect(screen.getByText('No models')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Please configure Models/i })).not.toBeInTheDocument();
  });
});
