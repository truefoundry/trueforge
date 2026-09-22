import { NameSchema } from '../../../src/schemas/common';

describe('NameSchema', () => {
  it('accepts hyphen-only names of length 2–64', () => {
    expect(NameSchema.parse('ab')).toBe('ab');
    expect(NameSchema.parse('a-b')).toBe('a-b');
    expect(NameSchema.parse(`a${'b'.repeat(63)}`)).toHaveLength(64);
    expect(NameSchema.parse(`a${'-'.repeat(62)}b`)).toHaveLength(64);
  });

  it('rejects ".", "_", leading/trailing hyphen, and out-of-range length', () => {
    expect(NameSchema.safeParse('a.b').success).toBe(false);
    expect(NameSchema.safeParse('a_b').success).toBe(false);
    expect(NameSchema.safeParse('-ab').success).toBe(false);
    expect(NameSchema.safeParse('ab-').success).toBe(false);
    expect(NameSchema.safeParse('a').success).toBe(false);
    expect(NameSchema.safeParse(`a${'b'.repeat(64)}`).success).toBe(false);
  });
});
