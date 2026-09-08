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

function createStore(agent: AgentRecord | undefined = undefined) {
  const client = {
    listAgentSkills: jest.fn().mockResolvedValue([SFY_SKILL]),
    listAgentSkillVersions: jest.fn().mockResolvedValue([
      {
        id: 'ver-1',
        fqn: 'agent-skill:acme/team-a/echo:3',
        manifest: {
          name: 'echo',
          type: 'agent-skill',
          version: 3,
          ml_repo: 'team-a',
          source: { type: 'blob-storage', description: 'v3' },
        },
      },
    ]),
    vendToken: jest.fn().mockResolvedValue(AGENT_TOKEN),
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
      name: 'echo',
      description: 'Echo skill',
      fqn: 'agent-skill:acme/team-a/echo:3',
      skill_repo_name: 'team-a',
      version: 3,
    });
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

  it('returns versions by FQN and rejects managed writes', async () => {
    const { store, client } = createStore();
    await expect(store.listSkillVersions({ name: 'agent-skill:acme/team-a/echo:3' })).resolves.toEqual([
      {
        fqn: 'agent-skill:acme/team-a/echo:3',
        name: 'echo',
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
});
