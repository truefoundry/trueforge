import type { CreateSkillInput } from '../../../src/db/skillStore';
import { createTrueFoundryRequestContext } from '../../../src/truefoundry/accessToken';
import { TRUEFOUNDRY_MANAGED_MESSAGE, TRUEFOUNDRY_MANAGED_STATUS } from '../../../src/truefoundry/errors';
import { TrueFoundrySkillStore } from '../../../src/truefoundry/TrueFoundrySkillStore';

const TENANT = 'acme';
const ACCESS_TOKEN = 'caller-access-token';
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

function createStore() {
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
  };
  const store = new TrueFoundrySkillStore({
    client,
    context: createTrueFoundryRequestContext({
      tenant_id: TENANT,
      subject: { id: 'user-1', type: 'user', display_name: 'user-1' },
      roles: [],
      user_credential: ACCESS_TOKEN,
    }),
  });
  return { store, client };
}

describe('TrueFoundrySkillStore', () => {
  it('lists registry catalog rows as skill records', async () => {
    const { store, client } = createStore();
    const records = await store.listSkills({ tenant_id: TENANT, names: undefined });
    expect(client.listAgentSkills).toHaveBeenCalledWith(ACCESS_TOKEN);
    expect(records).toHaveLength(1);
    expect(records[0]?.manifest).toEqual({
      type: 'registry',
      name: 'echo',
      description: 'Echo skill',
      id: 'skill-1',
      fqn: 'agent-skill:acme/team-a/echo:3',
      ml_repo_name: 'team-a',
      version: 3,
    });
  });

  it('returns versions and rejects managed writes', async () => {
    const { store, client } = createStore();
    await expect(store.listSkillVersions({ skill_id: 'skill-1' })).resolves.toEqual([
      {
        id: 'ver-1',
        fqn: 'agent-skill:acme/team-a/echo:3',
        name: 'echo',
        description: 'v3',
        version: 3,
      },
    ]);
    expect(client.listAgentSkillVersions).toHaveBeenCalledWith({
      accessToken: ACCESS_TOKEN,
      agentSkillId: 'skill-1',
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
});
