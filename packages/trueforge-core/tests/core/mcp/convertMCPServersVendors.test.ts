import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { AgentToolSchema, IToolSet, ListToolsResponse } from '../../../src/core/mcp/IMCPServer';
import { convertMCPServersToTools } from '../../../src/core/mcp/convertMCPServers';
import '../harnessMocks';
import { makeMockIMCPServer } from '../harnessMocks';

/**
 * Model-vendor compatibility check for MCP tool schemas (review ask on #1030:
 * "do a check for model vendors compatibility").
 *
 * The conversion output flows `convertMCPServersToTools` → `convertTools()`
 * (`src/core/llm/VercelAILLM.ts`, wrapping `parameters` via the AI SDK's
 * `jsonSchema()`) → the provider package for the configured vendor. The
 * provider switch in `buildLanguageModel` supports: openai, anthropic,
 * google-gemini, moonshot, alibaba, and the OpenAI-compatible fireworks, zai,
 * together, custom and truefoundry endpoints.
 *
 * Per-package behavior for the containers this PR now carries over (verified
 * against the pinned `@ai-sdk/*` sources in this repo's lockfile):
 * - `@ai-sdk/anthropic` explicitly preserves BOTH `$defs` and legacy
 *   `definitions`, recursively, into the tool `input_schema`.
 * - `@ai-sdk/google`'s `sanitizeResponseJsonSchema` spreads unknown keywords
 *   through (`...result`) and handles `$defs` explicitly, so `$ref`,
 *   `definitions` and `$defs` all reach `functionDeclarations` unstripped.
 * - `@ai-sdk/openai` (chat + responses) and `@ai-sdk/openai-compatible`
 *   (fireworks, zai, together, custom, truefoundry, moonshot, alibaba) ship
 *   the tool `parameters` JSON Schema essentially verbatim; `$defs`/`$ref` is
 *   part of the OpenAI tool-calling schema dialect.
 *
 * What this converter itself must therefore guarantee for every vendor is:
 * (1) the top-level `parameters` object stays on the vendor-accepted surface
 * (`type`/`properties`/`required` plus the two container spellings and
 * nothing else), and (2) every local `$ref` resolves inside the emitted
 * schema document, whichever container spelling the server used. The tests
 * below pin exactly that.
 */

/** Schema shape emitted by the official MCP Python SDK (FastMCP). */
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

/** Draft-04 spelling, still produced by older schema generators. */
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

/** Top-level keywords every supported vendor accepts on a function tool. */
const VENDOR_ACCEPTED_PARAMETER_KEYS = new Set(['type', 'properties', 'required', '$defs', 'definitions']);

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

/** Narrow `ChatCompletionTool` to the function variant and return its `parameters`. */
function firstFunctionParameters(tool: ChatCompletionTool | undefined): Record<string, unknown> | undefined {
  if (tool === undefined) {
    return undefined;
  }
  if (tool.type !== 'function') {
    throw new Error('Expected converted tool to be a function tool');
  }
  return tool.function.parameters;
}

/** Collect every local `$ref` that cannot be resolved by walking JSON pointers from the root. */
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

async function convertSingleTool(inputSchema: AgentToolSchema['inputSchema']) {
  const tools: AgentToolSchema[] = [
    {
      name: 'vendor_tool',
      description: 'Vendor compatibility probe',
      inputSchema,
      preload: true,
    },
  ];
  const { convertedTools } = await convertMCPServersToTools({
    tfyManagedServers: [],
    userServers: [makeServer('vendor-server', tools)],
  });
  expect(convertedTools.tools).toHaveLength(1);
  return firstFunctionParameters(convertedTools.tools[0]);
}

describe('convertMCPServersToTools model-vendor compatibility', () => {
  it.each([
    ['FastMCP-style $defs', FASTMCP_STYLE_INPUT_SCHEMA],
    ['draft-04 definitions', DRAFT04_DEFINITIONS_INPUT_SCHEMA],
  ])('keeps the emitted parameters on the vendor-accepted surface (%s)', async (_label, inputSchema) => {
    const parameters = await convertSingleTool(inputSchema);
    expect(parameters).toBeDefined();
    // Nothing beyond the vendor-accepted top-level keywords may leak: a
    // stray key is exactly the kind of surface change that breaks one
    // provider's schema validation while passing another's.
    expect(Object.keys(parameters ?? {}).every(key => VENDOR_ACCEPTED_PARAMETER_KEYS.has(key))).toBe(true);
    // The minimal function-tool surface every vendor requires.
    expect(parameters?.['type']).toBe('object');
    expect(Array.isArray(parameters?.['required'])).toBe(true);
  });

  it.each([
    ['FastMCP-style $defs', FASTMCP_STYLE_INPUT_SCHEMA],
    ['draft-04 definitions', DRAFT04_DEFINITIONS_INPUT_SCHEMA],
  ])('resolves every local $ref inside the emitted schema document (%s)', async (_label, inputSchema) => {
    const parameters = await convertSingleTool(inputSchema);
    // A dangling local ref fails provider-side schema validation on every
    // vendor; carrying the container over is what keeps this list empty.
    expect(collectUnresolvableRefs(parameters)).toEqual([]);
  });

  it('emits container-less schemas byte-identically, so vendor behavior for them is unchanged', async () => {
    const parameters = await convertSingleTool({ type: 'object', properties: {} });
    expect(parameters).toEqual({ type: 'object', properties: {}, required: [] });
  });
});
