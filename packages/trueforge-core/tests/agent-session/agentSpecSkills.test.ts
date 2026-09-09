import { AgentSpecSchema } from '../../src/agent-session/schemas/agentSpec';

describe('AgentSpecSchema skills', () => {
  it('accepts name-only Skill entries and defaults preload to false', () => {
    const parsed = AgentSpecSchema.parse({
      model: { name: 'test-provider/test-model' },
      skills: [{ name: 'my-skill' }],
    });
    expect(parsed.skills).toEqual([{ name: 'my-skill', preload: false }]);
  });

  it('accepts opaque skill names including registry FQNs', () => {
    const fqn = 'agent-skill:acme/team-a/echo:3';
    const parsed = AgentSpecSchema.parse({
      model: { name: 'test-provider/test-model' },
      skills: [{ name: fqn, preload: true }],
    });
    expect(parsed.skills).toEqual([{ name: fqn, preload: true }]);
  });

  it('rejects skill names with disallowed characters', () => {
    const result = AgentSpecSchema.safeParse({
      model: { name: 'test-provider/test-model' },
      skills: [{ name: 'bad name' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects skill mounts with unknown fields', () => {
    const result = AgentSpecSchema.safeParse({
      model: { name: 'test-provider/test-model' },
      skills: [{ name: 'my-skill', type: 'git', url: 'https://github.com/acme/skills' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 50 skills', () => {
    const result = AgentSpecSchema.safeParse({
      model: { name: 'test-provider/test-model' },
      skills: Array.from({ length: 51 }, (_, i) => ({ name: `skill-${String(i)}` })),
    });
    expect(result.success).toBe(false);
  });
});
