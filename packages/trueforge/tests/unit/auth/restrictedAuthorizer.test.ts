import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { TrueForgeAuthorizer } from '../../../src/auth/authorizer';
import type { RequestContext } from '../../../src/auth/identity';
import type { AgentRecord } from '../../../src/db/agentStore';

const RESTRICTED_ROLE = 'restricted-group';
const SPEC = AgentSpecSchema.parse({ model: { name: 'anthropic/claude-sonnet-4-6' }, instructions: 'x' });

function context({ id, roles }: { id: string; roles: string[] }): RequestContext {
  return {
    tenant_id: 'default',
    subject: { id, type: 'user', display_name: id },
    roles,
    user_credential: null,
  };
}

function agent({ name, owner }: { name: string; owner: string }): AgentRecord {
  return {
    id: `id-${name}`,
    tenant_id: 'default',
    name,
    description: 'Test agent.',
    manifest: SPEC,
    external_id: null,
    created_by_subject: { subject_id: owner, subject_type: 'user', subject_display_name: owner },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const RESTRICTED = context({ id: 'rita', roles: [RESTRICTED_ROLE] });
// Standalone-mode tests: the admin role is the literal `admin`.
const RESTRICTED_ADMIN = context({ id: 'root', roles: [RESTRICTED_ROLE, 'admin'] });
const REGULAR = context({ id: 'bob', roles: ['other'] });

describe('TrueForgeAuthorizer restricted role', () => {
  const authorizer = new TrueForgeAuthorizer({
    restrictedRoleValue: RESTRICTED_ROLE,
    restrictedAgentNames: ['allowed-agent'],
  });

  it('limits listing to the allowed names for read/use and to nothing for manage/delete', async () => {
    expect(await authorizer.listAgentAccess({ context: RESTRICTED, action: 'read' })).toEqual({
      kind: 'agent_names',
      agent_names: ['allowed-agent'],
    });
    expect(await authorizer.listAgentAccess({ context: RESTRICTED, action: 'use' })).toEqual({
      kind: 'agent_names',
      agent_names: ['allowed-agent'],
    });
    for (const action of ['manage', 'delete'] as const) {
      expect(await authorizer.listAgentAccess({ context: RESTRICTED, action })).toEqual({
        kind: 'agent_external_ids',
        agent_external_ids: [],
      });
    }
  });

  it('allows read/use only on allowed agents', async () => {
    const allowed = agent({ name: 'allowed-agent', owner: 'carol' });
    const other = agent({ name: 'other-agent', owner: 'carol' });
    for (const action of ['read', 'use'] as const) {
      expect(await authorizer.canAccessAgent({ context: RESTRICTED, action, agent: allowed })).toBe(true);
      expect(await authorizer.canAccessAgent({ context: RESTRICTED, action, agent: other })).toBe(false);
    }
    expect(await authorizer.canAccessAgent({ context: RESTRICTED, action: 'manage', agent: allowed })).toBe(false);
    expect(await authorizer.canAccessAgent({ context: RESTRICTED, action: 'delete', agent: allowed })).toBe(false);
  });

  it('keeps the creator rule for manage', async () => {
    const own = agent({ name: 'other-agent', owner: 'rita' });
    expect(await authorizer.canAccessAgent({ context: RESTRICTED, action: 'manage', agent: own })).toBe(true);
  });

  it('removes create-agent and create-sandbox-environment tenant permissions', async () => {
    const result = await authorizer.getPermissions({
      resourceType: 'tenant',
      requestContext: RESTRICTED,
      resourceIds: [],
    });
    expect(result).toEqual({ type: 'tenant', permissions: { agent: [], sandbox_environment: [] } });
    const regular = await authorizer.getPermissions({
      resourceType: 'tenant',
      requestContext: REGULAR,
      resourceIds: [],
    });
    expect(regular).toEqual({ type: 'tenant', permissions: { agent: ['CREATE'], sandbox_environment: [] } });
  });

  it('denies authoring (inline agents, agents, schedules)', async () => {
    expect(await authorizer.canAuthorWork({ context: RESTRICTED })).toBe(false);
  });

  it('leaves admins, even with the restricted role, unchanged', async () => {
    const other = agent({ name: 'other-agent', owner: 'carol' });
    expect(await authorizer.listAgentAccess({ context: RESTRICTED_ADMIN, action: 'read' })).toEqual({ kind: 'all' });
    expect(await authorizer.canAccessAgent({ context: RESTRICTED_ADMIN, action: 'use', agent: other })).toBe(true);
    expect(await authorizer.canAuthorWork({ context: RESTRICTED_ADMIN })).toBe(true);
  });

  it('leaves callers without the restricted role unchanged', async () => {
    const other = agent({ name: 'other-agent', owner: 'carol' });
    expect(await authorizer.listAgentAccess({ context: REGULAR, action: 'read' })).toEqual({ kind: 'all' });
    expect(await authorizer.canAccessAgent({ context: REGULAR, action: 'use', agent: other })).toBe(true);
    expect(await authorizer.canAuthorWork({ context: REGULAR })).toBe(true);
  });

  it('is off when no restricted role is configured', async () => {
    const off = new TrueForgeAuthorizer();
    expect(await off.listAgentAccess({ context: RESTRICTED, action: 'read' })).toEqual({ kind: 'all' });
    expect(await off.canAuthorWork({ context: RESTRICTED })).toBe(true);
    const empty = new TrueForgeAuthorizer({ restrictedRoleValue: '', restrictedAgentNames: ['x'] });
    expect(await empty.canAuthorWork({ context: context({ id: 'a', roles: [''] }) })).toBe(true);
  });

  it('shows an empty list when the restricted allowlist is empty', async () => {
    const none = new TrueForgeAuthorizer({ restrictedRoleValue: RESTRICTED_ROLE });
    expect(await none.listAgentAccess({ context: RESTRICTED, action: 'read' })).toEqual({
      kind: 'agent_names',
      agent_names: [],
    });
  });
});
