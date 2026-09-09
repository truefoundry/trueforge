import { createLogger, transports } from 'winston';
import { TrueFoundryServiceFoundryServerClient } from '../../../src/truefoundry/TrueFoundryServiceFoundryServerClient';

const fetchMock = jest.fn();

jest.mock('undici', () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

function jsonResponse(body: unknown): { ok: true; status: 200; text: () => Promise<string> } {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

describe('TrueFoundryServiceFoundryServerClient listAgentSkills paging', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('continues when pagination.total is missing until an empty page', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `s-${String(i)}` }));
    const page2 = [{ id: 's-100' }];
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: page1 }))
      .mockResolvedValueOnce(jsonResponse({ data: page2 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const client = new TrueFoundryServiceFoundryServerClient({
      serviceFoundryServerUrl: 'https://sfy.example',
      logger: createLogger({ transports: [new transports.Console({ silent: true })] }),
      tls: { enabled: false, dir: '' },
      httpTimeoutMs: 5_000,
      httpAgentTimeoutMs: 5_000,
      apiKey: 'key',
    });

    await expect(client.listAgentSkills({ accessToken: 'token' })).resolves.toEqual([...page1, ...page2]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
