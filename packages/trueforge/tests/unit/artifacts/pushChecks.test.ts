import type { ArtifactValidateResult } from '@truefoundry/trueforge-core/core';
import { checkArtifactPush, type ArtifactPushLimits } from '../../../src/artifacts/pushChecks';

const LIMITS: ArtifactPushLimits = { max_files: 3, max_total_bytes: 1500 };

type File = ArtifactValidateResult['files'][number];

function file(relative_path: string, size_bytes = 100): File {
  return { relative_path, size_bytes, sha256_b64: 'c2hh' };
}

function check(files: File[], options: { error?: string; entry_point?: string } = {}) {
  const failed = options.error !== undefined;
  return checkArtifactPush({
    validated: {
      mode: 'validate',
      success: !failed,
      exit_code: failed ? 1 : 0,
      error: options.error ?? null,
      files,
    },
    entry_point: options.entry_point ?? 'index.html',
    limits: LIMITS,
  });
}

function errors(...args: Parameters<typeof check>): string {
  const result = check(...args);
  return result.ok ? '' : result.errors.join('\n');
}

describe('checkArtifactPush', () => {
  it('returns the files, normalized entry point and total size', () => {
    expect(check([file('index.html'), file('img/chart.png')], { entry_point: './index.html' })).toEqual({
      ok: true,
      files: [file('index.html'), file('img/chart.png')],
      entry_point: 'index.html',
      total_bytes: 200,
    });
  });

  it.each<[string, File[], Parameters<typeof check>[1], string]>([
    ['sandbox validation error', [], { error: 'symlinks are not allowed: a' }, 'symlinks'],
    ['empty dir', [], {}, 'no files'],
    ['too many files', ['index.html', 'a.txt', 'b.txt', 'c.txt'].map(n => file(n)), {}, 'too many files'],
    ['empty file', [file('index.html'), file('a.txt', 0)], {}, 'empty file: a.txt'],
    ['unsafe relative path', [file('index.html'), file('../x.txt')], {}, 'invalid path'],
    ['total over limit', [file('index.html', 900), file('a.txt', 900)], {}, 'total size'],
    ['entry_point missing', [file('index.html')], { entry_point: 'main.html' }, 'entry_point'],
  ])('rejects %s', (_name, files, options, expected) => {
    expect(errors(files, options)).toContain(expected);
  });
});
