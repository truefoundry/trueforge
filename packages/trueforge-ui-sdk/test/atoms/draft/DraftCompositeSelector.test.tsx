// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftCompositeSelector, type DraftCompositeSelectorProps } from '@/atoms/draft/DraftCompositeSelector.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentSpec } from '@/server/types.js';
import { createMockAgentUIServer } from '../../server/mockServer.js';

let agentSpec: AgentSpec;
const updateAgentSpec = vi.fn();

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({ agentSpec }),
  useTrueFoundryUpdateAgentSpec: () => updateAgentSpec,
}));

function renderSelector(props: DraftCompositeSelectorProps = {}) {
  const server = createMockAgentUIServer({
    getSkills: async () => [
      { id: 'research', name: 'Research', description: 'Find relevant sources' },
      { id: 'writer', name: 'Writer', description: 'Draft polished copy' },
    ],
    getMcp: async () => [
      { id: 'github', name: 'GitHub', description: 'Code hosting' },
      { id: 'slack', name: 'Slack', description: 'Team messages' },
    ],
  });

  return render(
    <ServerProvider server={server}>
      <DraftCatalogProvider>
        <DraftCompositeSelector {...props} />
      </DraftCatalogProvider>
    </ServerProvider>,
  );
}

describe('DraftCompositeSelector', () => {
  beforeEach(() => {
    agentSpec = {
      model: { name: 'openai/gpt-4.1' },
      mcpServers: [{ id: 'slack', name: 'Slack' }],
      skills: [{ id: 'research', name: 'Research' }],
    };
    updateAgentSpec.mockReset();
  });

  it('adds an available connector to the draft spec', async () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' }));

    const github = await screen.findByRole('menuitemcheckbox', { name: /GitHub/ });
    expect(github).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(github);

    expect(updateAgentSpec).toHaveBeenCalledWith({
      mcpServers: [
        { id: 'slack', name: 'Slack' },
        { id: 'github', name: 'GitHub' },
      ],
    });
  });

  it('switches tabs, resets search, and removes a selected skill', async () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' }));
    await screen.findByRole('menuitemcheckbox', { name: /GitHub/ });

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'github' } });
    expect(screen.queryByRole('menuitemcheckbox', { name: /Slack/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Skills/ }));
    const skillSearch = screen.getByRole('searchbox');
    expect(skillSearch).toHaveValue('');
    expect(skillSearch).toHaveAttribute('placeholder', 'Search skills...');

    const dialog = screen.getByRole('dialog', { name: 'Add to composer' });
    const research = within(dialog).getByRole('menuitemcheckbox', { name: /Research/ });
    expect(research).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('menuitemcheckbox', { name: /Writer/ })).toBeInTheDocument();
    fireEvent.click(research);

    expect(updateAgentSpec).toHaveBeenCalledWith({ skills: [] });
  });

  it('forwards attachment requests and closes the picker', async () => {
    const onAttach = vi.fn();
    renderSelector({ onAttach });
    const trigger = screen.getByRole('button', { name: 'Add connectors, skills, or attachments' });
    fireEvent.click(trigger);
    await screen.findByRole('menuitemcheckbox', { name: /GitHub/ });
    fireEvent.click(screen.getByRole('button', { name: 'Attachment' }));
    fireEvent.click(screen.getByRole('button', { name: /Add files or photos/ }));

    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Add to composer' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('cannot open while disabled or running', () => {
    const { rerender } = render(<DraftCompositeSelector disabled />);

    expect(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' })).toBeDisabled();

    rerender(<DraftCompositeSelector isRunning />);
    expect(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' })).toBeDisabled();
  });
});
