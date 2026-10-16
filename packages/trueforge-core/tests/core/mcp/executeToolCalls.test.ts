import type { MappedMCPTool } from '../../../src/core/mcp/convertMCPServers';
import { executeToolCalls } from '../../../src/core/mcp/executeToolCalls';
import { makeMockIMCPServer } from '../harnessMocks';

describe('executeToolCalls', () => {
  it('reports invalid tool-arg JSON as a parse failure without calling the tool', async () => {
    const toolSet = makeMockIMCPServer({ name: 'srv', preload: true });
    const toolMapping = new Map<string, MappedMCPTool>([['search', { toolSet, originalToolName: 'search' }]]);
    const rawArgs = '{"q":';

    const { toolCallResults } = await executeToolCalls({
      assistantMessage: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search', arguments: rawArgs },
            tool_info: {
              type: 'mcp',
              mcp_server_id: 'srv',
              mcp_server_name: 'srv',
              original_tool_name: 'search',
            },
          },
        ],
      },
      toolMapping,
      threadId: 'thread-1',
      approvalDecisions: new Map(),
    });

    expect(toolSet.callTool).not.toHaveBeenCalled();
    expect(toolCallResults).toHaveLength(1);
    expect(toolCallResults[0]?.failure).toBe(true);
    expect(toolCallResults[0]?.message.content).toContain('Failed to parse tool call arguments as JSON');
    expect(toolCallResults[0]?.message.content).not.toContain('raw_arguments');
  });
});
