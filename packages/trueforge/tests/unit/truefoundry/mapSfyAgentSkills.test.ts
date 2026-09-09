import { mapSfyRegistrySkills, mapSfyRegistrySkillVersions } from '../../../src/truefoundry/mapSfyAgentSkills';

const MANIFEST = {
  name: 'echo',
  type: 'agent-skill',
  version: 3,
  ml_repo: 'team-a',
  source: { type: 'blob-storage', description: 'Echo skill' },
};

describe('mapSfyRegistrySkills', () => {
  it('maps list rows with name=FQN and display_name=short SFY name', () => {
    expect(
      mapSfyRegistrySkills([
        {
          id: 'skill-1',
          name: 'echo',
          latest_version: {
            id: 'ver-1',
            fqn: 'agent-skill:acme/team-a/echo:3',
            manifest: MANIFEST,
          },
        },
      ]),
    ).toEqual([
      {
        name: 'agent-skill:acme/team-a/echo:3',
        display_name: 'echo',
        description: 'Echo skill',
        skill_repo_name: 'team-a',
        version: 3,
      },
    ]);
  });

  it('maps version rows with name=FQN and display_name=short SFY name', () => {
    expect(
      mapSfyRegistrySkillVersions([
        {
          id: 'ver-1',
          fqn: 'agent-skill:acme/team-a/echo:3',
          manifest: MANIFEST,
        },
      ]),
    ).toEqual([
      {
        name: 'agent-skill:acme/team-a/echo:3',
        display_name: 'echo',
        description: 'Echo skill',
        version: 3,
      },
    ]);
  });

  it('accepts SFY manifest names that are not ResourceName slugs', () => {
    expect(
      mapSfyRegistrySkills([
        {
          latest_version: {
            fqn: 'agent-skill:acme/team-a/My Skill:1',
            manifest: {
              name: 'My Skill',
              version: 1,
              ml_repo: 'team-a',
              source: { description: 'Mixed-case display name' },
            },
          },
        },
      ]),
    ).toEqual([
      {
        name: 'agent-skill:acme/team-a/My Skill:1',
        display_name: 'My Skill',
        description: 'Mixed-case display name',
        skill_repo_name: 'team-a',
        version: 1,
      },
    ]);
  });
});
