import {
  mapResolvedAgentSkillVersions,
  mapSfyRegistrySkills,
  mapSfyRegistrySkillVersions,
  parseSfyRegistrySkillVersion,
} from '../../../src/truefoundry/mapSfyAgentSkills';

const MANIFEST = {
  name: 'echo',
  type: 'agent-skill',
  version: 3,
  ml_repo: 'team-a',
  source: { type: 'blob-storage', description: 'Echo skill' },
};

const VERSION = {
  agent_skill_id: 'skill-1',
  fqn: 'agent-skill:acme/team-a/echo:3',
  manifest: MANIFEST,
};

describe('mapSfyRegistrySkills', () => {
  it('maps list rows with skill id/fqn and latest version FQN as name', () => {
    expect(
      mapSfyRegistrySkills([
        {
          id: 'skill-1',
          fqn: 'agent-skill:acme/team-a/echo',
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
        skill_id: 'skill-1',
        skill_fqn: 'agent-skill:acme/team-a/echo',
        name: 'agent-skill:acme/team-a/echo:3',
        display_name: 'echo',
        description: 'Echo skill',
        repository_name: 'team-a',
        version: 3,
      },
    ]);
  });

  it('maps version rows with name=FQN and display_name=short SFY name', () => {
    expect(mapSfyRegistrySkillVersions([VERSION])).toEqual([
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
          id: 'skill-2',
          fqn: 'agent-skill:acme/team-a/My Skill',
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
        skill_id: 'skill-2',
        skill_fqn: 'agent-skill:acme/team-a/My Skill',
        name: 'agent-skill:acme/team-a/My Skill:1',
        display_name: 'My Skill',
        description: 'Mixed-case display name',
        repository_name: 'team-a',
        version: 1,
      },
    ]);
  });

  it('parses resolve response skills', () => {
    expect(
      mapResolvedAgentSkillVersions({
        skills: [
          {
            fqn: 'agent-skill:acme/team-a/echo:3',
            name: 'echo',
            description: 'Echo skill',
            skill_md_content: null,
          },
        ],
      }),
    ).toEqual([
      {
        fqn: 'agent-skill:acme/team-a/echo:3',
        name: 'echo',
        description: 'Echo skill',
        skill_md_content: null,
      },
    ]);
  });

  it('strips unknown fields on resolve responses', () => {
    expect(
      mapResolvedAgentSkillVersions({
        skills: [
          {
            fqn: 'agent-skill:acme/team-a/echo:3',
            name: 'echo',
            description: 'Echo skill',
            extra_sfy_field: true,
          },
        ],
        pagination: { total: 1 },
      }),
    ).toEqual([
      {
        fqn: 'agent-skill:acme/team-a/echo:3',
        name: 'echo',
        description: 'Echo skill',
      },
    ]);
  });
});

describe('parseSfyRegistrySkillVersion', () => {
  it('reads agent_skill_id from one SFY version', () => {
    expect(parseSfyRegistrySkillVersion(VERSION).agent_skill_id).toBe('skill-1');
  });
});
