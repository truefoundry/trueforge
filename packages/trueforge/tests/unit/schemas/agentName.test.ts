import { AgentNameSchema, NameSchema } from '../../../src/schemas/common';

describe('AgentNameSchema', () => {
  it('accepts hyphen-only names of length 2–64', () => {
    expect(AgentNameSchema.parse('ab')).toBe('ab');
    expect(AgentNameSchema.parse('a-b')).toBe('a-b');
    expect(AgentNameSchema.parse(`a${'b'.repeat(62)}`)).toHaveLength(63);
    expect(AgentNameSchema.parse(`a${'b'.repeat(63)}`)).toHaveLength(64);
    expect(AgentNameSchema.parse(`a${'-'.repeat(62)}b`)).toHaveLength(64);
  });

  it('rejects ".", "_", leading/trailing hyphen, and out-of-range length', () => {
    expect(AgentNameSchema.safeParse('a.b').success).toBe(false);
    expect(AgentNameSchema.safeParse('a_b').success).toBe(false);
    expect(AgentNameSchema.safeParse('-ab').success).toBe(false);
    expect(AgentNameSchema.safeParse('ab-').success).toBe(false);
    expect(AgentNameSchema.safeParse('a').success).toBe(false);
    expect(AgentNameSchema.safeParse(`a${'b'.repeat(64)}`).success).toBe(false);
  });

  it('leaves NameSchema allowing "." and "_" for non-agent resources', () => {
    expect(NameSchema.parse('a.b')).toBe('a.b');
    expect(NameSchema.parse('a_b')).toBe('a_b');
  });
});
