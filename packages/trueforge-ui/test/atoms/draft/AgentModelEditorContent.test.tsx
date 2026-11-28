// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Fragment, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AgentModelEditorContent } from '@/atoms/draft/AgentModelEditorContent.js';
import { CompactLayoutProvider } from '@/atoms/lib/CompactLayoutContext.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentSpec, AutoRoutingCategory, ModelSelection } from '@/server/types.js';
import { createMockAgentUIServer, tenantSessionSharing } from '../../server/mockServer.js';
import { allSettingsSections } from '../../server/settingsCapabilityFixture.js';

const models: ModelSelection[] = [
  {
    id: 'gpt-4o',
    name: 'openai/gpt-4o',
    provider: { name: 'OpenAI' },
    properties: {},
  },
  {
    id: 'gpt-4.1',
    name: 'openai/gpt-4.1',
    provider: { name: 'OpenAI' },
    properties: {},
  },
  {
    id: 'claude-sonnet',
    name: 'anthropic/claude-sonnet',
    provider: { name: 'Anthropic' },
    properties: {},
  },
  {
    id: 'claude-haiku',
    name: 'anthropic/claude-haiku',
    provider: { name: 'Anthropic' },
    properties: {},
  },
];

const spec: AgentSpec = { model: { type: 'fixed', name: 'openai/gpt-4o' } };

function ModelEditor() {
  const [query, setQuery] = useState('');
  return (
    <AgentModelEditorContent
      spec={spec}
      models={models}
      loading={false}
      error={null}
      query={query}
      onQueryChange={setQuery}
      onChange={vi.fn()}
    />
  );
}

describe('AgentModelEditorContent', () => {
  it('shows every model when the normalized provider name matches', () => {
    render(<ModelEditor />);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'anth ro_pic' } });

    expect(screen.queryByRole('button', { name: 'OpenAI' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anthropic' })).toBeInTheDocument();
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2);
  });

  it('finds a model in another provider and selects that provider', () => {
    render(<ModelEditor />);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'claude sonnet' } });

    expect(screen.queryByRole('button', { name: 'OpenAI' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anthropic' })).toBeInTheDocument();
    expect(within(screen.getByRole('listbox')).getByRole('option')).toHaveTextContent('claude-sonnet');
  });

  it('restores the chosen provider after clearing the query', () => {
    render(<ModelEditor />);

    fireEvent.click(screen.getByRole('button', { name: 'Anthropic' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gpt_4o' } });
    expect(within(screen.getByRole('listbox')).getByRole('option')).toHaveTextContent('gpt-4o');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });

    expect(screen.getByRole('button', { name: 'OpenAI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anthropic' })).toBeInTheDocument();
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2);
    expect(within(screen.getByRole('listbox')).getByText('claude-sonnet')).toBeInTheDocument();
  });

  it('shows the empty state when nothing matches', () => {
    render(<ModelEditor />);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });

    expect(screen.queryByRole('button', { name: 'OpenAI' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anthropic' })).not.toBeInTheDocument();
    expect(screen.getByText('No models')).toBeInTheDocument();
  });

  it('uses provider-first navigation in compact layouts', () => {
    render(
      <CompactLayoutProvider>
        <ModelEditor />
      </CompactLayoutProvider>,
    );

    expect(screen.getByText('Select provider')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Anthropic' }));

    expect(screen.getByRole('button', { name: 'Back to providers' })).toBeInTheDocument();
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Back to providers' }));

    expect(screen.getByText('Select provider')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OpenAI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anthropic' })).toBeInTheDocument();
  });
});

const ALL_TIERS = ['answer', 'execute', 'analyze', 'frontier'] satisfies AutoRoutingCategory[];

function routable({
  name,
  provider,
  enabled = true,
  categories = ALL_TIERS,
}: {
  name: string;
  provider: string;
  enabled?: boolean;
  categories?: AutoRoutingCategory[];
}) {
  const model: ModelSelection = {
    id: name.slice(name.indexOf('/') + 1),
    name,
    provider: { name: provider },
    properties: { contextLength: 1_000_000, autoRouting: { supported: true, enabled, categories } },
  };
  return model;
}

const autoModels: ModelSelection[] = [
  routable({ name: 'anthropic/sonnet', provider: 'Anthropic' }),
  routable({ name: 'anthropic/haiku', provider: 'Anthropic', categories: ['answer'] }),
  routable({ name: 'anthropic/opus', provider: 'Anthropic', categories: ['answer'] }),
  routable({ name: 'openai/gpt-5', provider: 'OpenAI' }),
  routable({ name: 'openai/gpt-5-mini', provider: 'OpenAI', categories: ['answer'] }),
  routable({ name: 'openai/gpt-5-nano', provider: 'OpenAI', categories: ['answer'] }),
  // Supported by Auto, but an admin has not enabled it in settings.
  routable({ name: 'openai/gpt-5-pro', provider: 'OpenAI', enabled: false }),
  {
    id: 'gemma',
    name: 'google/gemma',
    provider: { name: 'Google' },
    properties: { autoRouting: { supported: false, unsupportedReason: 'No canonical model mapping.' } },
  },
];

const savedCandidates = ['anthropic/sonnet', 'anthropic/haiku', 'anthropic/opus', 'openai/gpt-5'];
const workspaceCandidates = [...savedCandidates, 'openai/gpt-5-mini', 'openai/gpt-5-nano'];

function renderWithAuto({ spec: currentSpec, compact = false }: { spec: AgentSpec; compact?: boolean }) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const server = createMockAgentUIServer({
    getCapabilities: async () => ({
      data: {
        sandbox: { enabled: true, environments: { enabled: true } },
        skill: { enabled: true },
        sessionSharing: tenantSessionSharing,
        settings: allSettingsSections(true),
        auto: { status: 'enabled' },
      },
    }),
  });
  const Layout = compact ? CompactLayoutProvider : Fragment;
  function Editor() {
    const [query, setQuery] = useState('');
    return (
      <ServerProvider server={server}>
        <Layout>
          <AgentModelEditorContent
            spec={currentSpec}
            models={autoModels}
            loading={false}
            error={null}
            query={query}
            onQueryChange={setQuery}
            onChange={onChange}
            onClose={onClose}
          />
        </Layout>
      </ServerProvider>
    );
  }
  render(<Editor />);
  return { onChange, onClose };
}

describe('AgentModelEditorContent with Auto', () => {
  const autoSpec: AgentSpec = { model: { type: 'auto', candidateModels: savedCandidates } };

  it('lists Auto above the providers, set apart from them', async () => {
    renderWithAuto({ spec });

    const auto = await screen.findByRole('button', { name: /^Auto/ });

    expect(auto.compareDocumentPosition(screen.getByText('Provider'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(auto.compareDocumentPosition(screen.getByRole('button', { name: 'OpenAI' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('opens on the Auto candidates, with their count, when the agent uses Auto', async () => {
    renderWithAuto({ spec: autoSpec });

    expect(await screen.findByRole('button', { name: 'Auto 4' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('listbox')).getAllByRole('option', { selected: true })).toHaveLength(4);
    expect(screen.getByText('4 of 6 selected')).toBeInTheDocument();
  });

  it('starts from the workspace Auto models when switching a fixed agent to Auto', async () => {
    const { onChange, onClose } = renderWithAuto({ spec });

    fireEvent.click(await screen.findByRole('button', { name: /^Auto/ }));
    expect(screen.getByText('6 of 6 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith({ ...spec, model: { type: 'auto', candidateModels: workspaceCandidates } });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('applies the edited candidates and blocks Apply below the minimum', async () => {
    const { onChange } = renderWithAuto({ spec: autoSpec });
    await screen.findByRole('button', { name: 'Auto 4' });

    fireEvent.click(screen.getByRole('option', { name: /gpt-5-mini/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({
      ...autoSpec,
      model: { type: 'auto', candidateModels: [...savedCandidates, 'openai/gpt-5-mini'] },
    });

    fireEvent.click(screen.getByRole('option', { name: /gpt-5-mini/ }));
    fireEvent.click(screen.getByRole('option', { name: /sonnet/ }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByText(/pick at least 4/)).toBeInTheDocument();
  });

  it('lists only models Auto supports and settings enable, grouped by provider', async () => {
    renderWithAuto({ spec: autoSpec });
    await screen.findByRole('button', { name: 'Auto 4' });

    expect(screen.queryByRole('option', { name: /gemma/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Google' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /gpt-5-pro/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'OpenAI' })).getAllByRole('option')).toHaveLength(3);
  });

  it('blocks Apply while a routing tier has no selected model', async () => {
    renderWithAuto({
      spec: {
        model: {
          type: 'auto',
          candidateModels: ['anthropic/haiku', 'anthropic/opus', 'openai/gpt-5-mini', 'openai/gpt-5-nano'],
        },
      },
    });
    await screen.findByRole('button', { name: 'Auto 4' });

    expect(screen.getByText(/no model for Execute, Analyze, and Frontier/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.click(screen.getByRole('option', { name: /sonnet/ }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('marks a saved candidate that settings no longer enable, and blocks Apply until it is unticked', async () => {
    renderWithAuto({
      spec: { model: { type: 'auto', candidateModels: [...savedCandidates, 'openai/gpt-5-pro'] } },
    });

    expect(await screen.findByRole('option', { name: /gpt-5-pro/ })).toHaveTextContent('no longer in workspace list');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByText(/untick 1 unavailable model/)).toBeInTheDocument();
    // The rows say what is wrong, so the picker carries no separate warning or hover card.
    expect(screen.queryByText(/removed from workspace list/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: /gpt-5-pro/ }));
    expect(screen.queryByRole('option', { name: /gpt-5-pro/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('marks a saved candidate that no longer supports Auto', async () => {
    renderWithAuto({
      spec: { model: { type: 'auto', candidateModels: [...savedCandidates, 'google/gemma'] } },
    });

    expect(await screen.findByRole('option', { name: /gemma/ })).toHaveTextContent('no longer in workspace list');
  });

  it('lists a saved candidate the workspace dropped, and drops it once unticked', async () => {
    const { onChange } = renderWithAuto({
      spec: { model: { type: 'auto', candidateModels: [...savedCandidates, 'openai/retired'] } },
    });

    expect(await screen.findByRole('option', { name: /retired/ })).toHaveTextContent('no longer in workspace list');
    expect(screen.getByText(/^5 of 7 selected/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: /retired/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({ model: { type: 'auto', candidateModels: savedCandidates } });
  });

  it('lists Auto first in the compact provider list and opens its candidates', async () => {
    renderWithAuto({ spec, compact: true });

    const auto = await screen.findByRole('button', { name: /^Auto/ });
    expect(auto.compareDocumentPosition(screen.getByRole('button', { name: 'OpenAI' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    fireEvent.click(auto);

    expect(screen.getByRole('button', { name: 'Back to providers' })).toBeInTheDocument();
    expect(screen.getByText('6 of 6 selected')).toBeInTheDocument();
  });
});
