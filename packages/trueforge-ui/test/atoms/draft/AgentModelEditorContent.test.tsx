// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AgentModelEditorContent } from '@/atoms/draft/AgentModelEditorContent.js';
import { CompactLayoutProvider } from '@/atoms/lib/CompactLayoutContext.js';
import type { AgentSpec, ModelSelection } from '@/server/types.js';

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

const spec: AgentSpec = { model: { name: 'openai/gpt-4o' } };

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
