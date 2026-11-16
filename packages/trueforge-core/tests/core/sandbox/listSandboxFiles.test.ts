import { parseFindWcOutput } from '../../../src/core/sandbox/listSandboxFiles';

describe('parseFindWcOutput', () => {
  it('keeps regular files under the root and skips the wc total line', () => {
    const parsed = parseFindWcOutput({
      output: ['  12 /work/app/index.html', '   4 /work/app/assets/app.css', '  16 total', '  9 /etc/passwd'].join(
        '\n',
      ),
      root: '/work/app',
      maxFiles: 20,
    });
    expect(parsed).toEqual({
      files: [
        { path: 'index.html', sizeBytes: 12 },
        { path: 'assets/app.css', sizeBytes: 4 },
      ],
      truncated: false,
    });
  });

  it('marks the listing truncated once maxFiles is reached', () => {
    const parsed = parseFindWcOutput({
      output: '  1 /work/a.txt\n  1 /work/b.txt\n',
      root: '/work/',
      maxFiles: 1,
    });
    expect(parsed.files).toEqual([{ path: 'a.txt', sizeBytes: 1 }]);
    expect(parsed.truncated).toBe(true);
  });
});
