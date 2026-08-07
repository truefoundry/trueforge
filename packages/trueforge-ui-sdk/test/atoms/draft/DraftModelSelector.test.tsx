// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftModelSelector, type DraftModelSelectorProps } from '@/atoms/draft/DraftModelSelector.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentSpec, ModelSelection } from '@/server/types.js';
import { createMockAgentUIServer } from '../../server/mockServer.js';

let agentSpec: AgentSpec | undefined;
const updateAgentSpec = vi.fn();

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({ agentSpec }),
  useTrueFoundryUpdateAgentSpec: () => updateAgentSpec,
}));

const models: ModelSelection[] = [
  { name: 'openai/gpt-4.1', provider: 'OpenAI' },
  {
    name: 'anthropic/claude-3.7-sonnet',
    provider: 'Anthropic',
    reasoningEfforts: ['low', 'high'],
  },
];

function renderSelector(props: DraftModelSelectorProps = {}) {
  const server = createMockAgentUIServer({ getModels: async () => models });

  return render(
    <ServerProvider server={server}>
      <DraftCatalogProvider>
        <DraftModelSelector {...props} />
      </DraftCatalogProvider>
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
    fireEvent.click(trigger);

    const listbox = screen.getByRole('listbox', { name: 'Select model' });
    expect(within(listbox).getAllByRole('option')).toHaveLength(2);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'anthropic' } });
    expect(within(listbox).getAllByRole('option')).toHaveLength(1);
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

  it('uses the first catalog model when the runtime has no draft spec', async () => {
    agentSpec = undefined;
    renderSelector();

    await waitFor(() => expect(screen.getByTitle('Select model')).toHaveTextContent('gpt-4.1'));
  });

  it('disables selection while disabled or running', () => {
    const { rerender } = render(<DraftModelSelector disabled />);

    expect(screen.getByTitle('Select model')).toBeDisabled();

    rerender(<DraftModelSelector isRunning />);
    expect(screen.getByTitle('Select model')).toBeDisabled();
  });
});
