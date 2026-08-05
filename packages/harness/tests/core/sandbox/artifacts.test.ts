import { parseSandboxArtifacts } from '../../../src/core/sandbox/artifacts';

describe('parseSandboxArtifacts', () => {
  it('extracts labelled links from a fenced block', () => {
    const text = [
      'Here is your report.',
      '',
      '```sandbox_artifacts',
      '[Quarterly report](/workspace/report.pdf)',
      '[Raw data](/workspace/data.csv)',
      '```',
    ].join('\n');

    expect(parseSandboxArtifacts(text)).toEqual([
      { label: 'Quarterly report', path: '/workspace/report.pdf' },
      { label: 'Raw data', path: '/workspace/data.csv' },
    ]);
  });

  it('returns nothing when there is no artifacts block', () => {
    expect(parseSandboxArtifacts('Just prose with a [link](/workspace/report.pdf).')).toEqual([]);
    expect(parseSandboxArtifacts('```python\nprint("[x](/tmp/y)")\n```')).toEqual([]);
    expect(parseSandboxArtifacts('')).toEqual([]);
  });

  it('collects artifacts across multiple blocks and drops duplicate paths', () => {
    const text = [
      '```sandbox_artifacts',
      '[First](/workspace/a.txt)',
      '```',
      'more text',
      '```sandbox_artifacts',
      '[Duplicate](/workspace/a.txt)',
      '[Second](/workspace/b.txt)',
      '```',
    ].join('\n');

    expect(parseSandboxArtifacts(text)).toEqual([
      { label: 'First', path: '/workspace/a.txt' },
      { label: 'Second', path: '/workspace/b.txt' },
    ]);
  });

  it('drops paths that are relative or escape via ".."', () => {
    const text = [
      '```sandbox_artifacts',
      '[Relative](report.pdf)',
      '[Home](~/report.pdf)',
      '[Traversal](/workspace/../../etc/passwd)',
      '[Fine](/workspace/ok.pdf)',
      '```',
    ].join('\n');

    expect(parseSandboxArtifacts(text)).toEqual([{ label: 'Fine', path: '/workspace/ok.pdf' }]);
  });

  it('falls back to the file name when the label is empty', () => {
    expect(parseSandboxArtifacts('```sandbox_artifacts\n[](/workspace/report.pdf)\n```')).toEqual([
      { label: 'report.pdf', path: '/workspace/report.pdf' },
    ]);
  });

  it('tolerates indentation and surrounding whitespace', () => {
    const text = ['  ```sandbox_artifacts  ', '  [Report]( /workspace/report.pdf )  ', '  ```  '].join('\n');

    expect(parseSandboxArtifacts(text)).toEqual([{ label: 'Report', path: '/workspace/report.pdf' }]);
  });

  it('ignores an unterminated block', () => {
    expect(parseSandboxArtifacts('```sandbox_artifacts\n[Report](/workspace/report.pdf)')).toEqual([]);
  });
});
