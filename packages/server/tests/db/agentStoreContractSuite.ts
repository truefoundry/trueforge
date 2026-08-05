/**
 * Backend-agnostic behavioural contract for IAgentStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import type { AgentSpec } from '@truefoundry/utils-core/agent-session';
import { AgentNameConflictError, type IAgentStore } from '../../src/db/agentStore';

const TENANT = 'default';

function manifest(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    model: { name: 'anthropic/claude-sonnet-4-6' },
    instructions: 'Be helpful.',
    ...overrides,
  };
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function runAgentStoreContractSuite(getStore: () => IAgentStore): void {
  it('createAgent allocates an id and round-trips the manifest', async () => {
    const store = getStore();
    const created = await store.createAgent({
      tenant_id: TENANT,
      name: 'research',
      manifest: manifest(),
    });

    expect(created.tenant_id).toBe(TENANT);
    expect(created.name).toBe('research');
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.manifest).toEqual(manifest());
    expect(created.created_at).toMatch(ISO_UTC);
    expect(created.updated_at).toBe(created.created_at);

    const byName = await store.getAgentByName({ tenant_id: TENANT, name: 'research' });
    expect(byName).toEqual(created);

    const byId = await store.getAgentById({ tenant_id: TENANT, id: created.id });
    expect(byId).toEqual(created);
  });

  it('getAgentById and getAgentByName return undefined for unknown agents', async () => {
    const store = getStore();
    expect(await store.getAgentById({ tenant_id: TENANT, id: 'missing' })).toBeUndefined();
    expect(await store.getAgentByName({ tenant_id: TENANT, name: 'missing' })).toBeUndefined();
  });

  it('updateAgent can patch name and/or manifest, preserves id and created_at', async () => {
    const store = getStore();
    const created = await store.createAgent({
      tenant_id: TENANT,
      name: 'research',
      manifest: manifest(),
    });

    const renamed = await store.updateAgent({
      tenant_id: TENANT,
      id: created.id,
      name: 'research-v2',
    });
    expect(renamed).toEqual(
      expect.objectContaining({
        id: created.id,
        name: 'research-v2',
        manifest: created.manifest,
        created_at: created.created_at,
      }),
    );

    const replacement = manifest({ instructions: 'Updated instructions.' });
    const updated = await store.updateAgent({
      tenant_id: TENANT,
      id: created.id,
      manifest: replacement,
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        name: 'research-v2',
        manifest: replacement,
        created_at: created.created_at,
      }),
    );
    expect(updated).toBeDefined();
    if (updated === undefined) {
      throw new Error('expected updateAgent to return a record');
    }
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));

    expect(await store.getAgentByName({ tenant_id: TENANT, name: 'research' })).toBeUndefined();
    expect(await store.getAgentByName({ tenant_id: TENANT, name: 'research-v2' })).toEqual(updated);
  });

  it('updateAgent returns undefined for unknown ids', async () => {
    const store = getStore();
    expect(
      await store.updateAgent({
        tenant_id: TENANT,
        id: 'missing',
        name: 'research',
        manifest: manifest(),
      }),
    ).toBeUndefined();
  });

  it('createAgent and updateAgent throw AgentNameConflictError on name clash', async () => {
    const store = getStore();
    await store.createAgent({ tenant_id: TENANT, name: 'research', manifest: manifest() });
    const other = await store.createAgent({
      tenant_id: TENANT,
      name: 'other',
      manifest: manifest({ instructions: 'Other agent.' }),
    });

    await expect(
      store.createAgent({ tenant_id: TENANT, name: 'research', manifest: manifest() }),
    ).rejects.toBeInstanceOf(AgentNameConflictError);

    await expect(
      store.updateAgent({
        tenant_id: TENANT,
        id: other.id,
        name: 'research',
        manifest: manifest(),
      }),
    ).rejects.toBeInstanceOf(AgentNameConflictError);
  });

  it('listAgents returns only the tenant, ordered by name', async () => {
    const store = getStore();
    await store.createAgent({ tenant_id: TENANT, name: 'zeta', manifest: manifest() });
    await store.createAgent({
      tenant_id: TENANT,
      name: 'alpha',
      manifest: manifest({ instructions: 'Alpha agent.' }),
    });
    await store.createAgent({ tenant_id: 'other-tenant', name: 'research', manifest: manifest() });

    const agents = await store.listAgents(TENANT);
    expect(agents.map(agent => agent.name)).toEqual(['alpha', 'zeta']);
    expect(agents.every(agent => agent.tenant_id === TENANT)).toBe(true);
  });

  it('getAgentById is tenant-scoped', async () => {
    const store = getStore();
    const created = await store.createAgent({
      tenant_id: TENANT,
      name: 'research',
      manifest: manifest(),
    });

    expect(await store.getAgentById({ tenant_id: 'other-tenant', id: created.id })).toBeUndefined();
  });
}
