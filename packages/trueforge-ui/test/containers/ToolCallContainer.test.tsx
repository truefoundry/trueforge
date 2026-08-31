// @vitest-environment jsdom
import { ThreadPrimitive, type ThreadMessage, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AskUserPromptProps } from '@/atoms/adapters/AskUserPromptAdapter.js';
import type { SandboxToolCallCardProps } from '@/atoms/SandboxToolCallCard.js';
import type { SubAgentCardProps } from '@/atoms/SubAgentCard.js';
import type { ToolCallCardProps } from '@/atoms/ToolCallCard.js';
import { AssistantMessageContainer } from '@/containers/AssistantMessageContainer.js';
import { SlotsProvider, type SlotOverrides } from '@/theme/SlotsProvider.js';
import { RuntimeHarness } from './RuntimeHarness.js';

const { respondToNestedApproval } = vi.hoisted(() => ({
  respondToNestedApproval: vi.fn(),
}));

vi.mock('@truefoundry/assistant-ui-runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('@truefoundry/assistant-ui-runtime')>();
  return {
    ...actual,
    useTrueFoundryRespondToToolApproval: () => respondToNestedApproval,
  };
});

function renderToolCallMessage(content: ThreadMessageLike['content'], overrides?: SlotOverrides) {
  const message: ThreadMessageLike = { role: 'assistant', content };
  return render(
    <SlotsProvider overrides={overrides}>
      <RuntimeHarness messages={[message]}>
        <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
      </RuntimeHarness>
    </SlotsProvider>,
  );
}

function createToolCallCardProbe() {
  return vi.fn(({ toolName }: ToolCallCardProps) => <div>{toolName}</div>);
}

function createSandboxToolCallCardProbe() {
  return vi.fn(({ name }: SandboxToolCallCardProps) => <div>{name}</div>);
}

function createAskUserPromptProbe() {
  return vi.fn(({ answeredQuestions }: AskUserPromptProps) => (
    <div>{answeredQuestions?.map(question => question.answer).join('|')}</div>
  ));
}

function createSubAgentCardProbe() {
  return vi.fn(({ agentName, children }: SubAgentCardProps) => (
    <section>
      <div>{agentName}</div>
      {children}
    </section>
  ));
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

  it('routes sandbox calls with parsed command and result details', () => {
    const SandboxToolCallCard = createSandboxToolCallCardProbe();
    const args = {
      command: 'pnpm test',
      intent: 'Run focused tests',
    };
    const result = {
      response: {
        exitCode: 0,
        result: 'Tests passed',
      },
    };

    renderToolCallMessage(
      [
        {
          type: 'tool-call',
          toolCallId: 'sandbox-1',
          toolName: 'sandbox_exec',
          args: {},
          argsText: JSON.stringify(args),
          result,
        },
      ],
      { SandboxToolCallCard },
    );

    expect(SandboxToolCallCard.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        name: 'sandbox_exec',
        intent: 'Run focused tests',
        status: 'success',
        command: 'pnpm test',
        exitCode: 0,
        argsJson: JSON.stringify(args, null, 2),
        resultText: 'Tests passed',
        resultJson: JSON.stringify(result, null, 2),
      }),
    );
  });

  it('replays a completed ask-user call with a custom answer', () => {
    const AskUserPrompt = createAskUserPromptProbe();

    renderToolCallMessage(
      [
        {
          type: 'tool-call',
          toolCallId: 'question-1',
          toolName: 'ask_user_question',
          args: {},
          argsText: JSON.stringify({
            question: 'Choose a report format',
            options: ['Summary', 'Full report'],
          }),
          result: { content: 'Annotated report' },
        },
      ],
      { AskUserPrompt },
    );

    expect(AskUserPrompt.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        questions: [],
        answeredQuestions: [
          {
            id: 'question-1',
            question: 'Choose a report format',
            options: ['Summary', 'Full report'],
            answer: 'Annotated report',
            isCustom: true,
          },
        ],
        readOnly: true,
      }),
    );
  });

  it('routes sub-agent metadata and renders its nested assistant content', () => {
    const SubAgentCard = createSubAgentCardProbe();
    const nestedMessage: ThreadMessage = {
      id: 'nested-message-1',
      role: 'assistant',
      createdAt: new Date('2026-07-01T00:00:00Z'),
      content: [{ type: 'text', text: 'Nested agent response' }],
      status: { type: 'complete', reason: 'stop' },
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {
          subAgent: {
            title: 'Research specialist',
            input: 'Find primary sources',
          },
        },
      },
    };

    renderToolCallMessage(
      [
        {
          type: 'tool-call',
          toolCallId: 'sub-agent-1',
          toolName: 'create_sub_agent',
          args: {},
          messages: [nestedMessage],
        },
      ],
      { SubAgentCard },
    );

    expect(SubAgentCard.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        agentName: 'Research specialist',
        instruction: 'Find primary sources',
        stepCount: 1,
        status: 'success',
      }),
    );
    expect(screen.getByText('Nested agent response')).toBeInTheDocument();
  });

  it('routes Allow inside a sub-agent to the nested tool approval id', () => {
    respondToNestedApproval.mockClear();
    const SubAgentCard = createSubAgentCardProbe();
    const nestedMessage: ThreadMessage = {
      id: 'nested-message-1',
      role: 'assistant',
      createdAt: new Date('2026-07-01T00:00:00Z'),
      content: [
        {
          type: 'tool-call',
          toolCallId: 'nested-tool-1',
          toolName: 'delete_file',
          args: {},
          argsText: '{}',
          interrupt: { type: 'human', payload: {} },
          approval: { id: 'nested-approval-1', approved: undefined },
        },
      ],
      status: { type: 'requires-action', reason: 'tool-calls' },
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {
          subAgent: {
            title: 'Research specialist',
            input: 'Clean up temp files',
          },
        },
      },
    };

    render(
      <SlotsProvider overrides={{ SubAgentCard }}>
        <RuntimeHarness
          messages={[
            {
              role: 'assistant',
              status: { type: 'requires-action', reason: 'tool-calls' },
              content: [
                {
                  type: 'tool-call',
                  toolCallId: 'sub-agent-1',
                  toolName: 'create_sub_agent',
                  args: {},
                  // Parent create_sub_agent has no approval — only the nested tool does.
                  messages: [nestedMessage],
                },
              ],
            },
          ]}
        >
          <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
        </RuntimeHarness>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(respondToNestedApproval).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'nested-approval-1', approved: true }),
    );
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

  it('shows the approval bar for a pending sandbox call', () => {
    renderPendingApprovalMessage([
      {
        type: 'tool-call',
        toolCallId: 'sandbox-1',
        toolName: 'sandbox_exec',
        args: {},
        argsText: '{"command":"rm -rf output"}',
        interrupt: { type: 'human', payload: {} },
        approval: { id: 'sandbox-approval', approved: undefined },
      },
    ]);

    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('shows the approval bar for a pending list_tools call', () => {
    renderPendingApprovalMessage([
      {
        type: 'tool-call',
        toolCallId: 'list-tools-1',
        toolName: 'list_tools',
        args: {},
        argsText: '{"mcp_server":"github-team"}',
        interrupt: { type: 'human', payload: {} },
        approval: { id: 'list-tools-approval', approved: undefined },
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

  it.each([
    ['list_tools', '{"mcp_server":"github-team"}', 'github-team'],
    ['call_tool', '{"mcp_server":"slack-workspace","tool_name":"send_message","input":{}}', 'slack-workspace'],
    ['get_tool_info', '{"mcp_server":"linear-integration","tool_name":"create_issue"}', 'linear-integration'],
  ])('passes mcpServerName for %s', (toolName, argsText, mcpServerName) => {
    const ToolCallCard = createToolCallCardProbe();
    renderToolCallMessage(
      [
        {
          type: 'tool-call',
          toolCallId: '1',
          toolName,
          args: {},
          argsText,
        },
      ],
      { ToolCallCard },
    );

    expect(ToolCallCard.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ mcpServerName }));
  });

  it('does not pass mcpServerName for non-MCP tools', () => {
    const ToolCallCard = createToolCallCardProbe();
    renderToolCallMessage(
      [
        {
          type: 'tool-call',
          toolCallId: '1',
          toolName: 'search_docs',
          args: {},
          argsText: '{"query":"example"}',
        },
      ],
      { ToolCallCard },
    );

    expect(ToolCallCard).toHaveBeenCalledOnce();
    const [call] = ToolCallCard.mock.calls;
    if (!call) throw new Error('Expected ToolCallCard to render');
    expect(call[0].mcpServerName).toBeUndefined();
  });
});
