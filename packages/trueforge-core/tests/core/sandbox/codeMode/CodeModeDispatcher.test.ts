import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { McpConnectionError } from '../../../../src/core/errors';
import type { CallToolResponse, IToolSet, ListToolsResponse } from '../../../../src/core/mcp/IMCPServer';
import { DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS, toolRequiresApproval } from '../../../../src/core/mcp/toolSelectors';
import { CodeModeDispatcher } from '../../../../src/core/sandbox/codeMode/CodeModeDispatcher';
import { makeMockIMCPServer, makeSilentLogger, OBJECT_INPUT_SCHEMA } from '../../harnessMocks';

function makeDispatcher(toolSets: readonly IToolSet[], approvalsEnabled = false): CodeModeDispatcher {
  return new CodeModeDispatcher({ toolSets, approvalsEnabled, logger: makeSilentLogger() });
}

/** A server whose only tool carries the given annotations and would otherwise return a result. */
function makeAnnotatedServer(annotations: ToolAnnotations): IToolSet {
  const server = makeMockIMCPServer({
    name: 'github',
    preload: true,
    tools: [{ name: 'wipe', description: 'W', inputSchema: OBJECT_INPUT_SCHEMA, preload: true, annotations }],
  });
  jest.mocked(server.callTool).mockResolvedValue({
    result: { content: [{ type: 'text', text: 'ran' }], isError: false },
    wasInitialized: undefined,
  } satisfies CallToolResponse);
  return server;
}

function approvalRequiredServer(): IToolSet {
  const server = makeMockIMCPServer({ name: 'github', preload: true });
  jest.mocked(server.callTool).mockResolvedValue({
    approvalRequired: {
      tool_info: {
        type: 'mcp',
        original_tool_name: 'tool_a',
        mcp_server_id: 'github',
        mcp_server_name: 'github',
        is_approval_required: true,
      },
    },
  } satisfies CallToolResponse);
  return server;
}

function expectApprovalId(reply: { ok: boolean; result?: unknown }): string {
  expect(reply.ok).toBe(true);
  const result: unknown = reply.result;
  if (
    result === null ||
    typeof result !== 'object' ||
    !('approval_pending' in result) ||
    typeof result.approval_pending !== 'object' ||
    result.approval_pending === null ||
    !('approval_id' in result.approval_pending) ||
    typeof result.approval_pending.approval_id !== 'string'
  ) {
    throw new Error(`expected an approval ticket, got ${JSON.stringify(result)}`);
  }
  return result.approval_pending.approval_id;
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

  it('approvals off refuses a tool the default selectors would gate, before it runs', async () => {
    const server = makeAnnotatedServer({ destructiveHint: true });
    const dispatcher = makeDispatcher([server]);

    const reply = await dispatcher.dispatch({
      request: { op: 'call_tool', server: 'github', tool: 'wipe' },
      traceCarrier: {},
    });

    expect(reply.ok).toBe(false);
    if (reply.ok) throw new Error('unreachable');
    expect(reply.source).toBe('caller');
    expect(reply.error).toMatch(/destructive and cannot be called in Code Mode/);
    expect(server.callTool).not.toHaveBeenCalled();
  });

  it('approvals off refuses a write tool even when the agent requires no approval for it', async () => {
    // The agent narrowed `require_approval_for_tools`, so the tool set itself would run the call.
    const server = makeAnnotatedServer({ readOnlyHint: false });
    const dispatcher = makeDispatcher([server]);

    const reply = await dispatcher.dispatch({
      request: { op: 'call_tool', server: 'github', tool: 'wipe' },
      traceCarrier: {},
    });

    expect(reply.ok).toBe(false);
    if (reply.ok) throw new Error('unreachable');
    expect(reply.source).toBe('caller');
    expect(server.callTool).not.toHaveBeenCalled();
  });

  it('approvals off keeps the existing refusal for an approval-gated tool', async () => {
    const dispatcher = makeDispatcher([approvalRequiredServer()]);

    const reply = await dispatcher.dispatch({
      request: { op: 'call_tool', server: 'github', tool: 'tool_a' },
      traceCarrier: {},
    });

    expect(reply.ok).toBe(false);
    if (reply.ok) throw new Error('unreachable');
    expect(reply.source).toBe('caller');
    expect(reply.error).toMatch(/requires interactive handling/);
  });

  it('approvals on let the agent policy decide: an unapproved destructive tool still runs', async () => {
    const server = makeAnnotatedServer({ destructiveHint: true });
    const dispatcher = makeDispatcher([server], true);

    const reply = await dispatcher.dispatch({
      request: { op: 'call_tool', server: 'github', tool: 'wipe' },
      traceCarrier: {},
    });

    expect(reply).toEqual({ ok: true, result: { content: [{ type: 'text', text: 'ran' }], isError: false } });
  });

  it('approvals on return a ticket, and the poll fails because no approval flow exists yet', async () => {
    const dispatcher = makeDispatcher([approvalRequiredServer()], true);

    const call = await dispatcher.dispatch({
      request: { op: 'call_tool', server: 'github', tool: 'tool_a' },
      traceCarrier: {},
    });
    const approvalId = expectApprovalId(call);

    const poll = await dispatcher.dispatch({
      request: { op: 'await_approval', approval_id: approvalId },
      traceCarrier: {},
    });

    expect(poll.ok).toBe(false);
    if (poll.ok) throw new Error('unreachable');
    expect(poll.source).toBe('internal');
    expect(poll.error).toMatch(/needs approval, which is not available yet/);
  });

  it('polling an approval twice is caller fault', async () => {
    const dispatcher = makeDispatcher([approvalRequiredServer()], true);

    const call = await dispatcher.dispatch({
      request: { op: 'call_tool', server: 'github', tool: 'tool_a' },
      traceCarrier: {},
    });
    const approvalId = expectApprovalId(call);
    await dispatcher.dispatch({ request: { op: 'await_approval', approval_id: approvalId }, traceCarrier: {} });

    const again = await dispatcher.dispatch({
      request: { op: 'await_approval', approval_id: approvalId },
      traceCarrier: {},
    });

    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('unreachable');
    expect(again.source).toBe('caller');
    expect(again.error).toMatch(/Unknown approval/);
  });

  it('closing the dispatcher ends a script still waiting on an approval', async () => {
    const dispatcher = makeDispatcher([approvalRequiredServer()], true);
    const call = await dispatcher.dispatch({
      request: { op: 'call_tool', server: 'github', tool: 'tool_a' },
      traceCarrier: {},
    });
    const approvalId = expectApprovalId(call);

    dispatcher.close();
    const poll = await dispatcher.dispatch({
      request: { op: 'await_approval', approval_id: approvalId },
      traceCarrier: {},
    });

    expect(poll).toEqual({ ok: false, error: 'Code Mode dispatcher is closed', source: 'transport' });
  });

  // The deleted sandbox-side check blocked exactly this predicate. The flag-off shim reuses the
  // default selectors instead of restating it, so a change to tag semantics must not widen Code Mode.
  it('default selectors match the sandbox destructive predicate they replaced', () => {
    const hints = [true, false, undefined];
    for (const destructiveHint of hints) {
      for (const readOnlyHint of hints) {
        const annotations: ToolAnnotations = {
          ...(destructiveHint === undefined ? {} : { destructiveHint }),
          ...(readOnlyHint === undefined ? {} : { readOnlyHint }),
        };
        expect(toolRequiresApproval('wipe', annotations, DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS)).toBe(
          destructiveHint === true || readOnlyHint === false,
        );
      }
    }
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
