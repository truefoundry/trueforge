/**
 * Backend-agnostic behavioural contract for IAgentStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import { AgentSpecSchema, type AgentSpec, type CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import { AgentExternalIdConflictError, AgentNameConflictError, type IAgentStore } from '../../src/db/agentStore';

const TENANT = 'default';

const CREATED_BY_SUBJECT: CreatedBySubject = {
  subject_id: 'tester',
  subject_type: 'user',
  subject_display_name: 'tester',
};

function manifest(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return AgentSpecSchema.parse({
    model: { name: 'anthropic/claude-sonnet-4-6' },
    instructions: 'Be helpful.',
    ...overrides,
  });
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function runAgentStoreContractSuite(getStore: () => IAgentStore): void {
  it('createAgent allocates an id and round-trips the manifest', async () => {
    const store = getStore();
    const created = await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'research',
      manifest: manifest(),
      external_id: null,
    });

    expect(created.tenant_id).toBe(TENANT);
    expect(created.name).toBe('research');
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.manifest).toEqual(manifest());
    expect(created.external_id).toBeNull();
    expect(created.created_by_subject).toEqual(CREATED_BY_SUBJECT);
    expect(created.created_at).toMatch(ISO_UTC);
    expect(created.updated_at).toBe(created.created_at);

    const byName = await store.getAgent({ tenant_id: TENANT, name: 'research' });
    expect(byName).toEqual(created);

    const byId = await store.getAgent({ tenant_id: TENANT, id: created.id });
    expect(byId).toEqual(created);
  });

  it('getAgent returns undefined for unknown id or name', async () => {
    const store = getStore();
    expect(await store.getAgent({ tenant_id: TENANT, id: 'missing' })).toBeUndefined();
    expect(await store.getAgent({ tenant_id: TENANT, name: 'missing' })).toBeUndefined();
  });

  it('updateAgent by id replaces manifest but keeps id, name, and created_at', async () => {
    const store = getStore();
    const created = await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'research',
      manifest: manifest(),
      external_id: null,
    });

    const replacement = manifest({ instructions: 'Updated instructions.' });
    const updated = await store.updateAgent({
      tenant_id: TENANT,
      id: created.id,
      manifest: replacement,
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        name: 'research',
        manifest: replacement,
        created_at: created.created_at,
      }),
    );
    expect(updated).toBeDefined();
    if (updated === undefined) {
      throw new Error('expected updateAgent to return a record');
    }
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));

    expect(await store.getAgent({ tenant_id: TENANT, name: 'research' })).toEqual(updated);
  });

  it('updateAgent returns undefined for unknown ids', async () => {
    const store = getStore();
    expect(
      await store.updateAgent({
        tenant_id: TENANT,
        id: 'missing',
        manifest: manifest(),
      }),
    ).toBeUndefined();
  });

  it('createAgent throws AgentNameConflictError on name clash', async () => {
    const store = getStore();
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'research',
      manifest: manifest(),
      external_id: null,
    });

    await expect(
      store.createAgent({
        tenant_id: TENANT,
        created_by_subject: CREATED_BY_SUBJECT,
        name: 'research',
        manifest: manifest(),
        external_id: null,
      }),
    ).rejects.toBeInstanceOf(AgentNameConflictError);
  });

  it('listAgents returns only the tenant, ordered by name', async () => {
    const store = getStore();
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'zeta',
      manifest: manifest(),
      external_id: null,
    });
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'alpha',
      manifest: manifest({ instructions: 'Alpha agent.' }),
      external_id: null,
    });
    await store.createAgent({
      tenant_id: 'other-tenant',
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'research',
      manifest: manifest(),
      external_id: null,
    });

    const agents = await store.listAgents({ tenant_id: TENANT, limit: undefined, page_token: undefined });
    expect(agents.data.map(agent => agent.name)).toEqual(['alpha', 'zeta']);
    expect(agents.data.every(agent => agent.tenant_id === TENANT)).toBe(true);
  });

  it('listAgents can filter by external_ids', async () => {
    const store = getStore();
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'local-only',
      manifest: manifest(),
      external_id: null,
    });
    const linked = await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'linked',
      manifest: manifest(),
      external_id: 'sf-agent-1',
    });
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'other-linked',
      manifest: manifest(),
      external_id: 'sf-agent-2',
    });

    expect(
      await store.listAgents({
        tenant_id: TENANT,
        external_ids: ['sf-agent-1'],
        limit: undefined,
        page_token: undefined,
      }),
    ).toEqual({ data: [linked], pagination: { limit: 1 } });
    expect(
      (
        await store.listAgents({
          tenant_id: TENANT,
          external_ids: ['sf-agent-1', 'sf-agent-2'],
          limit: undefined,
          page_token: undefined,
        })
      ).data.map(agent => agent.name),
    ).toEqual(['linked', 'other-linked']);
    expect(
      await store.listAgents({
        tenant_id: TENANT,
        external_ids: ['missing'],
        limit: undefined,
        page_token: undefined,
      }),
    ).toEqual({ data: [], pagination: { limit: 0 } });
    expect(
      await store.listAgents({
        tenant_id: TENANT,
        external_ids: [],
        limit: undefined,
        page_token: undefined,
      }),
    ).toEqual({ data: [], pagination: { limit: 0 } });
  });

  it('listAgents paginates with limit and page_token in name order', async () => {
    const store = getStore();
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'charlie',
      manifest: manifest(),
      external_id: null,
    });
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'alpha',
      manifest: manifest(),
      external_id: null,
    });
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'bravo',
      manifest: manifest(),
      external_id: null,
    });

    const page1 = await store.listAgents({ tenant_id: TENANT, limit: 2, page_token: undefined });
    expect(page1.data.map(agent => agent.name)).toEqual(['alpha', 'bravo']);
    expect(page1.pagination.limit).toBe(2);
    expect(page1.pagination.next_page_token).toEqual(expect.any(String));

    const page2 = await store.listAgents({
      tenant_id: TENANT,
      limit: 2,
      page_token: page1.pagination.next_page_token,
    });
    expect(page2.data.map(agent => agent.name)).toEqual(['charlie']);
    expect(page2.pagination.previous_page_token).toEqual(expect.any(String));
    expect(page2.pagination.next_page_token).toBeUndefined();
  });

  it('getAgent by id is tenant-scoped', async () => {
    const store = getStore();
    const created = await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'research',
      manifest: manifest(),
      external_id: null,
    });

    expect(await store.getAgent({ tenant_id: 'other-tenant', id: created.id })).toBeUndefined();
  });

  it('createAgent persists external_id', async () => {
    const store = getStore();
    const created = await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'research',
      manifest: manifest(),
      external_id: 'sf-agent-1',
    });
    expect(created.external_id).toBe('sf-agent-1');
    expect(await store.getAgent({ tenant_id: TENANT, id: created.id })).toEqual(created);
  });

  it('createAgent unique external_id within a tenant; nulls and other tenants do not collide', async () => {
    const store = getStore();
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'alpha',
      manifest: manifest(),
      external_id: 'shared-key',
    });
    await expect(
      store.createAgent({
        tenant_id: TENANT,
        created_by_subject: CREATED_BY_SUBJECT,
        name: 'beta',
        manifest: manifest(),
        external_id: 'shared-key',
      }),
    ).rejects.toBeInstanceOf(AgentExternalIdConflictError);
    await store.createAgent({
      tenant_id: 'other-tenant',
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'alpha',
      manifest: manifest(),
      external_id: 'shared-key',
    });
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'gamma',
      manifest: manifest(),
      external_id: null,
    });
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'delta',
      manifest: manifest(),
      external_id: null,
    });
  });

  it('updateAgent can write and clear external_id', async () => {
    const store = getStore();
    const created = await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'research',
      manifest: manifest(),
      external_id: null,
    });
    const updated = await store.updateAgent({
      tenant_id: TENANT,
      id: created.id,
      external_id: 'sf-agent-1',
    });
    expect(updated?.external_id).toBe('sf-agent-1');
    const cleared = await store.updateAgent({
      tenant_id: TENANT,
      id: created.id,
      external_id: null,
    });
    expect(cleared?.external_id).toBeNull();
  });

  it('updateAgent throws AgentExternalIdConflictError when external_id is taken', async () => {
    const store = getStore();
    await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'alpha',
      manifest: manifest(),
      external_id: 'shared-key',
    });
    const beta = await store.createAgent({
      tenant_id: TENANT,
      created_by_subject: CREATED_BY_SUBJECT,
      name: 'beta',
      manifest: manifest(),
      external_id: null,
    });
    await expect(
      store.updateAgent({ tenant_id: TENANT, id: beta.id, external_id: 'shared-key' }),
    ).rejects.toBeInstanceOf(AgentExternalIdConflictError);
  });
}
