import { createLogger, transports } from 'winston';
import { TrueFoundryServiceFoundryServerClient } from '../../../src/truefoundry/TrueFoundryServiceFoundryServerClient';

const fetchMock = jest.fn();

jest.mock('undici', () => ({
  Agent: class Agent {},
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

function jsonResponse(body: unknown): { ok: true; status: 200; text: () => Promise<string> } {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

describe('TrueFoundryServiceFoundryServerClient.getTenantControlPlaneUrl', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('fetches controlPlaneURL with the service API key and caches by tenant', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        controlPlaneURL: 'https://tenant.example.com',
        user: null,
      }),
    );

    const client = new TrueFoundryServiceFoundryServerClient({
      serviceFoundryServerUrl: 'https://sfy.example',
      logger: createLogger({ transports: [new transports.Console({ silent: true })] }),
      tls: { enabled: false, dir: '' },
      httpTimeoutMs: 5_000,
      httpAgentTimeoutMs: 5_000,
      apiKey: 'service-key',
    });

    await expect(client.getTenantControlPlaneUrl({ tenantName: 'acme' })).resolves.toBe('https://tenant.example.com');
    await expect(client.getTenantControlPlaneUrl({ tenantName: 'acme' })).resolves.toBe('https://tenant.example.com');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, { headers: Record<string, string> }];
    expect(url.toString()).toBe('https://sfy.example/v1/session?tenantName=acme');
    expect(init.headers.authorization).toBe('Bearer service-key');
  });

  it('caches control-plane URLs per tenant', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ controlPlaneURL: 'https://acme.example.com' }))
      .mockResolvedValueOnce(jsonResponse({ controlPlaneURL: 'https://other.example.com' }));

    const client = new TrueFoundryServiceFoundryServerClient({
      serviceFoundryServerUrl: 'https://sfy.example',
      logger: createLogger({ transports: [new transports.Console({ silent: true })] }),
      tls: { enabled: false, dir: '' },
      httpTimeoutMs: 5_000,
      httpAgentTimeoutMs: 5_000,
      apiKey: 'service-key',
    });

    await expect(client.getTenantControlPlaneUrl({ tenantName: 'acme' })).resolves.toBe('https://acme.example.com');
    await expect(client.getTenantControlPlaneUrl({ tenantName: 'other' })).resolves.toBe('https://other.example.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
