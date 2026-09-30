import type { InternalEnrichedAssistantMessage, InternalToolCallInfo } from '../../../src/core/llm/LLMTypes';
import { executeToolCalls } from '../../../src/core/mcp/executeToolCalls';
import type { IToolSet } from '../../../src/core/mcp/IMCPServer';

const toolInfo: InternalToolCallInfo = {
  type: 'truefoundry-system',
  mcp_server_id: '',
  mcp_server_name: '',
  original_tool_name: 'slow',
};

function assistantMessage(): InternalEnrichedAssistantMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'slow', arguments: '{}' },
        tool_info: toolInfo,
      },
    ],
  };
}

function slowTool(callTool: IToolSet['callTool']): IToolSet {
  return {
    name: 'slow',
    id: 'slow',
    preload: true,
    hasPreloadedTools: true,
    listTools: () => Promise.resolve({ result: { tools: [] }, wasInitialized: undefined }),
    toolCallInfo: () => Promise.resolve(toolInfo),
    callTool,
  };
}

describe('executeToolCalls abort', () => {
  it('passes the signal through and stops waiting when an in-flight call aborts', async () => {
    const controller = new AbortController();
    let sawSignal: AbortSignal | undefined;
    const callTool: IToolSet['callTool'] = (_params, _decision, signal) =>
      new Promise((_resolve, reject) => {
        sawSignal = signal;
        signal?.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted'));
          },
          { once: true },
        );
        controller.abort();
      });

    const result = await executeToolCalls({
      assistantMessage: assistantMessage(),
      toolMapping: new Map([['slow', { toolSet: slowTool(callTool), originalToolName: 'slow' }]]),
      threadId: 'thread_1',
      approvalDecisions: new Map(),
      signal: controller.signal,
    });

    expect(sawSignal).toBe(controller.signal);
    expect(result.toolCallResults[0]?.failure).toBe(true);
    expect(result.toolCallResults[0]?.message.content).toContain('aborted');
  });
});
