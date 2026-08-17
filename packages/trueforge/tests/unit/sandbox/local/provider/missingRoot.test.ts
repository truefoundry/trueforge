import { SandboxNotAvailableError } from '@truefoundry/trueforge-core/core';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from 'winston';
import { LocalSandboxProvider } from '../../../../../src/sandbox/local/provider/LocalSandboxProvider';

describe('LocalSandboxProvider missing root', () => {
  it('throws SandboxNotAvailableError when the sandbox root does not exist', async () => {
    const sandboxRootPathParent = await mkdtemp(join(tmpdir(), 'tfy-local-missing-'));
    const codeModeSocketParentPath = join(tmpdir(), 'cm');
    await mkdir(codeModeSocketParentPath, { recursive: true, mode: 0o700 });
    const provider = new LocalSandboxProvider({
      sandboxRootPathParent,
      codeModeSocketParentPath,
      support: { supported: true, platform: 'darwin', shell: '/bin/bash', python: '/usr/bin/python3' },
      logger: createLogger({ silent: true }),
    });
    try {
      await expect(
        provider.exec({ sandboxId: join(sandboxRootPathParent, 'does-not-exist'), command: 'true' }),
      ).rejects.toBeInstanceOf(SandboxNotAvailableError);
    } finally {
      await rm(sandboxRootPathParent, { recursive: true, force: true });
    }
  });
});
