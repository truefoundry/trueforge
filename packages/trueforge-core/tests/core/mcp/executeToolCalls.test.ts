import type { MappedMCPTool } from '../../../src/core/mcp/convertMCPServers';
import { executeToolCalls, parseToolCallArguments } from '../../../src/core/mcp/executeToolCalls';
import { makeMockIMCPServer } from '../harnessMocks';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('parseToolCallArguments', () => {
  it('parses a JSON object', () => {
    expect(parseToolCallArguments('{"q":"hi"}')).toEqual({ ok: true, args: { q: 'hi' } });
  });

  it('treats empty arguments as an empty object', () => {
    expect(parseToolCallArguments('')).toEqual({ ok: true, args: {} });
  });

  it('reports invalid JSON with the raw input', () => {
    const raw = '{"q":';
    const result = parseToolCallArguments(raw);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected parse failure');
    }
    expect(result.rawArguments).toBe(raw);
    expect(result.parseError.length).toBeGreaterThan(0);
  });

  it('rejects non-object JSON values', () => {
    expect(parseToolCallArguments('["a"]')).toEqual({
      ok: false,
      parseError: 'Tool call arguments must be a JSON object',
      rawArguments: '["a"]',
    });
  });
});

describe('executeToolCalls invalid argument JSON', () => {
  it('returns an isError tool result that names the JSON parse failure', async () => {
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
    const result = toolCallResults[0];
    expect(result?.failure).toBe(true);

    const outer: unknown = JSON.parse(result?.message.content ?? 'null');
    expect(isPlainObject(outer)).toBe(true);
    if (!isPlainObject(outer)) {
      throw new Error('expected outer error wrapper');
    }
    const errorParts = outer['error'];
    expect(Array.isArray(errorParts)).toBe(true);
    if (!Array.isArray(errorParts)) {
      throw new Error('expected error content parts');
    }
    const firstPart = errorParts[0];
    expect(isPlainObject(firstPart)).toBe(true);
    if (!isPlainObject(firstPart) || typeof firstPart['text'] !== 'string') {
      throw new Error('expected text content part');
    }
    const inner: unknown = JSON.parse(firstPart['text']);
    expect(inner).toEqual({
      error: 'Failed to parse tool call arguments as JSON',
      parse_error: expect.any(String),
      raw_arguments: rawArgs,
    });
  });
});
