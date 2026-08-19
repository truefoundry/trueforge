import { realpathSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MAX_CODE_MODE_SOCKET_PARENT_BYTES,
  assertCodeModeSocketParentPath,
  probeCodeModeUnixSocket,
} from '../../../../../src/sandbox/local/core/CodeModeUdsTransport';
import { LocalSandboxProvider } from '../../../../../src/sandbox/local/provider/LocalSandboxProvider';

async function mkdirWithRealpathBytes(bytes: number): Promise<string> {
  const prefix = '/tmp';
  const realPrefix = realpathSync(prefix);
  const nameLen = bytes - Buffer.byteLength(realPrefix) - 1;
  if (nameLen < 1) {
    throw new Error(`cannot build a ${String(bytes)}-byte path under ${realPrefix}`);
  }
  const dir = join(prefix, 's'.repeat(nameLen));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (Buffer.byteLength(realpathSync(dir)) !== bytes) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`realpath of ${dir} is not ${String(bytes)} bytes`);
  }
  return dir;
}

describe('Code Mode UDS parent length', () => {
  it('allows a 65-byte realpath parent and listens', async () => {
    const dir = await mkdirWithRealpathBytes(MAX_CODE_MODE_SOCKET_PARENT_BYTES);
    try {
      expect(assertCodeModeSocketParentPath(dir)).toBe(realpathSync(dir));
      const { sockPath } = await probeCodeModeUnixSocket(dir);
      expect(sockPath.startsWith(realpathSync(dir))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a 66-byte realpath parent', async () => {
    const dir = await mkdirWithRealpathBytes(MAX_CODE_MODE_SOCKET_PARENT_BYTES + 1);
    try {
      expect(() => assertCodeModeSocketParentPath(dir)).toThrow(/at most 65 bytes/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('LocalSandboxProvider.isSupported socket probe', () => {
  it('returns unsupported when the configured parent is over the byte limit', async () => {
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
      return;
    }
    const dir = await mkdirWithRealpathBytes(MAX_CODE_MODE_SOCKET_PARENT_BYTES + 1);
    try {
      const support = await LocalSandboxProvider.isSupported({ codeModeSocketParentPath: dir });
      expect(support.supported).toBe(false);
      if (support.supported) {
        return;
      }
      expect(support.reason).toContain('Code Mode UDS listen failed');
      expect(support.reason).toContain('65 bytes');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
