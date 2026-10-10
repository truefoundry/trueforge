import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { AgentToolSchema, IToolSet, ListToolsResponse } from '../../../src/core/mcp/IMCPServer';
import { convertMCPServersToTools } from '../../../src/core/mcp/convertMCPServers';
import '../harnessMocks';
import { makeMockIMCPServer } from '../harnessMocks';

/**
 * Schema shape emitted by the official MCP Python SDK (FastMCP): every nested
 * pydantic model is hoisted to the top-level `$defs` container and referenced
 * with `#/$defs/<Model>` JSON pointers.
 */
const FASTMCP_STYLE_INPUT_SCHEMA = {
  type: 'object' as const,
  title: 'create_contactArguments',
  properties: {
    name: { title: 'Name', type: 'string' },
    address: { $ref: '#/$defs/Address' },
  },
  required: ['name', 'address'],
  $defs: {
    Address: {
      properties: {
        street: { title: 'Street', type: 'string' },
        city: { title: 'City', type: 'string' },
      },
      required: ['street', 'city'],
      type: 'object',
      title: 'Address',
    },
  },
};

/** Draft-04 spelling of the same container, still produced by older generators. */
const DRAFT04_DEFINITIONS_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    address: { $ref: '#/definitions/Address' },
  },
  required: ['address'],
  definitions: {
    Address: {
      type: 'object',
      properties: {
        city: { type: 'string' },
      },
      required: ['city'],
    },
  },
};

function makeServer(name: string, tools: AgentToolSchema[]): IToolSet {
  const base = makeMockIMCPServer({ name, preload: true, tools });
  return {
    ...base,
    listTools: jest.fn((): Promise<ListToolsResponse> =>
      Promise.resolve({
        result: { tools },
        wasInitialized: undefined,
      }),
    ),
  };
}

/** `ChatCompletionTool` is a union; narrow to the function variant and return its `parameters`. */
function firstFunctionParameters(tool: ChatCompletionTool | undefined): Record<string, unknown> | undefined {
  if (tool === undefined) {
    return undefined;
  }
  if (tool.type !== 'function') {
    throw new Error('Expected converted tool to be a function tool');
  }
  return tool.function.parameters;
}

/**
 * Collect every local `$ref` in the schema that cannot be resolved by walking
 * JSON-pointer segments from the root, so dangling refs are reported precisely.
 */
function collectUnresolvableRefs(root: unknown, node: unknown = root): string[] {
  const dangling: string[] = [];
  if (Array.isArray(node)) {
    for (const item of node) {
      dangling.push(...collectUnresolvableRefs(root, item));
    }
    return dangling;
  }
  if (node === null || typeof node !== 'object') {
    return dangling;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/')) {
      let cursor: unknown = root;
      let resolved = true;
      for (const rawSegment of value.slice(2).split('/')) {
        const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
        if (cursor !== null && typeof cursor === 'object' && segment in (cursor as Record<string, unknown>)) {
          cursor = (cursor as Record<string, unknown>)[segment];
        } else {
          resolved = false;
          break;
        }
      }
      if (!resolved) {
        dangling.push(value);
      }
    } else {
      dangling.push(...collectUnresolvableRefs(root, value));
    }
  }
  return dangling;
}

describe('convertMCPServersToTools JSON Schema containers', () => {
  it('preserves FastMCP-style top-level $defs so every $ref resolves after conversion', async () => {
    const tools: AgentToolSchema[] = [
      {
        name: 'create_contact',
        description: 'Create a contact',
        inputSchema: FASTMCP_STYLE_INPUT_SCHEMA,
        preload: true,
      },
    ];
    const { convertedTools } = await convertMCPServersToTools({
      tfyManagedServers: [],
      userServers: [makeServer('fastmcp-server', tools)],
    });

    expect(convertedTools.tools).toHaveLength(1);
    const parameters = firstFunctionParameters(convertedTools.tools[0]);
    expect(parameters).toBeDefined();
    // The $defs container must survive the conversion…
    expect(parameters?.['$defs']).toEqual(FASTMCP_STYLE_INPUT_SCHEMA.$defs);
    // …so that every local $ref in the emitted schema resolves against it.
    expect(collectUnresolvableRefs(parameters)).toEqual([]);
  });

  it('preserves the draft-04 definitions container for legacy schemas', async () => {
    const tools: AgentToolSchema[] = [
      {
        name: 'legacy_tool',
        description: 'Legacy schema tool',
        inputSchema: DRAFT04_DEFINITIONS_INPUT_SCHEMA,
        preload: true,
      },
    ];
    const { convertedTools } = await convertMCPServersToTools({
      tfyManagedServers: [],
      userServers: [makeServer('legacy-server', tools)],
    });

    const parameters = firstFunctionParameters(convertedTools.tools[0]);
    expect(parameters?.['definitions']).toEqual(DRAFT04_DEFINITIONS_INPUT_SCHEMA.definitions);
    expect(collectUnresolvableRefs(parameters)).toEqual([]);
  });

  it('does not introduce $defs or definitions for schemas without them', async () => {
    const tools: AgentToolSchema[] = [
      {
        name: 'plain_tool',
        description: 'Plain tool',
        inputSchema: { type: 'object', properties: {} },
        preload: true,
      },
    ];
    const { convertedTools } = await convertMCPServersToTools({
      tfyManagedServers: [],
      userServers: [makeServer('plain-server', tools)],
    });

    expect(convertedTools.tools).toHaveLength(1);
    const parameters = firstFunctionParameters(convertedTools.tools[0]);
    expect(parameters).toEqual({ type: 'object', properties: {}, required: [] });
    expect(Object.keys(parameters ?? {})).not.toContain('$defs');
    expect(Object.keys(parameters ?? {})).not.toContain('definitions');
  });
});
