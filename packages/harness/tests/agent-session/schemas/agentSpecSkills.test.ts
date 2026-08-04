import { LegacyAgentSpecSchema } from '../../../src/agent-session/schemas/legacyAgentSpec';

const base = {
  model: { name: 'test-model' },
};

describe('LegacyAgentSpecSchema skills (git mounts)', () => {
  it('accepts a git skill mount', () => {
    const spec = LegacyAgentSpecSchema.parse({
      ...base,
      skills: [
        {
          type: 'git',
          url: 'https://github.com/acme/skills',
          path: 'skills/pr-review',
          name: 'pr-review',
          description: 'Reviews pull requests',
          ref: 'main',
        },
      ],
    });
    expect(spec.skills).toEqual([
      {
        type: 'git',
        url: 'https://github.com/acme/skills',
        path: 'skills/pr-review',
        name: 'pr-review',
        description: 'Reviews pull requests',
        ref: 'main',
      },
    ]);
  });

  it('accepts a full commit SHA as ref', () => {
    const sha = 'a'.repeat(40);
    const spec = LegacyAgentSpecSchema.parse({
      ...base,
      skills: [
        {
          type: 'git',
          url: 'https://github.com/acme/skills',
          name: 'pr-review',
          description: 'Reviews pull requests',
          ref: sha,
        },
      ],
    });
    expect(spec.skills?.[0]).toMatchObject({ ref: sha });
  });

  it('rejects a git skill mount without a description', () => {
    const result = LegacyAgentSpecSchema.safeParse({
      ...base,
      skills: [
        {
          type: 'git',
          url: 'https://github.com/acme/skills',
          name: 'pr-review',
          ref: 'main',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('strips unknown commit_sha from a git skill mount', () => {
    const result = LegacyAgentSpecSchema.safeParse({
      ...base,
      skills: [
        {
          type: 'git',
          url: 'https://github.com/acme/skills',
          name: 'pr-review',
          description: 'Reviews pull requests',
          ref: 'main',
          commit_sha: 'a'.repeat(40),
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills?.[0]).toEqual({
        type: 'git',
        url: 'https://github.com/acme/skills',
        name: 'pr-review',
        description: 'Reviews pull requests',
        ref: 'main',
      });
    }
  });
});
