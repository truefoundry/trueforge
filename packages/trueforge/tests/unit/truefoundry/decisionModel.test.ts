import configuration, { parseTrueFoundryModelRouting } from '../../../src/config';
import { loadDecisionModel } from '../../../src/truefoundry/decisionModel';
import type { TrueFoundryServiceFoundryServerClient } from '../../../src/truefoundry/TrueFoundryServiceFoundryServerClient';

const API_KEY = 'decision-key';
const routing = parseTrueFoundryModelRouting(
  JSON.stringify({
    decision_model: { name: 'typesafe/jev-1.13.0', api_key: API_KEY },
    tenants: { acme: { enabled: 'on' } },
  }),
);

function clientWith(overrides: Record<string, unknown>): TrueFoundryServiceFoundryServerClient {
  return {
    listProviderIntegrations: jest.fn().mockResolvedValue([
      {
        name: 'jev-1.13.0',
        manifest: { model_types: ['decision'] },
        providerAccount: { name: 'typesafe' },
        metadata: { limits: { context_window: 32000 } },
      },
    ]),
    listGatewayInstallations: jest
      .fn()
      .mockResolvedValue([{ isDefault: true, manifest: { url: 'https://gateway.example' } }]),
    ...overrides,
  } as unknown as TrueFoundryServiceFoundryServerClient;
}

describe('loadDecisionModel', () => {
  const keys = ['STANDALONE', 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL', 'TRUEFOUNDRY_MODEL_ROUTING'] as const;
  const previous = new Map(keys.map(key => [key, Reflect.get(configuration, key)]));

  beforeEach(() => {
    Reflect.set(configuration, 'STANDALONE', false);
    Reflect.set(configuration, 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL', 'http://sfy.example');
    Reflect.set(configuration, 'TRUEFOUNDRY_MODEL_ROUTING', routing);
  });

  afterEach(() => {
    for (const [key, value] of previous) {
      Reflect.set(configuration, key, value);
    }
  });

  it('is undefined when model routing is not configured', async () => {
    Reflect.set(configuration, 'TRUEFOUNDRY_MODEL_ROUTING', undefined);
    const client = clientWith({});

    await expect(loadDecisionModel({ client })).resolves.toBeUndefined();
    expect(client.listProviderIntegrations).not.toHaveBeenCalled();
    expect(client.listGatewayInstallations).not.toHaveBeenCalled();
  });

  it('fails at startup when the key is rejected, keeping the cause', async () => {
    const rejection = new Error('unauthorized');
    const client = clientWith({ listProviderIntegrations: jest.fn().mockRejectedValue(rejection) });

    const failure: unknown = await loadDecisionModel({ client }).catch((error: unknown) => error);

    expect(failure).toEqual(expect.objectContaining({ message: expect.stringContaining('typesafe/jev-1.13.0') }));
    expect(failure).toHaveProperty('cause', rejection);
  });

  it('fails at startup when the named model is not available to the key', async () => {
    const client = clientWith({ listProviderIntegrations: jest.fn().mockResolvedValue([]) });

    await expect(loadDecisionModel({ client })).rejects.toThrow('typesafe/jev-1.13.0');
  });

  it('loads the decision model once, with the key', async () => {
    const client = clientWith({});

    const decisionModel = await loadDecisionModel({ client });

    expect(client.listProviderIntegrations).toHaveBeenCalledWith({
      accessToken: API_KEY,
      filter: { provider_account_name: 'typesafe', name: 'jev-1.13.0' },
    });
    expect(client.listGatewayInstallations).toHaveBeenCalledWith(API_KEY);
    expect(decisionModel?.properties).toEqual({ contextLength: 32000 });
  });
});
