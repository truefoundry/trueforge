import { z } from 'zod';
import { toolResultResponse } from '../../../src/core/mcp/IMCPServer';
import { defineTool } from '../../../src/core/mcp/LocalToolMCP';

describe('defineTool inputSchema', () => {
  it('omits defaulted fields from required (input-oriented JSON Schema)', () => {
    const tool = defineTool({
      name: 'call_tool',
      description: 'Call a deferred tool',
      schema: z.object({
        mcp_server: z.string(),
        tool_name: z.string(),
        input: z.record(z.string(), z.unknown()).default({}),
      }),
      handler: async () => toolResultResponse({ text: 'ok' }),
    });

    expect(tool.inputSchema.type).toBe('object');
    expect(tool.inputSchema.required).toEqual(['mcp_server', 'tool_name']);
    expect(tool.inputSchema.properties).toHaveProperty('input');
  });

  it('keeps truly required fields in required', () => {
    const tool = defineTool({
      name: 'echo',
      description: 'Echo',
      schema: z.object({
        message: z.string(),
      }),
      handler: async () => toolResultResponse({ text: 'ok' }),
    });

    expect(tool.inputSchema.required).toEqual(['message']);
  });
});
