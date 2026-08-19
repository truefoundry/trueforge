import { existsSync, realpathSync } from 'node:fs';
import {
  commandPath,
  platformAllowRead,
  resolvePythonExecutableOnHost,
} from '../../../../../src/sandbox/local/core/hostRun';

function pathCoveredByAllowRead(params: { path: string; allowRead: readonly string[] }): boolean {
  return params.allowRead.some(root => params.path === root || params.path.startsWith(`${root}/`));
}

describe('resolvePythonExecutableOnHost', () => {
  it('unwraps the macOS /usr/bin/python3 xcode-select stub', async () => {
    if (process.platform !== 'darwin') {
      return;
    }
    const executable = await resolvePythonExecutableOnHost({ commandPath: '/usr/bin/python3' });
    expect(executable).toEqual(expect.stringMatching(/^\/.+/));
    expect(executable).not.toBe('/usr/bin/python3');
  });

  it('realpath-unwraps python.org /usr/local/bin/python3 when present', async () => {
    if (process.platform !== 'darwin' || !existsSync('/usr/local/bin/python3')) {
      return;
    }
    const executable = await resolvePythonExecutableOnHost({ commandPath: '/usr/local/bin/python3' });
    expect(executable).toBe(realpathSync('/usr/local/bin/python3'));
    expect(executable).not.toBe('/usr/local/bin/python3');
  });
});

describe('sandbox PATH vs allowRead', () => {
  it.each(['darwin', 'linux'] as const)('every %s PATH directory is under an allowRead root', platform => {
    const allowRead = platformAllowRead(platform);
    for (const dir of commandPath(platform).split(':')) {
      expect(pathCoveredByAllowRead({ path: dir, allowRead })).toBe(true);
    }
  });

  it('does not grant host /tmp on linux (Code Mode parent is allowRead separately)', () => {
    expect(platformAllowRead('linux')).not.toContain('/tmp');
  });

  it('grants /etc and /private/etc on darwin (symlink + resolved spelling)', () => {
    expect(platformAllowRead('linux')).toContain('/etc');
    expect(platformAllowRead('linux')).not.toContain('/private/etc');
    expect(platformAllowRead('darwin')).toContain('/etc');
    expect(platformAllowRead('darwin')).toContain('/private/etc');
  });
});
