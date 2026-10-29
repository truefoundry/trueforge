import { HTTPException } from 'hono/http-exception';
import {
  assertTfgToolsHeaderAllowed,
  parseTfgTools,
  tfgToolsCapability,
  X_TFG_TOOLS,
} from '../../../src/truefoundry/inlineTools';

const askUserSecret = {
  name: 'ask_user_secret',
  description: 'Collect a secret and return a tfy-ephemeral-secret:// placeholder for apply_manifest.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      fields: { type: 'array' },
    },
    required: ['question', 'fields'],
    additionalProperties: false,
  },
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
  it('parses a tool definition and keeps extra parameter keys', () => {
    expect(parseTfgTools(JSON.stringify([askUserSecret]))).toEqual([askUserSecret]);
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
    ['a string entry', '["ask_user_secret"]', `${X_TFG_TOOLS}[0] must be an object`],
    [
      'a bad name',
      JSON.stringify([{ ...askUserSecret, name: 'has space' }]),
      `${X_TFG_TOOLS}[0] name must be 1-64 characters of letters, numbers, "_" or "-"`,
    ],
    [
      'an empty description',
      JSON.stringify([{ ...askUserSecret, description: '  ' }]),
      `${X_TFG_TOOLS}[0] description must be a non-empty string`,
    ],
    [
      'parameters that are not an object schema',
      JSON.stringify([{ ...askUserSecret, parameters: { type: 'string' } }]),
      `${X_TFG_TOOLS}[0] parameters must be a JSON object schema`,
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
    expect(() => parseTfgTools(raw)).toThrow(expect.objectContaining({ message }));
  });

  it('rejects a header that is too large', () => {
    expect(() => parseTfgTools('x'.repeat(16_001))).toThrow(
      expect.objectContaining({ message: `${X_TFG_TOOLS} is too large` }),
    );
  });

  it('keeps a bad JSON parse as the cause', () => {
    expect(() => parseTfgTools('not-json')).toThrow(expect.objectContaining({ cause: expect.any(SyntaxError) }));
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
