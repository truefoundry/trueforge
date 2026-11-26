import { ArtifactNameSchema } from '../../../src/schemas/artifact';
import { MAX_TITLE_LENGTH } from '../../../src/schemas/common';

const isValid = (name: string) => ArtifactNameSchema.safeParse(name).success;

describe('ArtifactNameSchema', () => {
  it.each([
    ['newline', 'a\nb'],
    ['tab', 'a\tb'],
    ['NUL', 'a\u0000b'],
    ['DEL', 'a\u007fb'],
    ['C1 control', 'a\u0085b'],
    ['bidi override', 'a\u202eb'],
    ['bidi isolate', 'a\u2067b'],
    ...['/', '\\', ':', '*', '?', '"', '<', '>', '|'].map(char => [`"${char}"`, `a${char}b`]),
  ])('rejects %s', (_label, name) => {
    expect(isValid(name)).toBe(false);
  });

  it('rejects forbidden characters even when trimming would remove them', () => {
    expect(isValid('report\n')).toBe(false);
  });

  it('replaces line/paragraph separators with a space, collapses whitespace, and trims', () => {
    expect(ArtifactNameSchema.parse('a\u2028b\u2029c')).toBe('a b c');
    expect(ArtifactNameSchema.parse('a    b')).toBe('a b');
    expect(ArtifactNameSchema.parse('  a \u2028 b  ')).toBe('a b');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(isValid('')).toBe(false);
    expect(isValid('   ')).toBe(false);
    expect(isValid('\u2028\u2029')).toBe(false);
  });

  it('checks the length before normalization', () => {
    expect(ArtifactNameSchema.parse('a'.repeat(MAX_TITLE_LENGTH))).toHaveLength(MAX_TITLE_LENGTH);
    expect(ArtifactNameSchema.parse(`a  ${'b'.repeat(MAX_TITLE_LENGTH - 3)}`)).toBe(
      `a ${'b'.repeat(MAX_TITLE_LENGTH - 3)}`,
    );
    expect(isValid('a'.repeat(MAX_TITLE_LENGTH + 1))).toBe(false);
    expect(isValid(`  ${'a'.repeat(MAX_TITLE_LENGTH - 1)}`)).toBe(false);
  });

  it.each([
    'Q3 report (final) - v2.html',
    'Résumé für Zoë',
    'Team 👨‍👩‍👧 plan',
    'a\u200cb\u200db',
    'a\u200eb\u200fc',
    '.hidden',
    'v1.',
    "It's #1 & 100% done!",
  ])('accepts %j', name => {
    expect(ArtifactNameSchema.parse(name)).toBe(name);
  });
});
