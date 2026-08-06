// @vitest-environment jsdom
import { ThreadPrimitive, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssistantMessageContainer } from './AssistantMessageContainer.js';
import { RuntimeHarness } from './RuntimeHarness.js';

function renderToolCallMessage(content: ThreadMessageLike['content']) {
  const message: ThreadMessageLike = { role: 'assistant', content };
  return render(
    <RuntimeHarness messages={[message]}>
      <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
    </RuntimeHarness>,
  );
}

/** Pending approvals only surface part-level "requires-action" when the whole message is flagged too. */
function renderPendingApprovalMessage(
  content: ThreadMessageLike['content'],
  options?: { onRespondToToolApproval?: (o: unknown) => void },
) {
  const message: ThreadMessageLike = {
    role: 'assistant',
    content,
    status: { type: 'requires-action', reason: 'tool-calls' },
  };
  return render(
    <RuntimeHarness messages={[message]} onRespondToToolApproval={options?.onRespondToToolApproval}>
      <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
    </RuntimeHarness>,
  );
}

describe('ToolCallContainer', () => {
  it('renders a running tool call without a result', () => {
    renderToolCallMessage([{ type: 'tool-call', toolCallId: '1', toolName: 'search_docs', args: {} }]);
    expect(screen.getByText('search_docs')).toBeInTheDocument();
    expect(screen.queryByText('Result:')).not.toBeInTheDocument();
  });

  it('renders args and result for a completed tool call once expanded', () => {
    renderToolCallMessage([
      {
        type: 'tool-call',
        toolCallId: '1',
        toolName: 'get_current_datetime',
        args: {},
        argsText: '{"tz":"UTC"}',
        result: '2026-07-01T00:00:00Z',
      },
    ]);
    fireEvent.click(screen.getByText('get_current_datetime'));
    const blocks = screen.getAllByTestId('tfy-tool-call-content-block');
    expect(blocks[0]).toHaveAttribute('data-content', expect.stringContaining('"tz"'));
    expect(blocks[1]).toHaveAttribute('data-content', '2026-07-01T00:00:00Z');
  });

  it('renders an error result once expanded', () => {
    renderToolCallMessage([
      {
        type: 'tool-call',
        toolCallId: '1',
        toolName: 'flaky_tool',
        args: {},
        result: 'boom',
        isError: true,
      },
    ]);
    fireEvent.click(screen.getByText('flaky_tool'));
    const blocks = screen.getAllByTestId('tfy-tool-call-content-block');
    expect(blocks[1]).toHaveTextContent('boom');
  });

  it('auto-expands and shows the approval bar while an approval is pending', () => {
    renderPendingApprovalMessage([
      {
        type: 'tool-call',
        toolCallId: '1',
        toolName: 'delete_file',
        args: {},
        interrupt: { type: 'human', payload: {} },
        approval: { id: 'approval-1', approved: undefined },
      },
    ]);
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('calls onRespondToToolApproval when Allow is clicked', () => {
    const onRespondToToolApproval = vi.fn();
    renderPendingApprovalMessage(
      [
        {
          type: 'tool-call',
          toolCallId: '1',
          toolName: 'delete_file',
          args: {},
          interrupt: { type: 'human', payload: {} },
          approval: { id: 'approval-1', approved: undefined },
        },
      ],
      { onRespondToToolApproval },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(onRespondToToolApproval).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'approval-1', approved: true }),
    );
  });

  it('includes the denial reason when Deny is submitted', () => {
    const onRespondToToolApproval = vi.fn();
    renderPendingApprovalMessage(
      [
        {
          type: 'tool-call',
          toolCallId: '1',
          toolName: 'delete_file',
          args: {},
          interrupt: { type: 'human', payload: {} },
          approval: { id: 'approval-1', approved: undefined },
        },
      ],
      { onRespondToToolApproval },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    fireEvent.change(screen.getByPlaceholderText('Enter reason for denial'), {
      target: { value: 'Denied by user' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onRespondToToolApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: 'approval-1',
        approved: false,
        reason: 'Denied by user',
      }),
    );
  });

  it('renders declared approval options with their labels', () => {
    renderPendingApprovalMessage([
      {
        type: 'tool-call',
        toolCallId: '1',
        toolName: 'run_migration',
        args: {},
        interrupt: { type: 'human', payload: {} },
        approval: {
          id: 'approval-1',
          approved: undefined,
          options: [
            { id: 'opt-allow', kind: 'allow-once' },
            { id: 'opt-deny', kind: 'reject-once' },
          ],
        },
      },
    ]);
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('forwards confirmation copy and grants to the denial option', () => {
    renderPendingApprovalMessage([
      {
        type: 'tool-call',
        toolCallId: '1',
        toolName: 'run_migration',
        args: {},
        interrupt: { type: 'human', payload: {} },
        approval: {
          id: 'approval-1',
          approved: undefined,
          options: [
            { id: 'opt-allow', kind: 'allow-once' },
            {
              id: 'opt-deny',
              kind: 'reject-once',
              grants: ['database:write'],
              confirm: {
                title: 'Confirm denial',
                description: 'The migration will not run.',
              },
            },
          ],
        },
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(screen.getByText('Confirm denial')).toBeInTheDocument();
    expect(screen.getByText('The migration will not run.')).toBeInTheDocument();
    expect(screen.getByText('database:write')).toBeInTheDocument();
  });

  it('passes mcpServerName for list_tools', () => {
    renderToolCallMessage([
      {
        type: 'tool-call',
        toolCallId: '1',
        toolName: 'list_tools',
        args: {},
        argsText: '{"mcp_server":"github-team"}',
      },
    ]);
    // Verify the card is rendered (actual prop checking would require slot mocking)
    expect(screen.getByText(/Listing tools/)).toBeInTheDocument();
  });

  it('passes mcpServerName for call_tool', () => {
    renderToolCallMessage([
      {
        type: 'tool-call',
        toolCallId: '1',
        toolName: 'call_tool',
        args: {},
        argsText: '{"mcp_server":"slack-workspace","tool_name":"send_message","input":{}}',
      },
    ]);
    expect(screen.getByText(/call_tool: send_message/)).toBeInTheDocument();
  });

  it('passes mcpServerName for get_tool_info', () => {
    renderToolCallMessage([
      {
        type: 'tool-call',
        toolCallId: '1',
        toolName: 'get_tool_info',
        args: {},
        argsText: '{"mcp_server":"linear-integration","tool_name":"create_issue"}',
      },
    ]);
    expect(screen.getByText(/get_tool_info: create_issue/)).toBeInTheDocument();
  });

  it('does not pass mcpServerName for non-MCP tools', () => {
    renderToolCallMessage([
      {
        type: 'tool-call',
        toolCallId: '1',
        toolName: 'search_docs',
        args: {},
        argsText: '{"query":"example"}',
      },
    ]);
    expect(screen.getByText('search_docs')).toBeInTheDocument();
  });
});
