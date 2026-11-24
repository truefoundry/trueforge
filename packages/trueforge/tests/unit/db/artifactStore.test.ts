import { InvalidArtifactNameError, normalizeArtifactName } from '../../../src/db/artifactStore';
import { MAX_TITLE_LENGTH } from '../../../src/schemas/common';

describe('normalizeArtifactName', () => {
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
    expect(() => normalizeArtifactName(name)).toThrow(InvalidArtifactNameError);
  });

  it('rejects forbidden characters even when trimming would remove them', () => {
    expect(() => normalizeArtifactName('report\n')).toThrow(InvalidArtifactNameError);
  });

  it('replaces line/paragraph separators with a space, collapses whitespace, and trims', () => {
    expect(normalizeArtifactName('a\u2028b\u2029c')).toBe('a b c');
    expect(normalizeArtifactName('a    b')).toBe('a b');
    expect(normalizeArtifactName('  a \u2028 b  ')).toBe('a b');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(() => normalizeArtifactName('')).toThrow(InvalidArtifactNameError);
    expect(() => normalizeArtifactName('   ')).toThrow(InvalidArtifactNameError);
    expect(() => normalizeArtifactName('\u2028\u2029')).toThrow(InvalidArtifactNameError);
  });

  it('checks the length before normalization', () => {
    expect(normalizeArtifactName('a'.repeat(MAX_TITLE_LENGTH))).toHaveLength(MAX_TITLE_LENGTH);
    expect(normalizeArtifactName(`a  ${'b'.repeat(MAX_TITLE_LENGTH - 3)}`)).toBe(
      `a ${'b'.repeat(MAX_TITLE_LENGTH - 3)}`,
    );
    expect(() => normalizeArtifactName('a'.repeat(MAX_TITLE_LENGTH + 1))).toThrow(InvalidArtifactNameError);
    expect(() => normalizeArtifactName(`  ${'a'.repeat(MAX_TITLE_LENGTH - 1)}`)).toThrow(InvalidArtifactNameError);
  });

  it('rejects a trailing dot', () => {
    for (const name of ['report.', 'report. ', '.', '..']) {
      expect(() => normalizeArtifactName(name)).toThrow(InvalidArtifactNameError);
    }
  });

  it.each([
    'Q3 report (final) - v2.html',
    'Résumé für Zoë',
    'Team 👨‍👩‍👧 plan',
    'a\u200cb\u200db',
    'a\u200eb\u200fc',
    '.hidden',
    "It's #1 & 100% done!",
  ])('accepts %j', name => {
    expect(normalizeArtifactName(name)).toBe(name);
  });
});
