import type { InternalEnrichedAssistantMessage, InternalEnrichedToolCall } from '../../../src/core/llm/LLMTypes';
import { executeToolCalls } from '../../../src/core/mcp/executeToolCalls';
import { toolResultResponse } from '../../../src/core/mcp/IMCPServer';
import { makeMockIMCPServer } from '../harnessMocks';

function makeToolCall(input: { id: string; name: string }): InternalEnrichedToolCall {
  return {
    id: input.id,
    type: 'function',
    function: { name: input.name, arguments: '{}' },
    tool_info: {
      type: 'mcp',
      mcp_server_id: 'test-server',
      mcp_server_name: 'test-server',
      original_tool_name: input.name,
      is_approval_required: false,
      is_client_side: false,
    },
  };
}

describe('executeToolCalls concurrency', () => {
  it('caps in-flight tool calls', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const toolSet = makeMockIMCPServer({ name: 'test-server', preload: true });
    toolSet.callTool = jest.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      return toolResultResponse({ text: 'ok' });
    });

    const names = Array.from({ length: 8 }, (_, i) => `tool_${String(i)}`);
    const toolMapping = new Map(names.map(name => [name, { toolSet, originalToolName: name }]));
    const assistantMessage: InternalEnrichedAssistantMessage = {
      role: 'assistant',
      content: '',
      tool_calls: names.map((name, i) => makeToolCall({ id: `call-${String(i)}`, name })),
    };

    const result = await executeToolCalls({
      assistantMessage,
      toolMapping,
      threadId: 'thread-1',
      approvalDecisions: new Map(),
      concurrency: 2,
    });

    expect(maxInFlight).toBe(2);
    expect(result.toolCallResults).toHaveLength(8);
    expect(result.toolCallResults.map(r => r.message.tool_call_id)).toEqual(names.map((_, i) => `call-${String(i)}`));
  });

  it('does not start queued tool calls after abort', async () => {
    const controller = new AbortController();
    let started = 0;
    let releaseInFlight: (() => void) | undefined;
    const inFlightGate = new Promise<void>(resolve => {
      releaseInFlight = resolve;
    });
    let sawSecondStart: (() => void) | undefined;
    const secondStarted = new Promise<void>(resolve => {
      sawSecondStart = resolve;
    });
    const toolSet = makeMockIMCPServer({ name: 'test-server', preload: true });
    toolSet.callTool = jest.fn(async () => {
      started += 1;
      if (started === 2) {
        controller.abort();
        sawSecondStart?.();
      }
      await inFlightGate;
      return toolResultResponse({ text: 'ok' });
    });

    const names = Array.from({ length: 6 }, (_, i) => `tool_${String(i)}`);
    const toolMapping = new Map(names.map(name => [name, { toolSet, originalToolName: name }]));
    const assistantMessage: InternalEnrichedAssistantMessage = {
      role: 'assistant',
      content: '',
      tool_calls: names.map((name, i) => makeToolCall({ id: `call-${String(i)}`, name })),
    };

    const pending = executeToolCalls({
      assistantMessage,
      toolMapping,
      threadId: 'thread-1',
      approvalDecisions: new Map(),
      concurrency: 2,
      signal: controller.signal,
    });
    await secondStarted;
    releaseInFlight?.();

    const result = await pending;
    expect(toolSet.callTool).toHaveBeenCalledTimes(2);
    expect(result.toolCallResults).toHaveLength(2);
  });
});
