// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftCompositeSelector, type DraftCompositeSelectorProps } from '@/atoms/draft/DraftCompositeSelector.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentBuilderCapabilitiesResponse, AgentSpec, AgentUIServer } from '@/server/types.js';
import { createMockAgentUIServer } from '../../server/mockServer.js';

let agentSpec: AgentSpec;
const updateAgentSpec = vi.fn();

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({ agentSpec }),
  useTrueFoundryUpdateAgentSpec: () => updateAgentSpec,
}));

type RenderSelectorOptions = {
  props?: DraftCompositeSelectorProps;
  getCapabilities?: () => Promise<AgentBuilderCapabilitiesResponse>;
  getSkills?: AgentUIServer['getSkills'];
  getMcp?: AgentUIServer['getMcp'];
};

function renderSelector({ props = {}, getCapabilities, getSkills, getMcp }: RenderSelectorOptions = {}) {
  const server = createMockAgentUIServer({
    ...(getCapabilities === undefined ? {} : { getCapabilities }),
    getSkills:
      getSkills ??
      (async () => [
        { id: 'research', name: 'Research', description: 'Find relevant sources' },
        { id: 'writer', name: 'Writer', description: 'Draft polished copy' },
      ]),
    getMcp:
      getMcp ??
      (async () => [
        { id: 'github', name: 'GitHub', description: 'Code hosting' },
        { id: 'slack', name: 'Slack', description: 'Team messages' },
      ]),
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    agentSpec = {
      model: { name: 'openai/gpt-4.1' },
      mcpServers: [{ id: 'slack', name: 'Slack' }],
      skills: [{ id: 'research', name: 'Research' }],
    };
    updateAgentSpec.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds an available connector to the draft spec after debounce', async () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' }));

    const github = await screen.findByRole('menuitemcheckbox', { name: /GitHub/ });
    expect(github).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(github);

    expect(updateAgentSpec).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(updateAgentSpec).toHaveBeenCalledWith({
      mcpServers: [
        { id: 'slack', name: 'Slack' },
        { id: 'github', name: 'GitHub' },
      ],
      skills: [{ id: 'research', name: 'Research' }],
    });
  });

  it('hydrates name-only wire mounts so a toggle does not wipe them', async () => {
    agentSpec = {
      model: { name: 'openai/gpt-4.1' },
      // Harness round-trip: id stripped; catalog keys by name.
      mcpServers: [{ name: 'slack' }],
      skills: [{ name: 'research' }],
    };
    renderSelector({
      getSkills: async () => [
        { id: 'research', name: 'research', description: 'Find relevant sources' },
        { id: 'writer', name: 'writer', description: 'Draft polished copy' },
      ],
      getMcp: async () => [
        { id: 'github', name: 'github', description: 'Code hosting' },
        { id: 'slack', name: 'slack', description: 'Team messages' },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' }));
    const slack = await screen.findByRole('menuitemcheckbox', { name: /slack/ });
    expect(slack).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /github/ }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(updateAgentSpec).toHaveBeenCalledWith({
      mcpServers: [
        { id: 'slack', name: 'slack' },
        { id: 'github', name: 'github' },
      ],
      skills: [{ id: 'research', name: 'research' }],
    });
  });

  it('switches tabs, resets search, and removes a selected skill on close flush', async () => {
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

    // Close before debounce — flush pending local state.
    fireEvent.click(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' }));

    expect(updateAgentSpec).toHaveBeenCalledWith({
      mcpServers: [{ id: 'slack', name: 'Slack' }],
      skills: [],
    });
  });

  it('forwards attachment requests and closes the picker', async () => {
    const onAttach = vi.fn();
    renderSelector({ props: { onAttach } });
    const trigger = screen.getByRole('button', { name: 'Add connectors, skills, or attachments' });
    fireEvent.click(trigger);
    await screen.findByRole('menuitemcheckbox', { name: /GitHub/ });
    fireEvent.click(screen.getByRole('button', { name: 'Attachment' }));
    fireEvent.click(screen.getByRole('button', { name: /Add files or photos/ }));

    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Add to composer' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('disables available skills while allowing selected skills to be removed', async () => {
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: false },
          skill: { enabled: false, reason: 'Select Sandbox first' },
        },
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' }));
    fireEvent.click(screen.getByRole('button', { name: /Skills/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('Select Sandbox first');
    const research = screen.getByRole('menuitemcheckbox', { name: /Research/ });
    expect(research).toBeEnabled();
    expect(screen.getByRole('menuitemcheckbox', { name: /Writer/ })).toBeDisabled();
    fireEvent.click(research);

    // Close before debounce — flush pending local state.
    fireEvent.click(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' }));

    expect(updateAgentSpec).toHaveBeenCalledWith({
      mcpServers: [{ id: 'slack', name: 'Slack' }],
      skills: [],
    });
  });

  it('disables available skills until capabilities load', async () => {
    renderSelector({
      getCapabilities: () => new Promise<AgentBuilderCapabilitiesResponse>(() => {}),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' }));
    fireEvent.click(screen.getByRole('button', { name: /Skills/ }));

    expect(await screen.findByRole('menuitemcheckbox', { name: /Research/ })).toBeEnabled();
    expect(screen.getByRole('menuitemcheckbox', { name: /Writer/ })).toBeDisabled();
  });

  it('cannot open while disabled or running', () => {
    const { rerender } = render(<DraftCompositeSelector disabled />);

    expect(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' })).toBeDisabled();

    rerender(<DraftCompositeSelector isRunning />);
    expect(screen.getByRole('button', { name: 'Add connectors, skills, or attachments' })).toBeDisabled();
  });
});
