import type { InternalEnrichedAssistantMessage } from '../../../src/core/llm/LLMTypes';
import type { MappedMCPTool } from '../../../src/core/mcp/convertMCPServers';
import { executeToolCalls } from '../../../src/core/mcp/executeToolCalls';
import type { IToolSet } from '../../../src/core/mcp/IMCPServer';
import { toolResultResponse } from '../../../src/core/mcp/IMCPServer';
import '../harnessMocks';

function makeMappedTool(callTool: IToolSet['callTool']): MappedMCPTool {
  return {
    originalToolName: 'echo',
    toolSet: { callTool } as IToolSet,
  };
}

function assistantWithCalls(ids: string[]): InternalEnrichedAssistantMessage {
  return {
    role: 'assistant',
    content: '',
    tool_calls: ids.map(id => ({
      id,
      type: 'function' as const,
      function: { name: 'echo', arguments: '{}' },
      tool_info: {
        type: 'mcp' as const,
        mcp_server_id: 's',
        mcp_server_name: 's',
        original_tool_name: 'echo',
        is_approval_required: false,
        is_client_side: false,
      },
    })),
  };
}

describe('executeToolCalls maxToolCallsPerStep', () => {
  it('throws when the assistant requests more tool calls than the limit', async () => {
    const executed: string[] = [];
    const mapping = new Map<string, MappedMCPTool>([
      [
        'echo',
        makeMappedTool(async params => {
          executed.push(params.name);
          return toolResultResponse({ text: 'ok' });
        }),
      ],
    ]);

    await expect(
      executeToolCalls({
        assistantMessage: assistantWithCalls(['c1', 'c2', 'c3']),
        toolMapping: mapping,
        threadId: 't1',
        approvalDecisions: new Map(),
        maxToolCallsPerStep: 2,
      }),
    ).rejects.toThrow(/Tool call limit of 2 per step exceeded \(3 requested\)/);

    expect(executed).toEqual([]);
  });

  it('runs when the assistant stays within the limit', async () => {
    const executed: string[] = [];
    const mapping = new Map<string, MappedMCPTool>([
      [
        'echo',
        makeMappedTool(async params => {
          executed.push(params.name);
          return toolResultResponse({ text: 'ok' });
        }),
      ],
    ]);

    const result = await executeToolCalls({
      assistantMessage: assistantWithCalls(['c1', 'c2']),
      toolMapping: mapping,
      threadId: 't1',
      approvalDecisions: new Map(),
      maxToolCallsPerStep: 2,
    });

    expect(executed).toEqual(['echo', 'echo']);
    expect(result.toolCallResults).toHaveLength(2);
  });
});
