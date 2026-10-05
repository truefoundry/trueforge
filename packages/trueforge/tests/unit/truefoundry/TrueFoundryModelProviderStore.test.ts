import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';
import type { AgentRecord } from '../../../src/db/agentStore';
import { ACTOR_AUTHORIZATION_HEADER, createTrueFoundryRequestContext } from '../../../src/truefoundry/accessToken';
import { X_TFY_METADATA } from '../../../src/truefoundry/gatewayMetadata';
import { TrueFoundryModelProviderStore } from '../../../src/truefoundry/TrueFoundryModelProviderStore';
import type { TrueFoundryServiceFoundryServerClient } from '../../../src/truefoundry/TrueFoundryServiceFoundryServerClient';

const TENANT = 'acme';
const CALLER_TOKEN = 'caller-token';
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

describe('TrueFoundryModelProviderStore authorization', () => {
  it('lists with the actor token and invokes with the caller credential when delegated', async () => {
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
        user_credential: CALLER_TOKEN,
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
      auth: { api_key: CALLER_TOKEN },
    });
    expect(providers[0]?.manifest).not.toHaveProperty('headers');

    const provider = providers[0];
    if (provider === undefined) {
      throw new Error('expected a provider');
    }
    const headers = await store.resolveInvokeHeaders({
      record: provider,
      turnMetadata: { sessionId: 'sess-1', turnId: 'turn-1', agent: { id: 'agent-1', name: 'named' } },
    });
    expect(headers[ACTOR_AUTHORIZATION_HEADER]).toBe(`Bearer ${ACTOR_TOKEN}`);
    expect(headers['Authorization']).toBeUndefined();
    expect(JSON.parse(headers[X_TFY_METADATA] ?? '')).toMatchObject({
      'tfg.session_id': 'sess-1',
      'tfg.agent_id': 'agent-1',
    });
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });

  it('uses the subject token as api_key and sends no actor header when exchanged', async () => {
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
        user_credential: null,
      }),
      agent: AGENT,
      logger: createLogger({ silent: true }),
    });

    const providers = await store.listProviders({ tenant_id: TENANT });
    expect(client.listProviderIntegrations).toHaveBeenCalledWith(expect.objectContaining({ accessToken: ACTOR_TOKEN }));
    expect(providers[0]?.manifest).toMatchObject({ auth: { api_key: SUBJECT_TOKEN } });
    const provider = providers[0];
    if (provider === undefined) {
      throw new Error('expected a provider');
    }
    await expect(store.resolveInvokeHeaders({ record: provider })).resolves.toEqual({});
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });
});
