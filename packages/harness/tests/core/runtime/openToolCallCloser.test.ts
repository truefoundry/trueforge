import type { InternalEnrichedAssistantMessage, InternalEnrichedToolCall } from '../../../src/core/llm/LLMTypes';
import type { ContextMessage } from '../../../src/core/runtime/AgentThread.types';
import { getClosableOpenToolCallIds } from '../../../src/core/runtime/OpenToolCallCloser';
import '../harnessMocks';

function makeToolCall(
  id: string,
  toolInfo: Partial<InternalEnrichedToolCall['tool_info']> = {},
): InternalEnrichedToolCall {
  return {
    id,
    type: 'function',
    function: { name: 'test_tool', arguments: '{}' },
    tool_info: {
      type: 'mcp',
      mcp_server_id: 'test-server',
      mcp_server_name: 'test-server',
      original_tool_name: 'test_tool',
      is_approval_required: false,
      is_client_side: false,
      ...toolInfo,
    },
  };
}

function assistantWithToolCalls(toolCalls: InternalEnrichedToolCall[]): ContextMessage[] {
  const assistant: InternalEnrichedAssistantMessage = {
    role: 'assistant',
    content: '',
    tool_calls: toolCalls,
  };
  return [assistant];
}

describe('getClosableOpenToolCallIds', () => {
  it('closes ordinary dangling tool calls on the last assistant message', () => {
    const context = assistantWithToolCalls([makeToolCall('tc-1'), makeToolCall('tc-2')]);
    expect(getClosableOpenToolCallIds(context)).toEqual(new Set(['tc-1', 'tc-2']));
  });

  it('excludes tool calls that already have a matching tool response', () => {
    const context: ContextMessage[] = [
      ...assistantWithToolCalls([makeToolCall('tc-1'), makeToolCall('tc-2')]),
      { role: 'tool', tool_call_id: 'tc-1', content: 'done' },
    ];
    expect(getClosableOpenToolCallIds(context)).toEqual(new Set(['tc-2']));
  });

  it('returns empty when any open call requires approval', () => {
    const context = assistantWithToolCalls([
      makeToolCall('tc-ordinary'),
      makeToolCall('tc-approval', { is_approval_required: true }),
    ]);
    expect(getClosableOpenToolCallIds(context)).toEqual(new Set());
  });

  it('returns empty when any open call is client-side', () => {
    const context = assistantWithToolCalls([
      makeToolCall('tc-ordinary'),
      makeToolCall('tc-client', { is_client_side: true }),
    ]);
    expect(getClosableOpenToolCallIds(context)).toEqual(new Set());
  });

  it('excludes thread-creation tool calls (is_thread_creation)', () => {
    const context = assistantWithToolCalls([
      makeToolCall('tc-regular'),
      makeToolCall('tc-sub-agent', { is_thread_creation: true }),
    ]);
    expect(getClosableOpenToolCallIds(context)).toEqual(new Set(['tc-regular']));
  });

  it('treats legacy sub-agent calls without is_thread_creation as ordinary closable calls', () => {
    const context = assistantWithToolCalls([
      makeToolCall('tc-legacy-sub-agent', {
        mcp_server_id: 'legacy-sub-agents',
        mcp_server_name: 'legacy-sub-agents',
        original_tool_name: 'create_sub_agent',
      }),
    ]);
    expect(getClosableOpenToolCallIds(context)).toEqual(new Set(['tc-legacy-sub-agent']));
  });

  it('only inspects tool calls on the last assistant message', () => {
    const context: ContextMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [makeToolCall('old-tc')],
      },
      { role: 'tool', tool_call_id: 'old-tc', content: 'resolved' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [makeToolCall('new-tc')],
      },
    ];
    expect(getClosableOpenToolCallIds(context)).toEqual(new Set(['new-tc']));
  });

  it('returns empty when there is no assistant message with tool calls', () => {
    expect(getClosableOpenToolCallIds([{ role: 'user', content: 'hello' }])).toEqual(new Set());
  });
});
