import type { Logger } from 'winston';
import { McpConnectionError, RemoteMCP, ToolSet } from '../../../src/core';
import {
  isApprovalRequiredResponse,
  isCallToolResponseResult,
  type MCPAuthRequired,
  type ToolSchema,
} from '../../../src/core/mcp/IMCPServer';
import type { RemoteMcpHeaders } from '../../../src/core/mcp/RemoteMCP';
import { connectRemoteMcp } from '../../../src/core/mcp/remoteMcpClient';
import type { ToolSelectorConfig } from '../../../src/core/mcp/ToolSelectorPolicy';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';

// RemoteMCP connects itself via connectRemoteMcp; mock it so the split RemoteMCP (connection) +
// ToolSet (policy) can be exercised without real networking. isSessionExpiredError stays real.
jest.mock('../../../src/core/mcp/remoteMcpClient', () => {
  const actualUnknown: unknown = jest.requireActual('../../../src/core/mcp/remoteMcpClient');
  const actual = actualUnknown as typeof import('../../../src/core/mcp/remoteMcpClient');
  return { __esModule: true as const, ...actual, connectRemoteMcp: jest.fn() };
});

const mockConnect = connectRemoteMcp as jest.MockedFunction<typeof connectRemoteMcp>;

const noopLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Logger;

const READ_TOOL: ToolSchema = {
  name: 'read_thing',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
};
const WRITE_TOOL: ToolSchema = {
  name: 'write_thing',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: false },
};

const DEFAULT_SELECTORS: ToolSelectorConfig = {
  enableTools: ['@all'],
  disableTools: [],
  preloadTools: [],
  requireApprovalForTools: [],
};

// Shared, mutable state backing the mocked connection so tests can assert connect/callTool/close
// counts and queue errors, mirroring the previous FakeTransport.
interface FakeConnectionState {
  connectCalls: number;
  callToolCalls: number;
  closes: number;
  queueCallToolError(error: unknown): void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('unknown error');
}

function installFakeConnection(
  opts: { tools?: ToolSchema[]; sessionId?: string | null; connectError?: unknown } = {},
): FakeConnectionState {
  const callToolErrors: unknown[] = [];
  const state: FakeConnectionState = {
    connectCalls: 0,
    callToolCalls: 0,
    closes: 0,
    queueCallToolError: (error: unknown) => callToolErrors.push(error),
  };

  mockConnect.mockImplementation(() => {
    state.connectCalls += 1;
    if (opts.connectError) {
      return Promise.reject(toError(opts.connectError));
    }
    return Promise.resolve({
      transportType: 'streamable-http' as const,
      sessionId: opts.sessionId ?? null,
      listTools: () => Promise.resolve({ tools: opts.tools ?? [READ_TOOL, WRITE_TOOL] }),
      callTool: callParams => {
        state.callToolCalls += 1;
        const queued = callToolErrors.shift();
        if (queued) {
          return Promise.reject(toError(queued));
        }
        return Promise.resolve({ content: [{ type: 'text', text: `called ${callParams.name}` }] });
      },
      close: () => {
        state.closes += 1;
        return Promise.resolve();
      },
    });
  });

  return state;
}

function makeServer(params: {
  selectors?: ToolSelectorConfig | undefined;
  preload?: boolean | undefined;
  sessionId?: string | undefined;
  transportType?: 'streamable-http' | 'sse' | undefined;
  headers?: RemoteMcpHeaders | undefined;
}): ToolSet {
  const remote = new RemoteMCP({
    name: 'my-inline',
    id: 'inline-id-123',
    url: 'https://mcp.example.com/mcp',
    headers: params.headers ?? {},
    logger: noopLogger,
    tracing: NOOP_AGENT_TRACING,
    sessionId: params.sessionId,
    transportType: params.transportType,
    requestTimeoutMs: 60_000,
    connectTimeoutMs: 5_000,
    signal: new AbortController().signal,
  });
  return new ToolSet({
    source: remote,
    selectors: params.selectors ?? DEFAULT_SELECTORS,
    preload: params.preload ?? false,
  });
}

describe('RemoteMCP + ToolSet', () => {
  it('connects once, emits init info with session id, and caches across listTools calls', async () => {
    const state = installFakeConnection({ sessionId: 'sess-1' });
    const server = makeServer({});

    const first = await server.listTools();
    if ('authRequired' in first) throw new Error('unexpected oauth');
    expect(first.wasInitialized).toEqual({
      id: 'inline-id-123',
      name: 'my-inline',
      session_id: 'sess-1',
      transport_type: 'streamable-http',
    });
    expect(first.result.tools.map(t => t.name).sort()).toEqual(['read_thing', 'write_thing']);

    const second = await server.listTools();
    if ('authRequired' in second) throw new Error('unexpected oauth');
    // Cached: no re-connect and no duplicate init emission.
    expect(second.wasInitialized).toBeUndefined();
    expect(state.connectCalls).toBe(1);
  });

  it('seeds a persisted transport type as knownTransportType so the connect skips the probe', async () => {
    installFakeConnection({ sessionId: 'sess-1' });
    const server = makeServer({ sessionId: 'sess-1', transportType: 'sse' });

    await server.listTools();
    expect(mockConnect).toHaveBeenCalledWith(expect.objectContaining({ knownTransportType: 'sse' }));
  });

  it('probes (no knownTransportType) when there is no persisted transport type', async () => {
    installFakeConnection({ sessionId: 'sess-1' });
    const server = makeServer({ sessionId: 'sess-1' });

    await server.listTools();
    const firstCall = mockConnect.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]?.knownTransportType).toBeUndefined();
  });

  it('applies enable/disable selectors and preload annotation', async () => {
    installFakeConnection();
    const server = makeServer({
      selectors: { enableTools: ['@read-only'], disableTools: [], preloadTools: ['read_thing'] },
    });

    const res = await server.listTools();
    if ('authRequired' in res) throw new Error('unexpected oauth');
    expect(res.result.tools.map(t => t.name)).toEqual(['read_thing']);
    expect(res.result.tools[0]?.preload).toBe(true);
    expect(server.getAllowedToolNamesForSandbox()).toEqual(['read_thing']);
  });

  it('throws a 422 McpConnectionError when a literal enable tool is missing', async () => {
    installFakeConnection();
    const server = makeServer({
      selectors: { enableTools: ['does_not_exist'], disableTools: [], preloadTools: [] },
    });
    await expect(server.listTools()).rejects.toMatchObject({
      constructor: McpConnectionError,
      statusCode: 422,
    });
  });

  it('does not throw the missing-enable-literal 422 during annotation lookups (only explicit listTools)', async () => {
    const state = installFakeConnection();
    const server = makeServer({
      selectors: { enableTools: ['does_not_exist'], disableTools: [], preloadTools: [] },
    });
    // Annotation lookups (toolCallInfo / callTool preflight) fetch the raw tool list and
    // must not run the missing-literal guard, so deferred paths behave like the pre-refactor inner cache.
    await expect(server.toolCallInfo({ name: 'read_thing', arguments: {} })).resolves.toMatchObject({
      original_tool_name: 'read_thing',
    });
    expect(state.connectCalls).toBe(1);
    // The guard still fires on an explicit listTools().
    await expect(server.listTools()).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects a disallowed tool call with a 403 McpConnectionError', async () => {
    const state = installFakeConnection();
    const server = makeServer({
      selectors: { enableTools: ['@read-only'], disableTools: [], preloadTools: [] },
    });
    await server.listTools();
    await expect(server.callTool({ name: 'write_thing', arguments: {} })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(state.callToolCalls).toBe(0);
  });

  it('returns approvalRequired for an approval-gated tool when no decision is supplied', async () => {
    const state = installFakeConnection();
    const server = makeServer({
      selectors: { enableTools: ['@all'], disableTools: [], preloadTools: [], requireApprovalForTools: ['@write'] },
    });
    await server.listTools();

    const res = await server.callTool({ name: 'write_thing', arguments: {} });
    expect(isApprovalRequiredResponse(res)).toBe(true);
    expect(state.callToolCalls).toBe(0);
  });

  it('honors an empty require_approval_for_tools list (no approvals)', async () => {
    const state = installFakeConnection();
    const server = makeServer({
      selectors: { enableTools: ['@all'], disableTools: [], preloadTools: [], requireApprovalForTools: [] },
    });
    await server.listTools();

    const res = await server.callTool({ name: 'write_thing', arguments: {} });
    if (!isCallToolResponseResult(res)) throw new Error('expected result response');
    expect(res.result.isError).toBeFalsy();
    expect(state.callToolCalls).toBe(1);
  });

  it('honors literal require_approval_for_tools without gating other write tools', async () => {
    const state = installFakeConnection();
    const server = makeServer({
      selectors: {
        enableTools: ['@all'],
        disableTools: [],
        preloadTools: [],
        requireApprovalForTools: ['write_thing'],
      },
    });
    await server.listTools();

    const gated = await server.callTool({ name: 'write_thing', arguments: {} });
    expect(isApprovalRequiredResponse(gated)).toBe(true);
    expect(state.callToolCalls).toBe(0);

    const ungated = await server.callTool({ name: 'read_thing', arguments: {} });
    if (!isCallToolResponseResult(ungated)) throw new Error('expected result response');
    expect(ungated.result.isError).toBeFalsy();
    expect(state.callToolCalls).toBe(1);
  });

  it('short-circuits a denied tool call without hitting the transport', async () => {
    const state = installFakeConnection();
    const server = makeServer({});
    await server.listTools();

    const res = await server.callTool({ name: 'write_thing', arguments: {} }, { status: 'deny', reason: 'nope' });
    if (!isCallToolResponseResult(res)) throw new Error('expected result response');
    expect(res.result.isError).toBe(true);
    expect(state.callToolCalls).toBe(0);
  });

  it('retries once on an expired session, reconnecting transparently', async () => {
    const state = installFakeConnection({ sessionId: 'sess-1' });
    const server = makeServer({});
    await server.listTools();
    expect(state.connectCalls).toBe(1);

    state.queueCallToolError(new Error('session-expired'));
    const res = await server.callTool({ name: 'read_thing', arguments: {} });
    if (!isCallToolResponseResult(res)) throw new Error('expected result response');
    // First attempt failed with expiry, reset + reconnect, second attempt succeeded.
    expect(state.connectCalls).toBe(2);
    expect(state.callToolCalls).toBe(2);
  });

  it('wraps a non-auth connect failure in a server-named McpConnectionError preserving the status hint', async () => {
    installFakeConnection({ connectError: new McpConnectionError('upstream down', 502) });
    const server = makeServer({});
    try {
      await server.listTools();
      throw new Error('expected listTools to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(McpConnectionError);
      expect(err).toMatchObject({ statusCode: 502 });
      expect((err as McpConnectionError).message).toContain("remote MCP server 'my-inline'");
    }
  });

  it('wraps a 401 on connect as a server-named McpConnectionError (inline never enters auth-required)', async () => {
    const state = installFakeConnection({ connectError: new McpConnectionError('upstream 401', 401) });
    const server = makeServer({});

    try {
      await server.listTools();
      throw new Error('expected listTools to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(McpConnectionError);
      expect(err).toMatchObject({ statusCode: 401 });
      expect((err as McpConnectionError).message).toContain("remote MCP server 'my-inline'");
    }
    expect(state.connectCalls).toBe(1);
  });

  it('short-circuits with authRequired when the headers resolver signals auth-required', async () => {
    const state = installFakeConnection();
    const authRequired: MCPAuthRequired = {
      servers: [{ id: 'inline-id-123', name: 'my-inline', auth_url: 'https://auth.example' }],
    };
    const headers: RemoteMcpHeaders = () => Promise.resolve({ authRequired });
    const server = makeServer({
      headers,
      selectors: { enableTools: ['@read-only'], disableTools: [], preloadTools: [] },
    });

    const listRes = await server.listTools();
    expect(listRes).toEqual({ authRequired });

    // callTool surfaces auth-required before the annotation-based allow/approval checks.
    const callRes = await server.callTool({ name: 'read_thing', arguments: {} });
    expect(callRes).toEqual({ authRequired });

    // The resolver signalled auth before any network use.
    expect(state.connectCalls).toBe(0);
    expect(state.callToolCalls).toBe(0);
  });

  it('re-checks auth on every op: a mid-session auth revocation surfaces authRequired on the next callTool', async () => {
    const state = installFakeConnection({ sessionId: 'sess-1' });
    const authRequired: MCPAuthRequired = {
      servers: [{ id: 'inline-id-123', name: 'my-inline', auth_url: 'https://auth.example' }],
    };
    // Headers resolve fine at connect time, then flip to auth-required (e.g. token revoked mid-request).
    const headers = jest
      .fn<Promise<{ headers: Record<string, string> } | { authRequired: MCPAuthRequired }>, []>()
      .mockResolvedValueOnce({ headers: {} })
      .mockResolvedValue({ authRequired });
    const server = makeServer({ headers });

    const first = await server.listTools();
    if ('authRequired' in first) throw new Error('expected successful first connect');
    expect(state.connectCalls).toBe(1);

    // Already connected, but auth is re-checked: the revocation must surface instead of a tool result.
    const callRes = await server.callTool({ name: 'read_thing', arguments: {} });
    expect(callRes).toEqual({ authRequired });
    expect(state.callToolCalls).toBe(0);
  });

  it('emits init for a stateless (SSE) server on connect (matches gateway strict-compare behavior)', async () => {
    // Stateless connection reports a null session id.
    installFakeConnection({ sessionId: null });

    // First turn: never-connected (undefined) -> stateless (null) counts as a change, so init is
    // emitted once, carrying transport_type so a later turn can skip the probe. session_id is absent.
    const firstTurn = makeServer({});
    const first = await firstTurn.listTools();
    if ('authRequired' in first) throw new Error('unexpected oauth');
    expect(first.wasInitialized).toEqual({
      id: 'inline-id-123',
      name: 'my-inline',
      session_id: undefined,
      transport_type: 'streamable-http',
    });

    // A resume turn (hydrated with no session id) still emits, mirroring the gateway.
    const secondTurn = makeServer({ sessionId: undefined });
    const second = await secondTurn.listTools();
    if ('authRequired' in second) throw new Error('unexpected oauth');
    expect(second.wasInitialized).toMatchObject({ id: 'inline-id-123', name: 'my-inline' });
  });

  it('resolves dynamic headers from the resolver and connects normally', async () => {
    const state = installFakeConnection({ sessionId: 'sess-1' });
    const headers = jest
      .fn<Promise<{ headers: Record<string, string> }>, []>()
      .mockResolvedValue({ headers: { Authorization: 'Bearer live-token' } });
    const server = makeServer({ headers });

    const res = await server.listTools();
    if ('authRequired' in res) throw new Error('unexpected auth-required');
    expect(res.result.tools.map(t => t.name).sort()).toEqual(['read_thing', 'write_thing']);
    expect(headers).toHaveBeenCalled();

    // Second (cached) listTools does not re-resolve headers — resolution happens only at connect.
    await server.listTools();
    expect(headers).toHaveBeenCalledTimes(1);
    expect(state.connectCalls).toBe(1);
  });
});
