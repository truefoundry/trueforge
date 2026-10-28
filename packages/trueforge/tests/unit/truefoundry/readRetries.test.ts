import { createLogger, transports } from 'winston';
import { TrueFoundryServiceFoundryServerClient } from '../../../src/truefoundry/TrueFoundryServiceFoundryServerClient';

const fetchMock = jest.fn();

jest.mock('undici', () => {
  const actual = jest.requireActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: (...args: unknown[]) => fetchMock(...args),
  };
});

const SESSION = {
  user: {
    tenantName: 'acme',
    roles: ['admin'],
    subject: { subjectId: 'user-1', subjectType: 'user' },
  },
};

const USERS = { users: [{ id: 'u1', name: 'Alice', email: 'alice@example.com' }], totalUsers: 1 };

function jsonResponse(body: unknown): { ok: true; status: 200; text: () => Promise<string> } {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function statusResponse(
  status: number,
  headers: Record<string, string> = {},
): {
  ok: false;
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<Record<string, never>>;
  text: () => Promise<string>;
  body: { cancel: () => Promise<void> };
} {
  return {
    ok: false,
    status,
    headers: {
      get(name: string): string | null {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    json: async () => ({}),
    text: async () => 'not-json',
    body: { cancel: async () => undefined },
  };
}

function connectionError(code: string): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error('connect failed'), { code }) });
}

function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

function createClient(maxRetries: number): TrueFoundryServiceFoundryServerClient {
  return new TrueFoundryServiceFoundryServerClient({
    serviceFoundryServerUrl: 'https://sfy.example',
    logger: createLogger({ transports: [new transports.Console({ silent: true })] }),
    tls: { enabled: false, dir: '' },
    httpTimeoutMs: 5_000,
    httpAgentTimeoutMs: 5_000,
    maxRetries,
    apiKey: 'service-key',
  });
}

/** Network retries sleep on backoff. Advance fake timers so the test does not wait. */
async function withBackoffTimers<T>(run: () => Promise<T>): Promise<T> {
  jest.useFakeTimers();
  try {
    // Attach the rejection before timers flush it, or Jest treats it as unhandled.
    const pending = run().then(
      value => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await jest.runAllTimersAsync();
    const result = await pending;
    if (!result.ok) {
      throw result.error;
    }
    return result.value;
  } finally {
    jest.useRealTimers();
  }
}

describe('TrueFoundryServiceFoundryServerClient read retries', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('retries a dropped connection on GET and returns the next success', async () => {
    fetchMock.mockRejectedValueOnce(connectionError('ECONNRESET')).mockResolvedValueOnce(jsonResponse(USERS));

    await expect(
      withBackoffTimers(() => createClient(1).peekUsers({ accessToken: 'caller-token', ids: ['u1'] })),
    ).resolves.toEqual({ users: [{ id: 'u1', name: 'Alice', email: 'alice@example.com' }], totalUsers: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a per-call timeout on GET', async () => {
    fetchMock.mockRejectedValueOnce(timeoutError()).mockResolvedValueOnce(jsonResponse(USERS));

    await expect(
      withBackoffTimers(() => createClient(1).peekUsers({ accessToken: 'caller-token', ids: ['u1'] })),
    ).resolves.toEqual({ users: [{ id: 'u1', name: 'Alice', email: 'alice@example.com' }], totalUsers: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries HTTP 503 on getSession and ignores the gateway body', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(503, { 'retry-after-ms': '0' }))
      .mockResolvedValueOnce(jsonResponse(SESSION));

    await expect(createClient(2).getSession('caller-token')).resolves.toEqual(SESSION);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries HTTP 504 on getSession', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(504, { 'retry-after-ms': '0' }))
      .mockResolvedValueOnce(jsonResponse(SESSION));

    await expect(createClient(2).getSession('caller-token')).resolves.toEqual(SESSION);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(401));

    await expect(createClient(2).peekUsers({ accessToken: 'caller-token', ids: ['u1'] })).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry HTTP 500', async () => {
    fetchMock.mockResolvedValue(statusResponse(500));

    await expect(createClient(2).peekUsers({ accessToken: 'caller-token', ids: ['u1'] })).rejects.toMatchObject({
      status: 424,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws after the GET retries are used up', async () => {
    fetchMock.mockRejectedValue(connectionError('ECONNRESET'));

    await expect(
      withBackoffTimers(() => createClient(2).peekUsers({ accessToken: 'caller-token', ids: ['u1'] })),
    ).rejects.toThrow('TrueFoundry ServiceFoundry server request failed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a network error when maxRetries is 0', async () => {
    fetchMock.mockRejectedValue(connectionError('ECONNRESET'));

    await expect(createClient(0).peekUsers({ accessToken: 'caller-token', ids: ['u1'] })).rejects.toThrow(
      'TrueFoundry ServiceFoundry server request failed',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry PUT when the gateway returns 503', async () => {
    fetchMock.mockResolvedValueOnce(statusResponse(503, { 'retry-after-ms': '0' }));

    await expect(
      createClient(2).putRemoteAgent({
        accessToken: 'caller-token',
        name: 'agent',
        description: 'desc',
        model: 'model',
        mcp_servers: [],
      }),
    ).rejects.toMatchObject({ status: 424 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
