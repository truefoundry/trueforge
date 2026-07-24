import { AgentSpecSchema } from '../../src/agent-session/schemas/agentSpec';

const base = {
  model: { name: 'test-model' },
};

describe('AgentSpecSchema skills (git mounts)', () => {
  it('accepts a git skill mount', () => {
    const spec = AgentSpecSchema.parse({
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
    const spec = AgentSpecSchema.parse({
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
    expect(spec.skills?.[0]?.ref).toBe(sha);
  });

  it('rejects the legacy name/preload skill shape', () => {
    const result = AgentSpecSchema.safeParse({
      ...base,
      skills: [{ name: 'pr-review', preload: false }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a git skill mount without a description', () => {
    const result = AgentSpecSchema.safeParse({
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
    const result = AgentSpecSchema.safeParse({
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
