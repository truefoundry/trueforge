import { AgentSpecSchema } from '../../src/agent-session/schemas/agentSpec';

describe('AgentSpecSchema skills', () => {
  it('accepts name-only Skill entries', () => {
    const parsed = AgentSpecSchema.parse({
      model: { name: 'test-provider/test-model' },
      skills: [{ name: 'my-skill' }],
    });
    expect(parsed.skills).toEqual([{ name: 'my-skill' }]);
  });

  it('accepts opaque skill names including registry FQNs', () => {
    const fqn = 'agent-skill:acme/team-a/echo:3';
    const parsed = AgentSpecSchema.parse({
      model: { name: 'test-provider/test-model' },
      skills: [{ name: fqn }],
    });
    expect(parsed.skills).toEqual([{ name: fqn }]);
  });

  it('rejects skill names with disallowed characters', () => {
    const result = AgentSpecSchema.safeParse({
      model: { name: 'test-provider/test-model' },
      skills: [{ name: 'bad name' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects skill mounts with extra fields', () => {
    const result = AgentSpecSchema.safeParse({
      model: { name: 'test-provider/test-model' },
      skills: [{ name: 'my-skill', type: 'git', url: 'https://github.com/acme/skills' }],
    });
    expect(result.success).toBe(false);
  });
});
