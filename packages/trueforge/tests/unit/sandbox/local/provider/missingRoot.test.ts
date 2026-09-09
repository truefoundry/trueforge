import { SandboxNotAvailableError } from '@truefoundry/trueforge-core/core';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from 'winston';
import { LocalSandboxProvider } from '../../../../../src/sandbox/local/provider/LocalSandboxProvider';

const describeUnix = process.platform === 'win32' ? describe.skip : describe;

async function makeProvider(sandboxRootPathParent: string): Promise<LocalSandboxProvider> {
  const codeModeSocketParentPath = join(tmpdir(), 'cm');
  await mkdir(codeModeSocketParentPath, { recursive: true, mode: 0o700 });
  return new LocalSandboxProvider({
    sandboxRootPathParent,
    codeModeSocketParentPath,
    support: { supported: true, platform: 'darwin', shell: '/bin/bash', python: '/usr/bin/python3' },
    logger: createLogger({ silent: true }),
  });
}

describeUnix('LocalSandboxProvider missing root', () => {
  it('throws SandboxNotAvailableError when the sandbox root does not exist', async () => {
    const sandboxRootPathParent = await mkdtemp(join(tmpdir(), 'tfy-local-missing-'));
    const provider = await makeProvider(sandboxRootPathParent);
    try {
      await expect(
        provider.exec({ sandboxId: join(sandboxRootPathParent, 'does-not-exist'), command: 'true' }),
      ).rejects.toBeInstanceOf(SandboxNotAvailableError);
    } finally {
      await rm(sandboxRootPathParent, { recursive: true, force: true });
    }
  });

  it('throws SandboxNotAvailableError when the id is the parent itself', async () => {
    const sandboxRootPathParent = await mkdtemp(join(tmpdir(), 'tfy-local-parent-id-'));
    const provider = await makeProvider(sandboxRootPathParent);
    try {
      await expect(provider.exec({ sandboxId: sandboxRootPathParent, command: 'true' })).rejects.toBeInstanceOf(
        SandboxNotAvailableError,
      );
    } finally {
      await rm(sandboxRootPathParent, { recursive: true, force: true });
    }
  });

  it('throws SandboxNotAvailableError when the id is outside the parent', async () => {
    const sandboxRootPathParent = await mkdtemp(join(tmpdir(), 'tfy-local-jail-'));
    const outside = await mkdtemp(join(tmpdir(), 'tfy-local-outside-'));
    const provider = await makeProvider(sandboxRootPathParent);
    try {
      await expect(provider.exec({ sandboxId: outside, command: 'true' })).rejects.toBeInstanceOf(
        SandboxNotAvailableError,
      );
    } finally {
      await rm(sandboxRootPathParent, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('throws SandboxNotAvailableError when a child path is a symlink out of the parent', async () => {
    const sandboxRootPathParent = await mkdtemp(join(tmpdir(), 'tfy-local-symlink-'));
    const outside = await mkdtemp(join(tmpdir(), 'tfy-local-symlink-target-'));
    const alias = join(sandboxRootPathParent, 'alias');
    await symlink(outside, alias);
    const provider = await makeProvider(sandboxRootPathParent);
    try {
      await expect(provider.exec({ sandboxId: alias, command: 'true' })).rejects.toBeInstanceOf(
        SandboxNotAvailableError,
      );
    } finally {
      await rm(sandboxRootPathParent, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('layout paths are cwd-relative (not host-absolute)', async () => {
    const sandboxRootPathParent = await mkdtemp(join(tmpdir(), 'tfy-local-layout-'));
    const provider = await makeProvider(sandboxRootPathParent);
    try {
      expect(provider.getToolResultDumpDir()).toBe('tool-results');
      expect(provider.getGitCredentialsPath()).toBe('.git-credentials');
      expect(provider.getFileUploadsDir()).toBe('uploads');
      expect(provider.getSkillsDir()).toBe('skills');
      expect(provider.getGitDownloaderPath()).toBe('git_downloader.py');
      const install = provider.createCodeModeTransport().getClientInstall({
        sandboxId: join(sandboxRootPathParent, 'x'),
      });
      expect(install.remotePath).toBe(join('mcp-client', 'mcp_client.py'));
      expect(install.remotePath.startsWith('/')).toBe(false);
    } finally {
      await rm(sandboxRootPathParent, { recursive: true, force: true });
    }
  });
});
