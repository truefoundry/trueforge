// @vitest-environment jsdom
import { ThreadPrimitive, type ThreadMessageLike } from '@assistant-ui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssistantMessageContainer } from '@/containers/AssistantMessageContainer.js';
import { RuntimeHarness } from './RuntimeHarness.js';

function renderAssistant(message: ThreadMessageLike) {
  return render(
    <RuntimeHarness messages={[message]}>
      <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
    </RuntimeHarness>,
  );
}

describe('parallel tool call grouping', () => {
  it('wraps a same-step batch under N tool calls in parallel', () => {
    renderAssistant({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: '1',
          toolName: 'list_teams_for_user',
          args: {},
          result: 'ok',
        },
        {
          type: 'tool-call',
          toolCallId: '2',
          toolName: 'get_manifest_json_schema',
          args: {},
          result: 'ok',
        },
        {
          type: 'tool-call',
          toolCallId: '3',
          toolName: 'check_user_registration',
          args: {},
          result: 'ok',
        },
        {
          type: 'tool-call',
          toolCallId: '4',
          toolName: 'validate_manifest',
          args: {},
          result: 'ok',
        },
      ],
      metadata: {
        custom: {
          parallelToolGroups: {
            '1': 'm-batch',
            '2': 'm-batch',
            '3': 'm-batch',
            '4': 'm-later',
          },
        },
      },
    });

    expect(screen.getByText('3 tool calls in parallel')).toBeInTheDocument();
    expect(screen.getByText('list_teams_for_user')).toBeInTheDocument();
    expect(screen.getByText('get_manifest_json_schema')).toBeInTheDocument();
    expect(screen.getByText('check_user_registration')).toBeInTheDocument();
    expect(screen.getByText('validate_manifest')).toBeInTheDocument();
    expect(screen.queryByText('1 tool calls in parallel')).not.toBeInTheDocument();
  });

  it('does not wrap a single tool call from a model step', () => {
    renderAssistant({
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: '1', toolName: 'solo_tool', args: {}, result: 'ok' }],
      metadata: { custom: { parallelToolGroups: { '1': 'm1' } } },
    });

    expect(screen.getByText('solo_tool')).toBeInTheDocument();
    expect(screen.queryByText(/tool calls in parallel/)).not.toBeInTheDocument();
  });

  it('keeps create_sub_agent outside the parallel group header', () => {
    renderAssistant({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: '1',
          toolName: 'list_teams_for_user',
          args: {},
          result: 'ok',
        },
        {
          type: 'tool-call',
          toolCallId: '2',
          toolName: 'get_manifest_json_schema',
          args: {},
          result: 'ok',
        },
        {
          type: 'tool-call',
          toolCallId: 'spawn',
          toolName: 'create_sub_agent',
          args: {},
          argsText: '{}',
          result: 'ok',
          artifact: {
            subAgents: [
              { threadId: 'child-1', title: 'timed-agent-1', agentInfo: { name: 'timed-agent-1', input: 'go' } },
            ],
          },
        },
      ],
      metadata: {
        custom: {
          parallelToolGroups: {
            '1': 'm1',
            '2': 'm1',
            spawn: 'm1',
          },
        },
      },
    });

    expect(screen.getByText('2 tool calls in parallel')).toBeInTheDocument();
    expect(screen.getByText(/Sub-agent: timed-agent-1/)).toBeInTheDocument();
  });

  it('renders a flat list when parallelToolGroups metadata is missing', () => {
    renderAssistant({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: '1', toolName: 'first_tool', args: {}, result: 'a' },
        { type: 'tool-call', toolCallId: '2', toolName: 'second_tool', args: {}, result: 'b' },
      ],
    });

    expect(screen.queryByText(/tool calls in parallel/)).not.toBeInTheDocument();
    expect(screen.getByText('first_tool')).toBeInTheDocument();
    expect(screen.getByText('second_tool')).toBeInTheDocument();
  });
});
