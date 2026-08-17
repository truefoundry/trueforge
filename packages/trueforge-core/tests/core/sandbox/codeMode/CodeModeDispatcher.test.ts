import { McpConnectionError } from '../../../../src/core/errors';
import type { CallToolResponse, IToolSet, ListToolsResponse } from '../../../../src/core/mcp/IMCPServer';
import { CodeModeDispatcher } from '../../../../src/core/sandbox/codeMode/CodeModeDispatcher';
import { makeMockIMCPServer, makeSilentLogger, OBJECT_INPUT_SCHEMA } from '../../harnessMocks';

function makeDispatcher(toolSets: readonly IToolSet[]): CodeModeDispatcher {
  return new CodeModeDispatcher({ toolSets, logger: makeSilentLogger() });
}

describe('CodeModeDispatcher', () => {
  it('list_tools returns the tool list', async () => {
    const server = makeMockIMCPServer({ name: 'github', preload: true });
    const dispatcher = makeDispatcher([server]);

    const reply = await dispatcher.dispatch({
      request: { op: 'list_tools', server: 'github' },
      traceCarrier: {},
    });

    expect(reply).toEqual({
      ok: true,
      result: {
        tools: [{ name: 'tool_a', description: 'A', inputSchema: OBJECT_INPUT_SCHEMA, preload: true }],
      },
    });
  });

  it('call_tool returns the tool result', async () => {
    const server = makeMockIMCPServer({ name: 'github', preload: true });
    jest.mocked(server.callTool).mockResolvedValue({
      result: { content: [{ type: 'text', text: 'ok' }], isError: false },
      wasInitialized: undefined,
    } satisfies CallToolResponse);

    const dispatcher = makeDispatcher([server]);
    const reply = await dispatcher.dispatch({
      request: { op: 'call_tool', server: 'github', tool: 'tool_a', arguments: { x: 1 } },
      traceCarrier: {},
    });

    expect(reply).toEqual({
      ok: true,
      result: { content: [{ type: 'text', text: 'ok' }], isError: false },
    });
    expect(server.callTool).toHaveBeenCalledWith({ name: 'tool_a', arguments: { x: 1 } });
  });

  it('unknown server is caller fault', async () => {
    const dispatcher = makeDispatcher([makeMockIMCPServer({ name: 'github', preload: true })]);

    const reply = await dispatcher.dispatch({
      request: { op: 'list_tools', server: 'missing' },
      traceCarrier: {},
    });

    expect(reply.ok).toBe(false);
    if (reply.ok) throw new Error('unreachable');
    expect(reply.source).toBe('caller');
    expect(reply.error).toContain('missing');
  });

  it('OAuth list_tools is caller fault', async () => {
    const server = makeMockIMCPServer({ name: 'github', preload: true });
    jest.mocked(server.listTools).mockResolvedValue({
      authRequired: { servers: [{ id: 'github', name: 'github', auth_url: 'https://example.com/oauth' }] },
    } satisfies ListToolsResponse);

    const dispatcher = makeDispatcher([server]);
    const reply = await dispatcher.dispatch({
      request: { op: 'list_tools', server: 'github' },
      traceCarrier: {},
    });

    expect(reply.ok).toBe(false);
    if (reply.ok) throw new Error('unreachable');
    expect(reply.source).toBe('caller');
    expect(reply.error).toMatch(/OAuth/);
  });

  it('sub-agent tool is caller fault', async () => {
    const server = makeMockIMCPServer({ name: 'github', preload: true });
    jest.mocked(server.callTool).mockResolvedValue({
      createSubAgent: { type: 'dynamic', name: 'Sub', input: 'do work' },
    } satisfies CallToolResponse);

    const dispatcher = makeDispatcher([server]);
    const reply = await dispatcher.dispatch({
      request: { op: 'call_tool', server: 'github', tool: 'spawn' },
      traceCarrier: {},
    });

    expect(reply.ok).toBe(false);
    if (reply.ok) throw new Error('unreachable');
    expect(reply.source).toBe('caller');
    expect(reply.error).toMatch(/sub-agent/);
  });

  it('4xx McpConnectionError is caller fault', async () => {
    const server = makeMockIMCPServer({ name: 'github', preload: true });
    jest.mocked(server.callTool).mockRejectedValue(new McpConnectionError('bad request', 400));

    const dispatcher = makeDispatcher([server]);
    const reply = await dispatcher.dispatch({
      request: { op: 'call_tool', server: 'github', tool: 'tool_a' },
      traceCarrier: {},
    });

    expect(reply.ok).toBe(false);
    if (reply.ok) throw new Error('unreachable');
    expect(reply.source).toBe('caller');
  });

  it('unexpected errors are internal fault', async () => {
    const server = makeMockIMCPServer({ name: 'github', preload: true });
    jest.mocked(server.callTool).mockRejectedValue(new Error('boom'));

    const dispatcher = makeDispatcher([server]);
    const reply = await dispatcher.dispatch({
      request: { op: 'call_tool', server: 'github', tool: 'tool_a' },
      traceCarrier: {},
    });

    expect(reply.ok).toBe(false);
    if (reply.ok) throw new Error('unreachable');
    expect(reply.source).toBe('internal');
    expect(reply.error).toBe('boom');
  });

  it('closed dispatcher returns transport source without calling tools', async () => {
    const server = makeMockIMCPServer({ name: 'github', preload: true });
    const dispatcher = makeDispatcher([server]);
    dispatcher.close();

    const reply = await dispatcher.dispatch({
      request: { op: 'list_tools', server: 'github' },
      traceCarrier: {},
    });

    expect(reply).toEqual({
      ok: false,
      error: 'Code Mode dispatcher is closed',
      source: 'transport',
    });
    expect(server.listTools).not.toHaveBeenCalled();
  });
});
