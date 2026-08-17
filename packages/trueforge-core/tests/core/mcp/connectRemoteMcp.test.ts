import { McpConnectionError } from '../../../src/core/errors';
import { connectRemoteMcp } from '../../../src/core/mcp/remoteMcpClient';

// Records every transport type client.connect() was attempted with, in order.
const mockConnectAttempts: string[] = [];
const mockRequestTimeouts: number[] = [];
// Per-test hook: throw to fail a given transport, return to succeed.
let mockConnectImpl: (type: string) => void = () => {
  /* no-op */
};

interface MockTransport {
  __type: string;
  sessionId?: string;
}

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    onclose?: () => void;
    onerror?: (e: Error) => void;
    connect(transport: MockTransport): Promise<void> {
      const type = transport.__type;
      mockConnectAttempts.push(type);
      mockConnectImpl(type);
      return Promise.resolve();
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
    request(_req: unknown, _schema: unknown, options?: { timeout?: number }): Promise<{ tools: [] }> {
      if (options?.timeout !== undefined) mockRequestTimeouts.push(options.timeout);
      return Promise.resolve({ tools: [] });
    }
    listTools(_params?: unknown, options?: { timeout?: number }): Promise<{ tools: [] }> {
      return this.request({}, {}, options);
    }
    callTool(): Promise<{ content: [] }> {
      return Promise.resolve({ content: [] });
    }
  },
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: function StreamableHTTPClientTransport(
    _url: URL,
    opts?: { sessionId?: string },
  ): MockTransport {
    return {
      __type: 'streamable-http',
      ...(opts?.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
    };
  },
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: function SSEClientTransport(): MockTransport {
    return { __type: 'sse' };
  },
}));

const baseParams = () => ({
  url: 'https://mcp.example.com/mcp',
  headers: {},
  requestTimeoutMs: 60_000,
  connectTimeoutMs: 5_000,
  signal: new AbortController().signal,
});

describe('connectRemoteMcp transport selection', () => {
  beforeEach(() => {
    mockConnectAttempts.length = 0;
    mockRequestTimeouts.length = 0;
    mockConnectImpl = () => {
      /* no-op */
    };
  });

  it('falls back to the other transport when the known hint is stale/wrong', async () => {
    // Hint says sse, but the server is actually streamable-http (sse connect fails).
    mockConnectImpl = type => {
      if (type === 'sse') throw new Error('not an SSE endpoint');
    };

    const conn = await connectRemoteMcp({ ...baseParams(), knownTransportType: 'sse' });

    expect(conn.transportType).toBe('streamable-http');
    // Hint tried first, then fell back to the remaining transport.
    expect(mockConnectAttempts).toEqual(['sse', 'streamable-http']);
  });

  it('uses the known hint directly when it works (no fallback attempt)', async () => {
    const conn = await connectRemoteMcp({ ...baseParams(), knownTransportType: 'sse' });

    expect(conn.transportType).toBe('sse');
    expect(mockConnectAttempts).toEqual(['sse']);
  });

  it('uses the configured request timeout', async () => {
    const conn = await connectRemoteMcp({ ...baseParams(), requestTimeoutMs: 1234 });

    await conn.listTools();

    expect(mockRequestTimeouts).toEqual([1234]);
  });

  it('probes in order when there is no hint', async () => {
    mockConnectImpl = type => {
      if (type === 'streamable-http') throw new Error('no streamable-http');
    };

    const conn = await connectRemoteMcp(baseParams());

    expect(conn.transportType).toBe('sse');
    expect(mockConnectAttempts).toEqual(['streamable-http', 'sse']);
  });

  it('throws immediately on a 401 without trying the fallback transport', async () => {
    mockConnectImpl = () => {
      throw new Error('HTTP 401 Unauthorized');
    };

    await expect(connectRemoteMcp({ ...baseParams(), knownTransportType: 'streamable-http' })).rejects.toMatchObject({
      constructor: McpConnectionError,
      statusCode: 401,
    });
    expect(mockConnectAttempts).toEqual(['streamable-http']);
  });

  it('surfaces a session-expiry on the hinted transport without falling back (caller resets the session)', async () => {
    mockConnectImpl = () => {
      throw new Error('HTTP 404 session not found');
    };

    await expect(
      connectRemoteMcp({ ...baseParams(), knownTransportType: 'streamable-http', sessionId: 'sess-1' }),
    ).rejects.toMatchObject({ constructor: McpConnectionError });
    // Session-expiry short-circuits: no fallback to sse with a stale session.
    expect(mockConnectAttempts).toEqual(['streamable-http']);
  });
});
