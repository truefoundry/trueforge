import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';
import type { AgentRecord } from '../../../src/db/agentStore';
import { createTrueFoundryRequestContext } from '../../../src/truefoundry/accessToken';
import { TrueFoundryModelProviderStore } from '../../../src/truefoundry/TrueFoundryModelProviderStore';
import type { TrueFoundryServiceFoundryServerClient } from '../../../src/truefoundry/TrueFoundryServiceFoundryServerClient';

const TENANT = 'acme';
const SUBJECT_TOKEN = 'subject-token';
const ACTOR_TOKEN = 'actor-token';

const AGENT: AgentRecord = {
  id: 'agent-1',
  tenant_id: TENANT,
  name: 'named',
  description: 'Test agent.',
  manifest: AgentSpecSchema.parse({ model: { name: 'p/m' } }),
  external_id: 'ext-agent',
  created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'User' },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('TrueFoundryModelProviderStore dual tokens', () => {
  it('uses asAgent for SFY list calls and asUser as gateway api_key', async () => {
    const client = {
      listProviderIntegrations: jest.fn().mockResolvedValue([
        {
          name: 'gpt-4',
          manifest: { model_types: ['chat'] },
          providerAccount: { name: 'openai-main' },
        },
      ]),
      listGatewayInstallations: jest
        .fn()
        .mockResolvedValue([{ isDefault: true, manifest: { url: 'https://gateway.example' } }]),
      vendToken: jest.fn().mockResolvedValue({ subjectToken: SUBJECT_TOKEN, actorToken: ACTOR_TOKEN }),
    } as unknown as TrueFoundryServiceFoundryServerClient;

    const store = new TrueFoundryModelProviderStore({
      client,
      requestContext: createTrueFoundryRequestContext({
        tenant_id: TENANT,
        subject: { id: 'user-1', type: 'user', display_name: 'User' },
        roles: [],
        user_credential: 'caller-token',
      }),
      agent: AGENT,
      logger: createLogger({ silent: true }),
    });

    const providers = await store.listProviders({ tenant_id: TENANT });

    expect(client.listProviderIntegrations).toHaveBeenCalledWith(expect.objectContaining({ accessToken: ACTOR_TOKEN }));
    expect(client.listGatewayInstallations).toHaveBeenCalledWith(ACTOR_TOKEN);
    expect(client.vendToken).toHaveBeenCalledTimes(1);
    expect(providers).toHaveLength(1);
    expect(providers[0]?.manifest).toMatchObject({
      type: 'truefoundry',
      base_url: 'https://gateway.example',
      auth: { api_key: SUBJECT_TOKEN },
    });
  });

  it('routes a custom endpoint through proxy-api and refuses Jev', async () => {
    const client = {
      listProviderIntegrations: jest.fn().mockResolvedValue([
        {
          name: 'custom-endpoint',
          type: 'integration/model/custom-endpoint',
          manifest: {
            model_types: ['chat'],
            base_url: 'https://api.typesafe.ai/v1',
          },
          providerAccount: { name: 'jev', manifest: { type: 'provider-account/custom-endpoint' } },
        },
      ]),
      listGatewayInstallations: jest
        .fn()
        .mockResolvedValue([{ isDefault: true, manifest: { url: 'https://gateway.truefoundry.ai' } }]),
      vendToken: jest.fn().mockResolvedValue({ subjectToken: SUBJECT_TOKEN, actorToken: ACTOR_TOKEN }),
    } as unknown as TrueFoundryServiceFoundryServerClient;

    const store = new TrueFoundryModelProviderStore({
      client,
      requestContext: createTrueFoundryRequestContext({
        tenant_id: TENANT,
        subject: { id: 'user-1', type: 'user', display_name: 'User' },
        roles: [],
        user_credential: 'caller-token',
      }),
      agent: AGENT,
      logger: createLogger({ silent: true }),
    });

    const providers = await store.listProviders({ tenant_id: TENANT });
    expect(providers[0]?.manifest.models[0]).toMatchObject({
      name: 'custom-endpoint',
      model_id: 'jev/custom-endpoint',
    });
    expect(providers[0]?.manifest.models[0]?.invocation_error).toContain('POST /v1/systemone');
  });
});
