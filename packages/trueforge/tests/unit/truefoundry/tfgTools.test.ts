import { HTTPException } from 'hono/http-exception';
import {
  ASK_USER_SECRET_TOOL_NAME,
  AskUserSecret,
  assertTfgToolsHeaderAllowed,
  parseTfgTools,
  X_TFG_TOOLS,
} from '../../../src/truefoundry/tfgTools';

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
  it('parses ask_user_secret and drops a repeated name', () => {
    expect(parseTfgTools(JSON.stringify(['ask_user_secret', 'ask_user_secret']))).toEqual(['ask_user_secret']);
  });

  it('accepts an empty list', () => {
    expect(parseTfgTools('[]')).toEqual([]);
  });

  it.each([
    ['not json', 'not-json', `${X_TFG_TOOLS} must be a JSON array`],
    ['an object', '{}', `${X_TFG_TOOLS} must be a JSON array of tool names`],
    ['a non-string entry', '[1]', `${X_TFG_TOOLS} entries must be tool names`],
    ['an unknown tool', '["nope"]', `${X_TFG_TOOLS} entry "nope" is not a supported tool`],
  ])('rejects %s', (_case, raw, message) => {
    expect(() => parseTfgTools(raw)).toThrow(expect.objectContaining({ message }));
  });

  it('keeps a bad JSON parse as the cause', () => {
    expect(() => parseTfgTools('not-json')).toThrow(expect.objectContaining({ cause: expect.any(SyntaxError) }));
  });

  it('rejects with HTTPException', () => {
    expect(() => parseTfgTools('{}')).toThrow(HTTPException);
  });
});

describe('AskUserSecret', () => {
  const tool = new AskUserSecret();

  it('advertises ask_user_secret as a client-side system tool', async () => {
    const listed = await tool.listTools();
    if (!('result' in listed)) {
      throw new Error('expected a tool list');
    }
    expect(listed.result.tools.map(entry => entry.name)).toEqual([ASK_USER_SECRET_TOOL_NAME]);
    expect(listed.result.tools[0]?.description).toContain('tfy-ephemeral-secret://');
    expect(listed.result.tools[0]?.description).toContain('apply_manifest');

    const response = await tool.callTool({ name: ASK_USER_SECRET_TOOL_NAME, arguments: {} });
    if (!('clientSideToolRequired' in response)) {
      throw new Error('expected a client-side tool');
    }
    expect(response.clientSideToolRequired.tool_info).toEqual({
      type: 'truefoundry-system',
      original_tool_name: ASK_USER_SECRET_TOOL_NAME,
      mcp_server_id: 'ask-user-secret',
      mcp_server_name: 'ask-user-secret',
      is_client_side: true,
    });
  });
});
