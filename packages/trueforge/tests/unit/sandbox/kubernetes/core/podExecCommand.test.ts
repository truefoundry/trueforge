import { buildPodExecArgv } from '../../../../../src/sandbox/kubernetes/core/podExecCommand';

describe('buildPodExecArgv', () => {
  it('runs the bare command through sh -c when no cwd or env is given', () => {
    expect(buildPodExecArgv({ command: 'echo hi' })).toEqual(['sh', '-c', 'echo hi']);
  });

  it('prefixes a cd into the requested cwd', () => {
    const argv = buildPodExecArgv({ command: 'pwd', cwd: '/home/trueforge/uploads' });
    expect(argv).toEqual(['sh', '-c', "cd '/home/trueforge/uploads'\npwd"]);
  });

  it('exports each env var before the command, in insertion order', () => {
    const argv = buildPodExecArgv({ command: 'env', env: { FOO: 'bar', BAZ: 'qux' } });
    expect(argv).toEqual(['sh', '-c', "export FOO='bar'\nexport BAZ='qux'\nenv"]);
  });

  it('combines env exports and cwd ahead of the command, in that order', () => {
    const argv = buildPodExecArgv({ command: 'ls', cwd: '/home/trueforge', env: { FOO: 'bar' } });
    expect(argv).toEqual(['sh', '-c', "export FOO='bar'\ncd '/home/trueforge'\nls"]);
  });

  it('shell-escapes env values containing single quotes and shell metacharacters', () => {
    const argv = buildPodExecArgv({ command: 'true', env: { MSG: "it's a $(test); done" } });
    expect(argv).toEqual(['sh', '-c', String.raw`export MSG='it'\''s a $(test); done'` + '\ntrue']);
  });

  it('shell-escapes a cwd containing spaces and quotes', () => {
    const argv = buildPodExecArgv({ command: 'pwd', cwd: "/tmp/a b's" });
    expect(argv).toEqual(['sh', '-c', String.raw`cd '/tmp/a b'\''s'` + '\npwd']);
  });

  it('treats an empty-string cwd as absent', () => {
    expect(buildPodExecArgv({ command: 'pwd', cwd: '' })).toEqual(['sh', '-c', 'pwd']);
  });

  it('treats an empty env object as absent', () => {
    expect(buildPodExecArgv({ command: 'pwd', env: {} })).toEqual(['sh', '-c', 'pwd']);
  });

  it('rejects an env var name that is not a valid shell identifier', () => {
    expect(() => buildPodExecArgv({ command: 'true', env: { 'FOO-BAR': 'x' } })).toThrow(
      /invalid environment variable name/i,
    );
  });

  it('rejects an env var name starting with a digit', () => {
    expect(() => buildPodExecArgv({ command: 'true', env: { '1FOO': 'x' } })).toThrow(
      /invalid environment variable name/i,
    );
  });
});
