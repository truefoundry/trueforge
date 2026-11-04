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

function jsonResponse(body: unknown): { ok: true; status: 200; text: () => Promise<string> } {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function createClient(): TrueFoundryServiceFoundryServerClient {
  return new TrueFoundryServiceFoundryServerClient({
    serviceFoundryServerUrl: 'https://sfy.example',
    logger: createLogger({ transports: [new transports.Console({ silent: true })] }),
    tls: { enabled: false, dir: '' },
    httpTimeoutMs: 5_000,
    httpAgentTimeoutMs: 5_000,
    apiKey: 'service-key',
  });
}

function requestedUrl(): URL {
  const [url] = fetchMock.mock.calls[0] as [URL];
  return url;
}

describe('TrueFoundryServiceFoundryServerClient.peekUsers', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('searches users by name with the caller token, limit, and offset', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ users: [{ id: 'u1', name: 'Alice', email: 'alice@example.com' }], totalUsers: 1, teams: [] }),
    );

    await expect(
      createClient().peekUsers({ accessToken: 'caller-token', name: 'ali', limit: 10, offset: 20 }),
    ).resolves.toEqual({ users: [{ id: 'u1', name: 'Alice', email: 'alice@example.com' }], totalUsers: 1 });

    const url = requestedUrl();
    expect(url.pathname).toBe('/v1/subjects/peek');
    expect(JSON.parse(url.searchParams.get('filter') ?? '')).toEqual({ subjectType: ['user'], name: 'ali' });
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('offset')).toBe('20');
    const [, init] = fetchMock.mock.calls[0] as [URL, { headers: Record<string, string> }];
    expect(init.headers['authorization']).toBe('Bearer caller-token');
  });

  it('omits the name when searching without one', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ users: [], totalUsers: 0 }));

    await createClient().peekUsers({ accessToken: 'caller-token', limit: 25, offset: 0 });

    expect(JSON.parse(requestedUrl().searchParams.get('filter') ?? '')).toEqual({ subjectType: ['user'] });
  });

  it('looks users up by id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ users: [], totalUsers: 0 }));

    await createClient().peekUsers({ accessToken: 'caller-token', ids: ['u1', 'u2'] });

    const url = requestedUrl();
    expect(JSON.parse(url.searchParams.get('filter') ?? '')).toEqual({
      subjects: [
        { subjectType: 'user', subjectId: 'u1' },
        { subjectType: 'user', subjectId: 'u2' },
      ],
    });
    expect(url.searchParams.has('limit')).toBe(false);
    expect(url.searchParams.has('offset')).toBe(false);
  });

  it('fails with 424 on a malformed response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ users: 'nope' }));

    await expect(createClient().peekUsers({ accessToken: 'caller-token', limit: 25, offset: 0 })).rejects.toMatchObject(
      { status: 424, message: 'TrueFoundry ServiceFoundry subjects response was malformed' },
    );
  });
});
