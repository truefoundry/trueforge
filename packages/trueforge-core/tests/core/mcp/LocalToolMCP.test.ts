import { z } from 'zod';
import { toolResultResponse } from '../../../src/core/mcp/IMCPServer';
import { defineTool, LocalToolMCP, type ToolDefinition } from '../../../src/core/mcp/LocalToolMCP';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';

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

class ListedTools extends LocalToolMCP {
  readonly name = 'local';
  readonly displayName = 'Local';

  constructor(private readonly tools: ToolDefinition[]) {
    super({ tracing: NOOP_AGENT_TRACING });
  }

  protected getTools(): ToolDefinition[] {
    return this.tools;
  }
}

describe('LocalToolMCP listTools', () => {
  it('keeps outputSchema and annotations on the listed tool', async () => {
    const outputSchema = { type: 'object' as const, properties: { text: { type: 'string' } } };
    const annotations = { readOnlyHint: true };
    const server = new ListedTools([
      {
        name: 'echo',
        description: 'Echo',
        inputSchema: { type: 'object' },
        outputSchema,
        annotations,
        execute: () => Promise.resolve(toolResultResponse({ text: 'ok' })),
      },
    ]);

    const listed = await server.listTools();
    expect(listed.result.tools).toEqual([
      {
        name: 'echo',
        description: 'Echo',
        inputSchema: { type: 'object' },
        outputSchema,
        annotations,
        preload: true,
      },
    ]);
  });

  it('omits outputSchema and annotations when the definition has neither', async () => {
    const server = new ListedTools([
      defineTool({
        name: 'echo',
        description: 'Echo',
        schema: z.object({ message: z.string() }),
        handler: () => Promise.resolve(toolResultResponse({ text: 'ok' })),
      }),
    ]);

    const listed = await server.listTools();
    const tool = listed.result.tools[0];
    expect(tool).toBeDefined();
    expect(tool).not.toHaveProperty('outputSchema');
    expect(tool).not.toHaveProperty('annotations');
  });
});
