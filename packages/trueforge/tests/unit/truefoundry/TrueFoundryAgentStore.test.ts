import { AgentSpecSchema, type CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';

import type { AgentRecord } from '../../../src/db/agentStore';
import { AgentNameConflictError } from '../../../src/db/agentStore';
import { TrueFoundryAgentStore } from '../../../src/truefoundry/TrueFoundryAgentStore';
import {
  TrueFoundryServiceFoundryServerClient,
  type DeleteRemoteAgentInput,
  type PutRemoteAgentInput,
  type PutRemoteAgentResult,
} from '../../../src/truefoundry/TrueFoundryServiceFoundryServerClient';

const TENANT = 'default';
const TOKEN = 'test-token';
const LOGGER = createLogger({ silent: true });
const CREATED_BY_SUBJECT: CreatedBySubject = {
  subject_id: 'tester',
  subject_type: 'user',
  subject_display_name: 'tester',
};

function mockTransaction() {
  const executor = {
    transformQuery(node: unknown) {
      return node;
    },
    compileQuery() {
      return { sql: 'select 1', parameters: [] };
    },
    executeQuery: jest.fn(async () => ({ rows: [] })),
    withPlugins() {
      return executor;
    },
  };
  return {
    getExecutor() {
      return executor;
    },
  };
}

const TXN = mockTransaction();

function manifest(overrides: { instructions?: string; mcp_servers?: { name: string }[] } = {}) {
  return AgentSpecSchema.parse({
    model: { name: 'openai-gateway/gpt-5' },
    instructions: overrides.instructions ?? 'Be helpful.',
    ...(overrides.mcp_servers === undefined ? {} : { mcp_servers: overrides.mcp_servers }),
  });
}

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
  const now = '2026-09-02T00:00:00.000Z';
  return {
    id: 'agent-1',
    tenant_id: TENANT,
    name: 'research',
    manifest: manifest(),
    external_id: null,
    created_by_subject: CREATED_BY_SUBJECT,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function mockInner(overrides = {}) {
  return {
    listAgents: jest.fn(),
    getAgent: jest.fn(),
    createAgent: jest.fn(),
    updateAgent: jest.fn(),
    deleteAgent: jest.fn(),
    withTransaction: jest.fn(async fn => fn(TXN)),
    ...overrides,
  };
}

function mockClient(
  overrides: {
    putRemoteAgent?: TrueFoundryServiceFoundryServerClient['putRemoteAgent'];
    deleteRemoteAgent?: TrueFoundryServiceFoundryServerClient['deleteRemoteAgent'];
  } = {},
): TrueFoundryServiceFoundryServerClient {
  const client = new TrueFoundryServiceFoundryServerClient({
    serviceFoundryServerUrl: 'http://servicefoundry.test',
    logger: LOGGER,
    tls: { enabled: false, dir: '' },
    httpTimeoutMs: 10_000,
    httpAgentTimeoutMs: 3_000,
  });
  client.putRemoteAgent =
    overrides.putRemoteAgent ?? (async (): Promise<PutRemoteAgentResult> => ({ externalId: 'sf-1' }));
  client.deleteRemoteAgent = overrides.deleteRemoteAgent ?? (async (_input: DeleteRemoteAgentInput) => undefined);
  return client;
}

function firstInvocationOrder(mock: jest.Mock): number {
  const order = mock.mock.invocationCallOrder[0];
  if (order === undefined) {
    throw new Error('expected mock to have been called');
  }
  return order;
}

describe('TrueFoundryAgentStore', () => {
  it('listAgents and getAgent pass through to the inner store', async () => {
    const agents = [record()];
    const listAgents = jest.fn(async () => agents);
    const getAgent = jest.fn(async () => agents[0]);
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ listAgents, getAgent }),
      client: mockClient(),
      accessToken: TOKEN,
    });

    await expect(store.listAgents({ tenant_id: TENANT }, TXN)).resolves.toBe(agents);
    await expect(store.getAgent({ tenant_id: TENANT, id: 'agent-1' }, TXN)).resolves.toBe(agents[0]);
    expect(listAgents).toHaveBeenCalledWith({ tenant_id: TENANT }, TXN);
    expect(getAgent).toHaveBeenCalledWith({ tenant_id: TENANT, id: 'agent-1' }, TXN);
  });

  it('createAgent inserts locally, puts remote, then sets external_id', async () => {
    const local = record({ external_id: null });
    const linked = record({ external_id: 'sf-1' });
    const putRemoteAgent = jest.fn(async (input: PutRemoteAgentInput) => {
      expect(input).toEqual({
        accessToken: TOKEN,
        name: 'research',
        description: 'Be helpful.',
        model: 'openai-gateway/gpt-5',
        mcp_servers: ['slack'],
      });
      return { externalId: 'sf-1' };
    });
    const createAgent = jest.fn(async () => local);
    const updateAgent = jest.fn(async () => linked);
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ createAgent, updateAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent(
        {
          tenant_id: TENANT,
          created_by_subject: CREATED_BY_SUBJECT,
          name: 'research',
          manifest: manifest({ mcp_servers: [{ name: 'slack' }] }),
          external_id: null,
        },
        TXN,
      ),
    ).resolves.toBe(linked);
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT,
        name: 'research',
        external_id: null,
      }),
      TXN,
    );
    expect(updateAgent).toHaveBeenCalledWith({ tenant_id: TENANT, id: local.id, external_id: 'sf-1' }, TXN);
    expect(firstInvocationOrder(createAgent)).toBeLessThan(firstInvocationOrder(putRemoteAgent));
    expect(firstInvocationOrder(putRemoteAgent)).toBeLessThan(firstInvocationOrder(updateAgent));
  });

  it('createAgent rejects a duplicate local name before calling ServiceFoundry', async () => {
    const createAgent = jest.fn(async () => {
      throw new AgentNameConflictError({ tenant_id: TENANT, name: 'research' });
    });
    const putRemoteAgent = jest.fn();
    const updateAgent = jest.fn();
    const deleteRemoteAgent = jest.fn();
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ createAgent, updateAgent }),
      client: mockClient({ putRemoteAgent, deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent(
        {
          tenant_id: TENANT,
          created_by_subject: CREATED_BY_SUBJECT,
          name: 'research',
          manifest: manifest(),
          external_id: null,
        },
        TXN,
      ),
    ).rejects.toBeInstanceOf(AgentNameConflictError);
    expect(putRemoteAgent).not.toHaveBeenCalled();
    expect(updateAgent).not.toHaveBeenCalled();
    expect(deleteRemoteAgent).not.toHaveBeenCalled();
  });

  it('createAgent uses agent name as description when instructions are omitted', async () => {
    const putRemoteAgent = jest.fn(async (input: PutRemoteAgentInput) => {
      expect(input.description).toBe('research');
      expect(input.mcp_servers).toEqual([]);
      return { externalId: 'sf-1' };
    });
    const createAgent = jest.fn(async () => record({ external_id: null }));
    const updateAgent = jest.fn(async () => record({ external_id: 'sf-1' }));
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ createAgent, updateAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await store.createAgent(
      {
        tenant_id: TENANT,
        created_by_subject: CREATED_BY_SUBJECT,
        name: 'research',
        manifest: AgentSpecSchema.parse({ model: { name: 'openai-gateway/gpt-5' } }),
        external_id: null,
      },
      TXN,
    );
    expect(putRemoteAgent).toHaveBeenCalled();
  });

  it('createAgent deletes the local row when putRemoteAgent fails', async () => {
    const local = record({ external_id: null });
    const createAgent = jest.fn(async () => local);
    const deleteAgent = jest.fn(async () => undefined);
    const updateAgent = jest.fn();
    const putRemoteAgent = jest.fn(async () => {
      throw new Error('sf failed');
    });
    const deleteRemoteAgent = jest.fn();
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ createAgent, updateAgent, deleteAgent }),
      client: mockClient({ putRemoteAgent, deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent(
        {
          tenant_id: TENANT,
          created_by_subject: CREATED_BY_SUBJECT,
          name: 'research',
          manifest: manifest(),
          external_id: null,
        },
        TXN,
      ),
    ).rejects.toThrow('sf failed');
    expect(updateAgent).not.toHaveBeenCalled();
    expect(deleteRemoteAgent).not.toHaveBeenCalled();
    expect(deleteAgent).toHaveBeenCalledWith({ tenant_id: TENANT, id: local.id }, TXN);
  });

  it('createAgent rolls back remote and local when updateAgent fails', async () => {
    const local = record({ external_id: null });
    const createAgent = jest.fn(async () => local);
    const updateAgent = jest.fn(async () => {
      throw new Error('db update failed');
    });
    const deleteAgent = jest.fn(async () => undefined);
    const deleteRemoteAgent = jest.fn(async () => undefined);
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ createAgent, updateAgent, deleteAgent }),
      client: mockClient({ deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent(
        {
          tenant_id: TENANT,
          created_by_subject: CREATED_BY_SUBJECT,
          name: 'research',
          manifest: manifest(),
          external_id: null,
        },
        TXN,
      ),
    ).rejects.toThrow('db update failed');
    expect(deleteRemoteAgent).toHaveBeenCalledWith({ accessToken: TOKEN, externalId: 'sf-1' });
    expect(deleteAgent).toHaveBeenCalledWith({ tenant_id: TENANT, id: local.id }, TXN);
  });

  it('createAgent still throws when cleanup fails', async () => {
    const local = record({ external_id: null });
    const createAgent = jest.fn(async () => local);
    const updateAgent = jest.fn(async () => {
      throw new Error('db update failed');
    });
    const deleteAgent = jest.fn(async () => {
      throw new Error('local cleanup failed');
    });
    const deleteRemoteAgent = jest.fn(async () => {
      throw new Error('remote cleanup failed');
    });
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ createAgent, updateAgent, deleteAgent }),
      client: mockClient({ deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent(
        {
          tenant_id: TENANT,
          created_by_subject: CREATED_BY_SUBJECT,
          name: 'research',
          manifest: manifest(),
          external_id: null,
        },
        TXN,
      ),
    ).rejects.toMatchObject({
      message: 'createAgent failed and cleanup also failed',
      errors: [
        expect.objectContaining({ message: 'db update failed' }),
        expect.objectContaining({ message: 'remote cleanup failed' }),
        expect.objectContaining({ message: 'local cleanup failed' }),
      ],
    });
  });

  it('updateAgent without manifest passes through to the inner store', async () => {
    const updated = record({ external_id: 'sf-agent-1' });
    const updateAgent = jest.fn(async () => updated);
    const putRemoteAgent = jest.fn();
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ updateAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(store.updateAgent({ tenant_id: TENANT, id: 'agent-1', external_id: 'sf-agent-1' })).resolves.toBe(
      updated,
    );
    expect(putRemoteAgent).not.toHaveBeenCalled();
    expect(updateAgent).toHaveBeenCalledWith(
      { tenant_id: TENANT, id: 'agent-1', external_id: 'sf-agent-1' },
      undefined,
    );
  });

  it('updateAgent returns undefined for a missing agent without calling putRemoteAgent', async () => {
    const getAgent = jest.fn(async () => undefined);
    const updateAgent = jest.fn();
    const putRemoteAgent = jest.fn();
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, updateAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.updateAgent({ tenant_id: TENANT, id: 'missing', manifest: manifest({ instructions: 'Updated.' }) }),
    ).resolves.toBeUndefined();
    expect(updateAgent).not.toHaveBeenCalled();
    expect(putRemoteAgent).not.toHaveBeenCalled();
  });

  it('updateAgent reads the agent inside the transaction for manifest updates', async () => {
    const previous = record({ external_id: 'sf-1' });
    const updatedManifest = manifest({ instructions: 'Updated.' });
    const updated = record({ manifest: updatedManifest, external_id: 'sf-1' });
    const getAgent = jest.fn(async () => previous);
    const updateAgent = jest.fn(async () => updated);
    const withTransaction = jest.fn(async fn => fn(TXN));
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, updateAgent, withTransaction }),
      client: mockClient(),
      accessToken: TOKEN,
    });

    await store.updateAgent({ tenant_id: TENANT, id: previous.id, manifest: updatedManifest });
    expect(withTransaction).toHaveBeenCalled();
    expect(getAgent).toHaveBeenCalledWith({ tenant_id: TENANT, id: previous.id }, TXN);
  });

  it('updateAgent puts remote agent then writes manifest when putRemoteAgent returns the same id', async () => {
    const previous = record({ external_id: 'sf-1' });
    const updatedManifest = manifest({ instructions: 'Updated.' });
    const updated = record({ manifest: updatedManifest, external_id: 'sf-1' });
    const getAgent = jest.fn(async () => previous);
    const updateAgent = jest.fn(async () => updated);
    const putRemoteAgent = jest.fn(async () => ({ externalId: 'sf-1' }));
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, updateAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(store.updateAgent({ tenant_id: TENANT, id: previous.id, manifest: updatedManifest })).resolves.toBe(
      updated,
    );
    expect(putRemoteAgent).toHaveBeenCalledTimes(1);
    expect(updateAgent).toHaveBeenCalledTimes(1);
    expect(updateAgent).toHaveBeenCalledWith(
      {
        tenant_id: TENANT,
        id: previous.id,
        manifest: updatedManifest,
      },
      TXN,
    );
    expect(firstInvocationOrder(putRemoteAgent)).toBeLessThan(firstInvocationOrder(updateAgent));
  });

  it('updateAgent puts remote agent then writes manifest and external_id when it changes', async () => {
    const previous = record({ external_id: 'sf-old' });
    const updatedManifest = manifest({ instructions: 'Updated.' });
    const updated = record({ manifest: updatedManifest, external_id: 'sf-new' });
    const getAgent = jest.fn(async () => previous);
    const updateAgent = jest.fn(async () => updated);
    const putRemoteAgent = jest.fn(async () => ({ externalId: 'sf-new' }));
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, updateAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    const result = await store.updateAgent(
      {
        tenant_id: TENANT,
        id: previous.id,
        manifest: updatedManifest,
      },
      TXN,
    );
    expect(result?.external_id).toBe('sf-new');
    expect(updateAgent).toHaveBeenCalledTimes(1);
    expect(updateAgent).toHaveBeenCalledWith(
      {
        tenant_id: TENANT,
        id: previous.id,
        manifest: updatedManifest,
        external_id: 'sf-new',
      },
      TXN,
    );
  });

  it('updateAgent keeps the DB row when putRemoteAgent fails', async () => {
    const previous = record({ external_id: 'sf-old' });
    const getAgent = jest.fn(async () => previous);
    const updateAgent = jest.fn();
    const putRemoteAgent = jest.fn(async () => {
      throw new Error('sf failed');
    });
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, updateAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.updateAgent({ tenant_id: TENANT, id: previous.id, manifest: manifest({ instructions: 'Updated.' }) }),
    ).rejects.toThrow('sf failed');
    expect(updateAgent).not.toHaveBeenCalled();
  });

  it('updateAgent restores ServiceFoundry when the DB write fails', async () => {
    const previous = record({ external_id: 'sf-old' });
    const updatedManifest = manifest({ instructions: 'Updated.' });
    const getAgent = jest.fn(async () => previous);
    const updateAgent = jest.fn(async () => {
      throw new Error('db write failed');
    });
    const putRemoteAgent = jest
      .fn()
      .mockResolvedValueOnce({ externalId: 'sf-new' })
      .mockResolvedValueOnce({ externalId: 'sf-old' });
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, updateAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(store.updateAgent({ tenant_id: TENANT, id: previous.id, manifest: updatedManifest })).rejects.toThrow(
      'db write failed',
    );
    expect(putRemoteAgent).toHaveBeenCalledTimes(2);
    expect(putRemoteAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accessToken: TOKEN,
        name: previous.name,
        description: previous.manifest.instructions ?? previous.name,
        model: previous.manifest.model.name,
      }),
    );
  });

  it('updateAgent still throws when ServiceFoundry restore fails', async () => {
    const previous = record({ external_id: 'sf-old' });
    const getAgent = jest.fn(async () => previous);
    const updateAgent = jest.fn(async () => {
      throw new Error('db write failed');
    });
    const putRemoteAgent = jest
      .fn()
      .mockResolvedValueOnce({ externalId: 'sf-new' })
      .mockRejectedValueOnce(new Error('sf restore failed'));
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, updateAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.updateAgent({ tenant_id: TENANT, id: previous.id, manifest: manifest({ instructions: 'Updated.' }) }),
    ).rejects.toMatchObject({
      message: 'updateAgent failed and ServiceFoundry restore also failed',
      errors: [
        expect.objectContaining({ message: 'db write failed' }),
        expect.objectContaining({ message: 'sf restore failed' }),
      ],
    });
  });

  it('deleteAgent reads the agent inside the transaction', async () => {
    const previous = record({ external_id: 'sf-1' });
    const getAgent = jest.fn(async () => previous);
    const deleteAgent = jest.fn(async () => undefined);
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, deleteAgent }),
      client: mockClient(),
      accessToken: TOKEN,
    });

    await store.deleteAgent({ tenant_id: TENANT, id: previous.id });
    expect(getAgent).toHaveBeenCalledWith({ tenant_id: TENANT, id: previous.id }, TXN);
  });

  it('deleteAgent deletes ServiceFoundry then DB when external_id is set', async () => {
    const previous = record({ external_id: 'sf-1' });
    const getAgent = jest.fn(async () => previous);
    const deleteAgent = jest.fn(async () => undefined);
    const deleteRemoteAgent = jest.fn(async () => undefined);
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, deleteAgent }),
      client: mockClient({ deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await store.deleteAgent({ tenant_id: TENANT, id: previous.id });
    expect(deleteRemoteAgent).toHaveBeenCalledWith({ accessToken: TOKEN, externalId: 'sf-1' });
    expect(deleteAgent).toHaveBeenCalledWith({ tenant_id: TENANT, id: previous.id }, TXN);
    expect(firstInvocationOrder(deleteRemoteAgent)).toBeLessThan(firstInvocationOrder(deleteAgent));
  });

  it('deleteAgent skips ServiceFoundry when external_id is null', async () => {
    const previous = record({ external_id: null });
    const getAgent = jest.fn(async () => previous);
    const deleteAgent = jest.fn(async () => undefined);
    const deleteRemoteAgent = jest.fn();
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, deleteAgent }),
      client: mockClient({ deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await store.deleteAgent({ tenant_id: TENANT, id: previous.id });
    expect(deleteAgent).toHaveBeenCalled();
    expect(deleteRemoteAgent).not.toHaveBeenCalled();
  });

  it('deleteAgent skips ServiceFoundry when the agent is already missing', async () => {
    const getAgent = jest.fn(async () => undefined);
    const deleteAgent = jest.fn(async () => undefined);
    const deleteRemoteAgent = jest.fn();
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, deleteAgent }),
      client: mockClient({ deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await store.deleteAgent({ tenant_id: TENANT, id: 'missing' });
    expect(deleteAgent).toHaveBeenCalledWith({ tenant_id: TENANT, id: 'missing' }, TXN);
    expect(deleteRemoteAgent).not.toHaveBeenCalled();
  });

  it('deleteAgent keeps the DB row when ServiceFoundry delete fails', async () => {
    const previous = record({ external_id: 'sf-1' });
    const getAgent = jest.fn(async () => previous);
    const deleteAgent = jest.fn(async () => undefined);
    const deleteRemoteAgent = jest.fn(async () => {
      throw new Error('sf delete failed');
    });
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, deleteAgent }),
      client: mockClient({ deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(store.deleteAgent({ tenant_id: TENANT, id: previous.id })).rejects.toThrow('sf delete failed');
    expect(deleteRemoteAgent).toHaveBeenCalled();
    expect(deleteAgent).not.toHaveBeenCalled();
  });
});
