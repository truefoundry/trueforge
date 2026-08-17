import { AgentSpecSchema } from '../../src/agent-session/schemas/agentSpec';

describe('AgentSpecSchema model.name', () => {
  it('accepts opaque non-empty identifiers including non-FQN shapes', () => {
    expect(AgentSpecSchema.parse({ model: { name: 'gpt-4' } }).model.name).toBe('gpt-4');
    expect(AgentSpecSchema.parse({ model: { name: 'provider/model' } }).model.name).toBe('provider/model');
    expect(AgentSpecSchema.parse({ model: { name: 'a/b/c' } }).model.name).toBe('a/b/c');
  });

  it('rejects empty model.name', () => {
    const result = AgentSpecSchema.safeParse({ model: { name: '' } });
    expect(result.success).toBe(false);
  });
});
