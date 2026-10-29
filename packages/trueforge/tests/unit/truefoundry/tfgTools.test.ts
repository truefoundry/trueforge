import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import {
  assertTfgToolsHeaderAllowed,
  capabilitiesStoreFromHeader,
  parseTfgTools,
  tfgToolsCapability,
  X_TFG_TOOLS,
} from '../../../src/truefoundry/inlineTools';

const askUserSecret = {
  name: 'ask_user_secret',
  description: 'Collect a secret and return a tfy-ephemeral-secret:// placeholder for apply_manifest.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      fields: { type: 'array' },
    },
    required: ['question', 'fields'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      secret: { type: 'string' },
    },
  },
  annotations: { readOnlyHint: true },
};

describe('assertTfgToolsHeaderAllowed', () => {
  it('rejects the header outside TrueFoundry mode', () => {
    expect(() => assertTfgToolsHeaderAllowed({ isTrueFoundryMode: false })).toThrow(
      expect.objectContaining({ message: `${X_TFG_TOOLS} requires TrueFoundry mode` }),
    );
  });

  it('allows the header in TrueFoundry mode', () => {
    expect(() => assertTfgToolsHeaderAllowed({ isTrueFoundryMode: true })).not.toThrow();
  });
});

describe('parseTfgTools', () => {
  it('parses a tool definition and keeps outputSchema and extra inputSchema keys', () => {
    expect(parseTfgTools(JSON.stringify([askUserSecret]))).toEqual([askUserSecret]);
  });

  it('accepts a tool with only a name and inputSchema', () => {
    const tool = { name: 'ask_user_secret', inputSchema: { type: 'object' } };
    expect(parseTfgTools(JSON.stringify([tool]))).toEqual([tool]);
  });

  it('accepts a name that matches a harness tool', () => {
    const tool = { ...askUserSecret, name: 'ask_user_question' };
    expect(parseTfgTools(JSON.stringify([tool]))).toEqual([tool]);
  });

  it('accepts an empty list', () => {
    expect(parseTfgTools('[]')).toEqual([]);
  });

  it.each([
    ['not json', 'not-json', `${X_TFG_TOOLS} must be a JSON array`],
    ['an object', '{}', `${X_TFG_TOOLS} must be a JSON array of tool definitions`],
    ['a string entry', '["ask_user_secret"]', `${X_TFG_TOOLS}[0]`],
    [
      'parameters instead of inputSchema',
      JSON.stringify([{ name: 'ask_user_secret', description: 'Collect a secret.', parameters: { type: 'object' } }]),
      `${X_TFG_TOOLS}[0].inputSchema`,
    ],
    [
      'a duplicate name',
      JSON.stringify([askUserSecret, askUserSecret]),
      `${X_TFG_TOOLS}[1] name "ask_user_secret" is listed more than once`,
    ],
    [
      'too many tools',
      JSON.stringify(Array.from({ length: 17 }, (_, index) => ({ ...askUserSecret, name: `tool_${String(index)}` }))),
      `${X_TFG_TOOLS} lists more than 16 tools`,
    ],
  ])('rejects %s', (_case, raw, message) => {
    expect(() => parseTfgTools(raw)).toThrow(expect.objectContaining({ message: expect.stringContaining(message) }));
  });

  it('rejects a header that is too large', () => {
    expect(() => parseTfgTools('x'.repeat(16_001))).toThrow(
      expect.objectContaining({ message: `${X_TFG_TOOLS} is too large` }),
    );
  });

  it('keeps a bad JSON parse as the cause', () => {
    expect(() => parseTfgTools('not-json')).toThrow(expect.objectContaining({ cause: expect.any(SyntaxError) }));
  });

  it('keeps a schema failure as the cause', () => {
    expect(() => parseTfgTools('["ask_user_secret"]')).toThrow(
      expect.objectContaining({ cause: expect.any(ZodError) }),
    );
  });

  it('rejects with HTTPException', () => {
    expect(() => parseTfgTools('{}')).toThrow(HTTPException);
  });
});

describe('tfgToolsCapability', () => {
  it('advertises the header tool as a client-side system tool', async () => {
    const [toolSet] = tfgToolsCapability(parseTfgTools(JSON.stringify([askUserSecret]))).systemToolSets ?? [];
    if (toolSet === undefined) {
      throw new Error('expected a tool set');
    }
    const listed = await toolSet.listTools();
    if (!('result' in listed)) {
      throw new Error('expected a tool list');
    }
    expect(listed.result.tools.map(entry => entry.name)).toEqual(['ask_user_secret']);
    expect(listed.result.tools[0]?.description).toContain('tfy-ephemeral-secret://');
    expect(listed.result.tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      required: ['question', 'fields'],
      additionalProperties: false,
    });
    expect(listed.result.tools[0]?.outputSchema).toEqual(askUserSecret.outputSchema);
    expect(listed.result.tools[0]?.annotations).toEqual({ readOnlyHint: true });

    const response = await toolSet.callTool({ name: 'ask_user_secret', arguments: {} });
    if (!('clientSideToolRequired' in response)) {
      throw new Error('expected a client-side tool');
    }
    expect(response.clientSideToolRequired.tool_info).toEqual({
      type: 'truefoundry-system',
      original_tool_name: 'ask_user_secret',
      mcp_server_id: 'x-tfg-tools',
      mcp_server_name: 'x-tfg-tools',
      is_client_side: true,
    });
  });
});

describe('capabilitiesStoreFromHeader', () => {
  it('mounts nothing when the header is absent', () => {
    const store = capabilitiesStoreFromHeader({ header: undefined, isTrueFoundryMode: false });
    expect(store.resolveCapabilities()).toEqual([]);
  });

  it('mounts nothing for an empty list', () => {
    const store = capabilitiesStoreFromHeader({ header: '[]', isTrueFoundryMode: true });
    expect(store.resolveCapabilities()).toEqual([]);
  });

  it('rejects the header outside TrueFoundry mode before parsing', () => {
    expect(() => capabilitiesStoreFromHeader({ header: 'not-json', isTrueFoundryMode: false })).toThrow(
      expect.objectContaining({ message: `${X_TFG_TOOLS} requires TrueFoundry mode` }),
    );
  });

  it('returns a fresh tool set on every resolve', () => {
    const store = capabilitiesStoreFromHeader({
      header: JSON.stringify([askUserSecret]),
      isTrueFoundryMode: true,
    });
    const first = store.resolveCapabilities();
    const second = store.resolveCapabilities();
    expect(first[0]?.systemToolSets?.[0]?.name).toBe(X_TFG_TOOLS);
    expect(second[0]?.systemToolSets?.[0]?.name).toBe(X_TFG_TOOLS);
    expect(first[0]?.systemToolSets?.[0]).not.toBe(second[0]?.systemToolSets?.[0]);
  });
});
