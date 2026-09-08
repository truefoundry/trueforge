import { mapSfyRegistrySkills, mapSfyRegistrySkillVersions } from '../../../src/truefoundry/mapSfyAgentSkills';

const MANIFEST = {
  name: 'echo',
  type: 'agent-skill',
  version: 3,
  ml_repo: 'team-a',
  source: { type: 'blob-storage', description: 'Echo skill' },
};

describe('mapSfyRegistrySkills', () => {
  it('maps list rows from latest_version.manifest', () => {
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
        name: 'echo',
        description: 'Echo skill',
        fqn: 'agent-skill:acme/team-a/echo:3',
        skill_repo_name: 'team-a',
        version: 3,
      },
    ]);
  });

  it('maps version rows from manifest.name and manifest.version', () => {
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
        fqn: 'agent-skill:acme/team-a/echo:3',
        name: 'echo',
        description: 'Echo skill',
        version: 3,
      },
    ]);
  });
});
