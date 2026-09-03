import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';

import type { AgentRecord, IAgentStore } from '../../../src/db/agentStore';
import { AgentNameConflictError, AgentNameReservedError } from '../../../src/db/agentStore';
import { TrueFoundryAgentStore } from '../../../src/truefoundry/TrueFoundryAgentStore';
import {
  TrueFoundryServiceFoundryServerClient,
  type DeleteRemoteAgentInput,
  type PutRemoteAgentInput,
  type PutRemoteAgentResult,
} from '../../../src/truefoundry/TrueFoundryServiceFoundryServerClient';

const TENANT = 'default';
const TOKEN = 'test-token';

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
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function mockInner(overrides: Partial<IAgentStore> = {}): IAgentStore {
  return {
    listAgents: jest.fn(),
    getAgent: jest.fn(),
    createAgent: jest.fn(),
    updateAgent: jest.fn(),
    deleteAgent: jest.fn(),
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
  });
  client.putRemoteAgent =
    overrides.putRemoteAgent ?? (async (): Promise<PutRemoteAgentResult> => ({ remoteAgentId: 'sf-1' }));
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

    await expect(store.listAgents({ tenant_id: TENANT })).resolves.toBe(agents);
    await expect(store.getAgent({ tenant_id: TENANT, id: 'agent-1' })).resolves.toBe(agents[0]);
    expect(listAgents).toHaveBeenCalledWith({ tenant_id: TENANT }, undefined);
    expect(getAgent).toHaveBeenCalledWith({ tenant_id: TENANT, id: 'agent-1' }, undefined);
  });

  it('createAgent puts then inserts with external_id', async () => {
    const created = record({ external_id: 'sf-1' });
    const putRemoteAgent = jest.fn(async (input: PutRemoteAgentInput) => {
      expect(input).toEqual({
        accessToken: TOKEN,
        name: 'research',
        description: 'Be helpful.',
        model: 'openai-gateway/gpt-5',
        mcp_servers: ['slack'],
      });
      return { remoteAgentId: 'sf-1' };
    });
    const getAgent = jest.fn(async () => undefined);
    const createAgent = jest.fn(async () => created);
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, createAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent({
        tenant_id: TENANT,
        name: 'research',
        manifest: manifest({ mcp_servers: [{ name: 'slack' }] }),
        external_id: null,
      }),
    ).resolves.toBe(created);
    expect(getAgent).toHaveBeenCalledWith({ tenant_id: TENANT, name: 'research' }, undefined);
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT,
        name: 'research',
        external_id: 'sf-1',
      }),
      undefined,
    );
  });

  it('createAgent rejects a duplicate local name before calling ServiceFoundry', async () => {
    const getAgent = jest.fn(async () => record({ external_id: 'sf-existing' }));
    const createAgent = jest.fn();
    const putRemoteAgent = jest.fn();
    const deleteRemoteAgent = jest.fn();
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, createAgent }),
      client: mockClient({ putRemoteAgent, deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent({ tenant_id: TENANT, name: 'research', manifest: manifest(), external_id: null }),
    ).rejects.toMatchObject({ name: 'AgentNameConflictError' });
    expect(putRemoteAgent).not.toHaveBeenCalled();
    expect(createAgent).not.toHaveBeenCalled();
    expect(deleteRemoteAgent).not.toHaveBeenCalled();
  });

  it('createAgent rejects reserved names before calling ServiceFoundry', async () => {
    const getAgent = jest.fn();
    const createAgent = jest.fn();
    const putRemoteAgent = jest.fn();
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, createAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent({ tenant_id: TENANT, name: 'tfg', manifest: manifest(), external_id: null }),
    ).rejects.toBeInstanceOf(AgentNameReservedError);
    await expect(
      store.createAgent({ tenant_id: TENANT, name: 'trueforge', manifest: manifest(), external_id: null }),
    ).rejects.toBeInstanceOf(AgentNameReservedError);
    expect(getAgent).not.toHaveBeenCalled();
    expect(putRemoteAgent).not.toHaveBeenCalled();
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('createAgent uses agent name as description when instructions are omitted', async () => {
    const putRemoteAgent = jest.fn(async (input: PutRemoteAgentInput) => {
      expect(input.description).toBe('research');
      return { remoteAgentId: 'sf-1' };
    });
    const createAgent = jest.fn(async () => record({ external_id: 'sf-1' }));
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ createAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await store.createAgent({
      tenant_id: TENANT,
      name: 'research',
      manifest: AgentSpecSchema.parse({ model: { name: 'openai-gateway/gpt-5' } }),
      external_id: null,
    });
    expect(putRemoteAgent).toHaveBeenCalled();
  });

  it('createAgent rolls back SF when DB insert fails', async () => {
    const deleteRemoteAgent = jest.fn(async () => undefined);
    const createAgent = jest.fn(async () => {
      throw new Error('db failed');
    });
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ createAgent }),
      client: mockClient({ deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent({ tenant_id: TENANT, name: 'research', manifest: manifest(), external_id: null }),
    ).rejects.toThrow('db failed');
    expect(deleteRemoteAgent).toHaveBeenCalledWith({ accessToken: TOKEN, remoteAgentId: 'sf-1' });
  });

  it('createAgent does not delete remote on local name conflict after put', async () => {
    const deleteRemoteAgent = jest.fn();
    const createAgent = jest.fn(async () => {
      throw new AgentNameConflictError({ tenant_id: TENANT, name: 'research' });
    });
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ createAgent }),
      client: mockClient({ deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent({ tenant_id: TENANT, name: 'research', manifest: manifest(), external_id: null }),
    ).rejects.toBeInstanceOf(AgentNameConflictError);
    expect(deleteRemoteAgent).not.toHaveBeenCalled();
  });

  it('createAgent still throws when SF rollback fails', async () => {
    const deleteRemoteAgent = jest.fn(async () => {
      throw new Error('cleanup failed');
    });
    const createAgent = jest.fn(async () => {
      throw new Error('db failed');
    });
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ createAgent }),
      client: mockClient({ deleteRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent({ tenant_id: TENANT, name: 'research', manifest: manifest(), external_id: null }),
    ).rejects.toMatchObject({
      message: 'createAgent failed and ServiceFoundry cleanup also failed',
      errors: [
        expect.objectContaining({ message: 'db failed' }),
        expect.objectContaining({ message: 'cleanup failed' }),
      ],
    });
    expect(deleteRemoteAgent).toHaveBeenCalledWith({ accessToken: TOKEN, remoteAgentId: 'sf-1' });
  });

  it('createAgent does not insert when putRemoteAgent fails', async () => {
    const createAgent = jest.fn();
    const putRemoteAgent = jest.fn(async () => {
      throw new Error('sf failed');
    });
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ createAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    await expect(
      store.createAgent({ tenant_id: TENANT, name: 'research', manifest: manifest(), external_id: null }),
    ).rejects.toThrow('sf failed');
    expect(createAgent).not.toHaveBeenCalled();
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

  it('updateAgent puts remote agent then writes manifest when putRemoteAgent returns the same id', async () => {
    const previous = record({ external_id: 'sf-1' });
    const updatedManifest = manifest({ instructions: 'Updated.' });
    const updated = record({ manifest: updatedManifest, external_id: 'sf-1' });
    const getAgent = jest.fn(async () => previous);
    const updateAgent = jest.fn(async () => updated);
    const putRemoteAgent = jest.fn(async () => ({ remoteAgentId: 'sf-1' }));
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
      undefined,
    );
    expect(firstInvocationOrder(putRemoteAgent)).toBeLessThan(firstInvocationOrder(updateAgent));
  });

  it('updateAgent puts remote agent then writes manifest and external_id when it changes', async () => {
    const previous = record({ external_id: 'sf-old' });
    const updatedManifest = manifest({ instructions: 'Updated.' });
    const updated = record({ manifest: updatedManifest, external_id: 'sf-new' });
    const getAgent = jest.fn(async () => previous);
    const updateAgent = jest.fn(async () => updated);
    const putRemoteAgent = jest.fn(async () => ({ remoteAgentId: 'sf-new' }));
    const store = new TrueFoundryAgentStore({
      inner: mockInner({ getAgent, updateAgent }),
      client: mockClient({ putRemoteAgent }),
      accessToken: TOKEN,
    });

    const result = await store.updateAgent({
      tenant_id: TENANT,
      id: previous.id,
      manifest: updatedManifest,
    });
    expect(result?.external_id).toBe('sf-new');
    expect(updateAgent).toHaveBeenCalledTimes(1);
    expect(updateAgent).toHaveBeenCalledWith(
      {
        tenant_id: TENANT,
        id: previous.id,
        manifest: updatedManifest,
        external_id: 'sf-new',
      },
      undefined,
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
      .mockResolvedValueOnce({ remoteAgentId: 'sf-new' })
      .mockResolvedValueOnce({ remoteAgentId: 'sf-old' });
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
      .mockResolvedValueOnce({ remoteAgentId: 'sf-new' })
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
    expect(deleteRemoteAgent).toHaveBeenCalledWith({ accessToken: TOKEN, remoteAgentId: 'sf-1' });
    expect(deleteAgent).toHaveBeenCalledWith({ tenant_id: TENANT, id: previous.id }, undefined);
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
    expect(deleteAgent).toHaveBeenCalledWith({ tenant_id: TENANT, id: 'missing' }, undefined);
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
