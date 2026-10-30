import { MemoryIngestError, type MemoryExchange } from '../../../../src/memory/MemoryProvider';
import type { MemoryScope } from '../../../../src/memory/scope';
import { ZepMemoryProvider, ZepRequestError } from '../../../../src/memory/zep/ZepMemoryProvider';

const BASE_URL = 'https://zep.test/api/v4';

const SCOPE: MemoryScope = {
  type: 'default',
  tenantId: 'acme',
  subjectId: 'user-1',
  displayName: 'Priya',
  agentId: null,
  key: 'tfg-acme-trueforge-user-1',
};

const EXCHANGE: MemoryExchange = {
  sessionId: 'session-1',
  firstTurnId: 't1',
  lastTurnId: 't2',
  messages: [
    {
      role: 'user',
      content: 'I am vegetarian',
      createdAt: '2026-10-01T00:00:00.000Z',
      name: 'Priya',
      extract: true,
    },
    {
      role: 'assistant',
      content: 'Noted.',
      createdAt: '2026-10-01T00:01:00.000Z',
      name: 'TrueForge',
      extract: false,
    },
  ],
};

function fakeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

interface Call {
  path: string;
  body: unknown;
  authorization: string | null;
}

/** Replays `responses` in order and records each request. */
function fakeFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      path: String(url).replace(BASE_URL, ''),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      authorization: headers.get('authorization'),
    });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error('unexpected request');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { calls, fetchImpl };
}

function jsonResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function provider(fetchImpl: typeof fetch, logger = fakeLogger()) {
  const sleep = jest.fn(async (_ms: number) => {});
  const zep = new ZepMemoryProvider({
    apiKey: 'test-key',
    baseUrl: `${BASE_URL}/`,
    logger: logger as never,
    fetch: fetchImpl,
    sleep,
  });
  return { zep, sleep, logger };
}

describe('ZepMemoryProvider', () => {
  it('creates a missing user and a thread, then adds messages with the agent reply ignored', async () => {
    const { calls, fetchImpl } = fakeFetch([
      jsonResponse(404, { message: 'not found' }),
      jsonResponse(201, { uuid: 'user-uuid' }),
      jsonResponse(201, { uuid: 'thread-uuid' }),
      jsonResponse(202, { task: { uuid: 'task-1' } }),
    ]);
    const { zep } = provider(fetchImpl);

    await expect(
      zep.ingestExchange({ scope: SCOPE, exchange: EXCHANGE, externalThreadId: null, mayAlreadyBeStored: false }),
    ).resolves.toEqual({
      externalThreadId: 'thread-uuid',
    });

    expect(calls.map(call => call.path)).toEqual([
      '/users/lookup',
      '/users',
      '/threads',
      '/threads/thread-uuid/messages',
    ]);
    expect(calls.every(call => call.authorization === 'Api-Key test-key')).toBe(true);
    expect(calls[1]?.body).toEqual({
      user_id: SCOPE.key,
      first_name: 'Priya',
      metadata: { tenant_id: 'acme', subject_id: 'user-1', agent_id: null, scope_type: 'default' },
    });
    expect(calls[2]?.body).toEqual({ user_uuid: 'user-uuid' });
    expect(calls[3]?.body).toEqual({
      ignore_roles: ['assistant'],
      messages: EXCHANGE.messages.map(message => ({
        role: message.role,
        name: message.name,
        content: message.content,
        reference_time: message.createdAt,
        metadata: {
          session_id: 'session-1',
          first_turn_id: 't1',
          last_turn_id: 't2',
          scope: 'default',
        },
      })),
    });
  });

  it('reuses an existing thread and caches user lookups across sessions', async () => {
    const { calls, fetchImpl } = fakeFetch([
      jsonResponse(202),
      jsonResponse(200, { uuid: 'user-uuid' }),
      jsonResponse(201, { uuid: 'thread-2' }),
      jsonResponse(202),
      jsonResponse(201, { uuid: 'thread-3' }),
      jsonResponse(202),
    ]);
    const { zep } = provider(fetchImpl);

    await zep.ingestExchange({
      scope: SCOPE,
      exchange: EXCHANGE,
      externalThreadId: 'thread-1',
      mayAlreadyBeStored: false,
    });
    await zep.ingestExchange({
      scope: SCOPE,
      exchange: { ...EXCHANGE, sessionId: 's2' },
      externalThreadId: null,
      mayAlreadyBeStored: false,
    });
    await zep.ingestExchange({
      scope: SCOPE,
      exchange: { ...EXCHANGE, sessionId: 's3' },
      externalThreadId: null,
      mayAlreadyBeStored: false,
    });

    expect(calls.map(call => call.path)).toEqual([
      '/threads/thread-1/messages',
      '/users/lookup',
      '/threads',
      '/threads/thread-2/messages',
      '/threads',
      '/threads/thread-3/messages',
    ]);
  });

  it('omits ignore_roles when every message is extractable', async () => {
    const { calls, fetchImpl } = fakeFetch([jsonResponse(202)]);
    const { zep } = provider(fetchImpl);
    const [userMessage] = EXCHANGE.messages;
    if (userMessage === undefined) {
      throw new Error('fixture');
    }

    await zep.ingestExchange({
      scope: SCOPE,
      exchange: { ...EXCHANGE, messages: [userMessage] },
      externalThreadId: 't',
      mayAlreadyBeStored: false,
    });

    expect(calls[0]?.body).not.toHaveProperty('ignore_roles');
  });

  it('starts a new thread when the stored one is gone', async () => {
    const { calls, fetchImpl } = fakeFetch([
      jsonResponse(404),
      jsonResponse(200, { uuid: 'user-uuid' }),
      jsonResponse(201, { uuid: 'thread-new' }),
      jsonResponse(202),
    ]);
    const { zep } = provider(fetchImpl);

    await expect(
      zep.ingestExchange({
        scope: SCOPE,
        exchange: EXCHANGE,
        externalThreadId: 'thread-gone',
        mayAlreadyBeStored: false,
      }),
    ).resolves.toEqual({ externalThreadId: 'thread-new' });
    expect(calls.map(call => call.path)).toEqual([
      '/threads/thread-gone/messages',
      '/users/lookup',
      '/threads',
      '/threads/thread-new/messages',
    ]);
  });

  it('retries a 429 on adding messages, honouring Retry-After, and logs each attempt', async () => {
    const { fetchImpl } = fakeFetch([jsonResponse(429, {}, { 'retry-after': '2' }), jsonResponse(202)]);
    const { zep, sleep, logger } = provider(fetchImpl);

    await zep.ingestExchange({
      scope: SCOPE,
      exchange: EXCHANGE,
      externalThreadId: 'thread-1',
      mayAlreadyBeStored: false,
    });

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2_000]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Memory provider request failed; retrying',
      expect.objectContaining({ provider: 'zep', operation: 'add_messages', status: 429, attempt: 1 }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'Memory provider request',
      expect.objectContaining({ provider: 'zep', operation: 'add_messages', status: 202, attempt: 2 }),
    );
    const [, fields] = logger.debug.mock.calls[0] ?? [];
    expect(fields).toHaveProperty('duration_ms');
  });

  it('does not retry adding messages after a timeout or 5xx, since Zep may have stored them', async () => {
    for (const failure of [new TypeError('fetch failed'), jsonResponse(503)]) {
      const { calls, fetchImpl } = fakeFetch([failure]);
      const { zep } = provider(fetchImpl);

      await expect(
        zep.ingestExchange({
          scope: SCOPE,
          exchange: EXCHANGE,
          externalThreadId: 'thread-1',
          mayAlreadyBeStored: false,
        }),
      ).rejects.toBeInstanceOf(MemoryIngestError);
      expect(calls).toHaveLength(1);
    }
  });

  it('still retries idempotent calls (user lookup) after a network error', async () => {
    const { calls, fetchImpl } = fakeFetch([
      new TypeError('fetch failed'),
      jsonResponse(200, { uuid: 'user-uuid' }),
      jsonResponse(201, { uuid: 'thread-1' }),
      jsonResponse(202),
    ]);
    const { zep, sleep } = provider(fetchImpl);

    await zep.ingestExchange({ scope: SCOPE, exchange: EXCHANGE, externalThreadId: null, mayAlreadyBeStored: false });

    expect(calls.map(call => call.path)).toEqual([
      '/users/lookup',
      '/users/lookup',
      '/threads',
      '/threads/thread-1/messages',
    ]);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500]);
  });

  it('skips resending an exchange an earlier attempt already stored', async () => {
    const stored = { session_id: 'session-1', first_turn_id: 't1', last_turn_id: 't2', scope: 'default' };
    const { calls, fetchImpl } = fakeFetch([jsonResponse(200, { items: [{ metadata: stored }], total_size: 1 })]);
    const { zep } = provider(fetchImpl);

    await expect(
      zep.ingestExchange({ scope: SCOPE, exchange: EXCHANGE, externalThreadId: 'thread-1', mayAlreadyBeStored: true }),
    ).resolves.toEqual({ externalThreadId: 'thread-1' });
    expect(calls.map(call => [call.path, call.body])).toEqual([['/threads/thread-1/messages', null]]);
  });

  it('resends when the check finds the exchange missing', async () => {
    const other = { session_id: 'session-1', first_turn_id: 't0', last_turn_id: 't0', scope: 'default' };
    const { calls, fetchImpl } = fakeFetch([
      jsonResponse(200, { items: [{ metadata: other }, { metadata: null }], total_size: 2 }),
      jsonResponse(202),
    ]);
    const { zep } = provider(fetchImpl);

    await zep.ingestExchange({
      scope: SCOPE,
      exchange: EXCHANGE,
      externalThreadId: 'thread-1',
      mayAlreadyBeStored: true,
    });

    expect(calls.map(call => call.path)).toEqual(['/threads/thread-1/messages', '/threads/thread-1/messages']);
  });

  it('fails without retrying on a client error', async () => {
    const { calls, fetchImpl } = fakeFetch([jsonResponse(400, { message: 'bad request' })]);
    const { zep, logger } = provider(fetchImpl);

    const result = zep.ingestExchange({
      scope: SCOPE,
      exchange: EXCHANGE,
      externalThreadId: 'thread-1',
      mayAlreadyBeStored: false,
    });
    await expect(result).rejects.toBeInstanceOf(MemoryIngestError);
    await expect(result).rejects.toMatchObject({
      externalThreadId: 'thread-1',
      cause: expect.objectContaining({ operation: 'add_messages', status: 400 }),
    });
    expect(calls).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Memory provider request failed',
      expect.objectContaining({ operation: 'add_messages', status: 400, attempt: 1 }),
    );
  });

  it('gives up after the last attempt on repeated 429s', async () => {
    const { calls, fetchImpl } = fakeFetch([
      jsonResponse(429),
      jsonResponse(429),
      jsonResponse(429),
      jsonResponse(429),
    ]);
    const { zep } = provider(fetchImpl);

    await expect(
      zep.ingestExchange({ scope: SCOPE, exchange: EXCHANGE, externalThreadId: 'thread-1', mayAlreadyBeStored: false }),
    ).rejects.toMatchObject({ cause: expect.any(ZepRequestError) });
    expect(calls).toHaveLength(4);
  });

  it('reports a thread it created when adding messages then fails, so it is not lost', async () => {
    const { fetchImpl } = fakeFetch([
      jsonResponse(200, { uuid: 'user-uuid' }),
      jsonResponse(201, { uuid: 'thread-new' }),
      jsonResponse(400, { message: 'bad request' }),
    ]);
    const { zep } = provider(fetchImpl);

    await expect(
      zep.ingestExchange({ scope: SCOPE, exchange: EXCHANGE, externalThreadId: null, mayAlreadyBeStored: false }),
    ).rejects.toMatchObject({ name: 'MemoryIngestError', externalThreadId: 'thread-new' });
  });
});
