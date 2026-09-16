// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AgentOverview from '@/atoms/agent-details/AgentOverview.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentDetail, McpToolSelection } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

function tool(name: string, annotations: { readOnlyHint?: boolean; destructiveHint?: boolean }): McpToolSelection {
  const row: McpToolSelection = { id: name, name };
  Reflect.set(row, 'annotations', annotations);
  return row;
}

const slackTools = [
  tool('slack_send_message', { readOnlyHint: false }),
  tool('slack_update_canvas', { destructiveHint: true }),
  tool('slack_search_public', { readOnlyHint: true }),
];
const webTools = [tool('web_search', { readOnlyHint: true })];

const detail: AgentDetail = {
  agentId: 'agent-1',
  name: 'release-notes-writer',
  agentSpec: {
    model: { name: 'openai/gpt-5.1' },
    instructions: 'Write release notes.',
    mcpServers: [
      { name: 'slack', requireApprovalForTools: ['@destructive'] },
      { name: 'parallel-web', enableTools: ['web_search'] },
    ],
  },
};

function renderOverview({
  getMcpTools,
  agentDetail = detail,
}: {
  getMcpTools?: (request: { connectorId: string }) => Promise<McpToolSelection[]>;
  agentDetail?: AgentDetail;
} = {}) {
  const server = createMockAgentUIServer(getMcpTools === undefined ? {} : { getMcpTools });
  render(
    <SlotsProvider>
      <ServerProvider server={server}>
        <AgentOverview detail={agentDetail} />
      </ServerProvider>
    </SlotsProvider>,
  );
}

describe('AgentOverview MCP servers', () => {
  it('lists each server with its tool count and how many tools need approval', async () => {
    const getMcpTools = vi.fn(async ({ connectorId }: { connectorId: string }) =>
      connectorId === 'slack' ? slackTools : webTools,
    );
    renderOverview({ getMcpTools });

    expect(await screen.findByText('3 tools')).toBeInTheDocument();
    expect(screen.getByText('1 tool')).toBeInTheDocument();
    expect(screen.getByLabelText('1 tool needs approval')).toBeInTheDocument();
    expect(getMcpTools).toHaveBeenCalledWith({ connectorId: 'slack' });
    expect(getMcpTools).toHaveBeenCalledWith({ connectorId: 'parallel-web' });
  });

  it('expands a server into read/write/destructive tools with their approval state', async () => {
    renderOverview({ getMcpTools: vi.fn(async () => slackTools) });

    const slack = await screen.findByRole('button', { name: /slack/ });
    expect(slack).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(slack);

    expect(slack).toHaveAttribute('aria-expanded', 'true');
    // Read-only tools sort first and destructive last, as in the tool picker.
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(
      expect.arrayContaining(['slack_search_publicread', 'slack_send_messagewrite', 'slack_update_canvasdestructive']),
    );
    expect(screen.getByLabelText('slack_search_public runs without approval')).toBeInTheDocument();
    expect(screen.getByLabelText('slack_update_canvas requires approval')).toBeInTheDocument();
  });

  it('keeps an all-tools server readable when the host cannot list tools', async () => {
    renderOverview();

    expect(await screen.findByText('All tools')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /slack/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /parallel-web/ })).toBeEnabled();
  });

  it('applies tag-based enableTools and subtracts disableTools', async () => {
    renderOverview({
      getMcpTools: vi.fn(async () => slackTools),
      agentDetail: {
        ...detail,
        agentSpec: {
          ...detail.agentSpec,
          mcpServers: [
            { name: 'slack', enableTools: ['@all'], disableTools: ['slack_update_canvas'] },
            { name: 'parallel-web', enableTools: ['@read-only'] },
          ],
        },
      },
    });

    expect(await screen.findByText('2 tools')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /slack/ }));
    expect(screen.queryByText('slack_update_canvas')).not.toBeInTheDocument();
    expect(screen.getByText('slack_send_message')).toBeInTheDocument();
  });

  it('falls back to the selector text when tags cannot be resolved', () => {
    renderOverview({
      agentDetail: {
        ...detail,
        agentSpec: { ...detail.agentSpec, mcpServers: [{ name: 'slack', enableTools: ['@read-only'] }] },
      },
    });

    expect(screen.getByText('@read-only')).toBeInTheDocument();
  });

  it('counts only the servers it can render', () => {
    renderOverview({
      agentDetail: { ...detail, agentSpec: { ...detail.agentSpec, mcpServers: [] } },
    });

    expect(screen.getByRole('heading', { name: 'MCP Servers & Tools (0)' })).toBeInTheDocument();
    expect(screen.getByText('No connectors attached.')).toBeInTheDocument();
  });
});
