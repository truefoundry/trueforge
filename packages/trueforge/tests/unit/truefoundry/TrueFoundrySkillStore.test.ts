import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';
import type { AgentRecord } from '../../../src/db/agentStore';
import type { CreateSkillInput } from '../../../src/db/skillStore';
import { createTrueFoundryRequestContext } from '../../../src/truefoundry/accessToken';
import { TRUEFOUNDRY_MANAGED_MESSAGE, TRUEFOUNDRY_MANAGED_STATUS } from '../../../src/truefoundry/errors';
import { TrueFoundrySkillStore } from '../../../src/truefoundry/TrueFoundrySkillStore';

const TENANT = 'acme';
const ACCESS_TOKEN = 'caller-access-token';
const AGENT_TOKEN = 'agent-vend-token';
const LOGGER = createLogger({ silent: true });
const SFY_SKILL = {
  id: 'skill-1',
  name: 'echo',
  latest_version: {
    id: 'ver-1',
    fqn: 'agent-skill:acme/team-a/echo:3',
    manifest: {
      name: 'echo',
      type: 'agent-skill',
      version: 3,
      ml_repo: 'team-a',
      source: { type: 'blob-storage', description: 'Echo skill' },
    },
  },
};

const AGENT: AgentRecord = {
  id: 'agent-1',
  tenant_id: TENANT,
  name: 'named',
  manifest: AgentSpecSchema.parse({ model: { name: 'p/m' } }),
  external_id: 'ext-agent',
  created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function createStore(
  agent: AgentRecord | undefined = undefined,
  versions: unknown[] = [
    {
      id: 'ver-3',
      fqn: 'agent-skill:acme/team-a/echo:3',
      manifest: {
        name: 'echo',
        type: 'agent-skill',
        version: 3,
        ml_repo: 'team-a',
        source: { type: 'blob-storage', description: 'v3' },
      },
    },
  ],
) {
  const client = {
    listAgentSkills: jest.fn().mockResolvedValue([SFY_SKILL]),
    listAgentSkillVersions: jest.fn().mockResolvedValue(versions),
    vendToken: jest.fn().mockResolvedValue(AGENT_TOKEN),
    resolveAgentSkillVersions: jest.fn(),
    apiKey: 'tfy-api-key',
  };
  const store = new TrueFoundrySkillStore({
    client,
    context: createTrueFoundryRequestContext({
      tenant_id: TENANT,
      subject: { id: 'user-1', type: 'user', display_name: 'user-1' },
      roles: [],
      user_credential: ACCESS_TOKEN,
    }),
    agent,
    logger: LOGGER,
  });
  return { store, client };
}

describe('TrueFoundrySkillStore', () => {
  it('lists registry catalog rows as skill records with the caller token', async () => {
    const { store, client } = createStore();
    const records = await store.listSkills({ tenant_id: TENANT, names: undefined });
    expect(client.listAgentSkills).toHaveBeenCalledWith(ACCESS_TOKEN);
    expect(client.vendToken).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0]?.name).toBe('agent-skill:acme/team-a/echo:3');
    expect(records[0]?.manifest).toEqual({
      type: 'registry',
      name: 'agent-skill:acme/team-a/echo:3',
      display_name: 'echo',
      description: 'Echo skill',
      skill_repo_name: 'team-a',
      version: 3,
    });
  });

  it('listSkills uses latest_version only (not every historic version)', async () => {
    const { store } = createStore();
    const records = await store.listSkills({ tenant_id: TENANT, names: undefined });
    expect(records.map(r => (r.manifest.type === 'registry' ? r.manifest.version : undefined))).toEqual([3]);
    expect(records.map(r => r.name)).toEqual(['agent-skill:acme/team-a/echo:3']);
  });

  it('uses a vend token when listing as a saved agent', async () => {
    const { store, client } = createStore(AGENT);
    await store.listSkills({ tenant_id: TENANT, names: undefined });
    expect(client.vendToken).toHaveBeenCalledWith({
      subject: { id: 'user-1', type: 'user', display_name: 'user-1' },
      agentId: 'ext-agent',
      tenantName: TENANT,
    });
    expect(client.listAgentSkills).toHaveBeenCalledWith(AGENT_TOKEN);
  });

  it('uses a vend token for skill versions when listing as a saved agent', async () => {
    const { store, client } = createStore(AGENT);
    await store.listSkillVersions({ name: 'agent-skill:acme/team-a/echo:3' });
    expect(client.listAgentSkillVersions).toHaveBeenCalledWith({
      accessToken: AGENT_TOKEN,
      fqn: 'agent-skill:acme/team-a/echo:3',
    });
  });

  it('listSkillVersions returns every SFY version row', async () => {
    const { store } = createStore(undefined, [
      {
        id: 'ver-1',
        fqn: 'agent-skill:acme/team-a/echo:1',
        manifest: {
          name: 'echo',
          type: 'agent-skill',
          version: 1,
          ml_repo: 'team-a',
          source: { type: 'blob-storage', description: 'v1' },
        },
      },
      {
        id: 'ver-2',
        fqn: 'agent-skill:acme/team-a/echo:2',
        manifest: {
          name: 'echo',
          type: 'agent-skill',
          version: 2,
          ml_repo: 'team-a',
          source: { type: 'blob-storage', description: 'v2' },
        },
      },
      {
        id: 'ver-3',
        fqn: 'agent-skill:acme/team-a/echo:3',
        manifest: {
          name: 'echo',
          type: 'agent-skill',
          version: 3,
          ml_repo: 'team-a',
          source: { type: 'blob-storage', description: 'v3' },
        },
      },
    ]);
    await expect(store.listSkillVersions({ name: 'agent-skill:acme/team-a/echo:3' })).resolves.toEqual([
      {
        name: 'agent-skill:acme/team-a/echo:1',
        display_name: 'echo',
        description: 'v1',
        version: 1,
      },
      {
        name: 'agent-skill:acme/team-a/echo:2',
        display_name: 'echo',
        description: 'v2',
        version: 2,
      },
      {
        name: 'agent-skill:acme/team-a/echo:3',
        display_name: 'echo',
        description: 'v3',
        version: 3,
      },
    ]);
  });

  it('returns versions by FQN and rejects managed writes', async () => {
    const { store, client } = createStore();
    await expect(store.listSkillVersions({ name: 'agent-skill:acme/team-a/echo:3' })).resolves.toEqual([
      {
        name: 'agent-skill:acme/team-a/echo:3',
        display_name: 'echo',
        description: 'v3',
        version: 3,
      },
    ]);
    expect(client.listAgentSkillVersions).toHaveBeenCalledWith({
      accessToken: ACCESS_TOKEN,
      fqn: 'agent-skill:acme/team-a/echo:3',
    });
    const input: CreateSkillInput = {
      tenant_id: TENANT,
      name: 'echo',
      manifest: {
        type: 'git',
        name: 'echo',
        description: 'Echo',
        url: 'https://github.com/acme/echo',
        ref: 'main',
      },
    };
    for (const write of [() => store.createSkill(input), () => store.upsertSkill(input)]) {
      try {
        write();
        throw new Error('expected managed HTTPException');
      } catch (error) {
        expect(error).toMatchObject({
          status: TRUEFOUNDRY_MANAGED_STATUS,
          message: TRUEFOUNDRY_MANAGED_MESSAGE,
        });
      }
    }
  });

  it('listSkills matches AgentSpec refs by registry FQN', async () => {
    const { store } = createStore();
    const records = await store.listSkills({
      tenant_id: TENANT,
      names: ['agent-skill:acme/team-a/echo:3'],
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.name).toBe('agent-skill:acme/team-a/echo:3');
  });

  it('validateAgentSkills uses the caller token on resolve', async () => {
    const { store, client } = createStore();
    client.resolveAgentSkillVersions.mockResolvedValue([
      {
        fqn: 'agent-skill:acme/team-a/echo:3',
        name: 'echo',
        description: 'Echo skill',
      },
    ]);
    await store.validateAgentSkills({
      tenant_id: TENANT,
      skills: [{ name: 'agent-skill:acme/team-a/echo:3', preload: false }],
    });
    expect(client.resolveAgentSkillVersions).toHaveBeenCalledWith({
      accessToken: ACCESS_TOKEN,
      skills: [{ fqn: 'agent-skill:acme/team-a/echo:3' }],
    });
  });

  it('resolveTurnSkills passes the service API key', async () => {
    const { store, client } = createStore();
    client.resolveAgentSkillVersions.mockResolvedValue([
      {
        fqn: 'agent-skill:acme/team-a/echo:3',
        name: 'echo',
        description: 'Echo skill',
        skill_md_content: '# Echo',
        presigned_url: 'https://example.com/echo.tgz',
      },
    ]);
    await expect(
      store.resolveTurnSkills({
        tenant_id: TENANT,
        skills: [{ name: 'agent-skill:acme/team-a/echo:3', preload: true }],
      }),
    ).resolves.toEqual([
      {
        type: 'registry',
        name: 'echo',
        description: 'Echo skill',
        fqn: 'agent-skill:acme/team-a/echo:3',
        preload: true,
        skillMdContent: '# Echo',
        presignedUrl: 'https://example.com/echo.tgz',
      },
    ]);
    expect(client.resolveAgentSkillVersions).toHaveBeenCalledWith({
      accessToken: 'tfy-api-key',
      skills: [
        {
          fqn: 'agent-skill:acme/team-a/echo:3',
          include_skill_md_content: true,
          include_presigned_url: true,
        },
      ],
    });
  });
});
