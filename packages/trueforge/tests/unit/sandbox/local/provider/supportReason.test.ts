import { formatLocalSandboxSupportReason } from '../../../../../src/sandbox/local/provider/LocalSandboxProvider';

describe('formatLocalSandboxSupportReason', () => {
  it('keeps the summary when no candidates were tried', () => {
    expect(formatLocalSandboxSupportReason({ summary: 'No usable Python 3 interpreter', attempts: [] })).toBe(
      'No usable Python 3 interpreter',
    );
  });

  it('records PATH misses and in-sandbox exec failures', () => {
    expect(
      formatLocalSandboxSupportReason({
        summary: 'No usable Python 3 interpreter in sandbox (python3 or python via command -v)',
        attempts: [
          {
            kind: 'python',
            name: 'python3',
            resolved: '/usr/local/bin/python3',
            executable: '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14',
            exitCode: 126,
            stderr: '/opt/homebrew/bin/bash: line 1: /usr/local/bin/python3: Operation not permitted\n',
            timedOut: false,
          },
          { kind: 'python', name: 'python', resolved: undefined },
        ],
      }),
    ).toBe(
      'No usable Python 3 interpreter in sandbox (python3 or python via command -v): ' +
        'python3: resolved=/usr/local/bin/python3 executable=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14 exit=126 ' +
        'stderr="/opt/homebrew/bin/bash: line 1: /usr/local/bin/python3: Operation not permitted\\n"; ' +
        'python: not on sandbox PATH',
    );
  });
});
