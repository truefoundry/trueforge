import { basename, isAbsolute, join } from 'node:path';
import type { SandboxProvider } from '../../../../src/core/sandbox/provider/Provider';
import { ensureExecSuccess } from '../../../../src/core/sandbox/provider/Provider';

export interface SandboxProviderContractFixture {
  provider: SandboxProvider;
  dispose: () => Promise<void>;
}

/**
 * SandboxProvider contract suite — factory-injected so backends can reuse it.
 * Does not exercise `createCodeModeTransport` (NATS vs UDS is covered by the Code Mode transport suite).
 */
export function runSandboxProviderContractSuite(
  createFixture: () => SandboxProviderContractFixture | Promise<SandboxProviderContractFixture>,
): void {
  describe('SandboxProvider contract', () => {
    let fixture: SandboxProviderContractFixture;

    beforeEach(async () => {
      fixture = await createFixture();
    }, 120_000);

    afterEach(async () => {
      await fixture.dispose();
    }, 60_000);

    it('exec cwd is the sandbox root so relative layout paths work', async () => {
      const { sandboxId } = await fixture.provider.createSandbox();
      const result = await fixture.provider.exec({
        sandboxId,
        command: 'pwd && mkdir -p skills && test -d skills',
      });
      ensureExecSuccess(result);
      if (!result.success) {
        throw new Error('unreachable');
      }
      expect(result.response.result.trim().split('\n')[0]).toBe(sandboxId);
    });

    it('exec is stateful across calls in the same sandbox', async () => {
      const { sandboxId } = await fixture.provider.createSandbox();
      const write = await fixture.provider.exec({
        sandboxId,
        command: "printf 'persist-ok\\n' > persist.txt",
      });
      ensureExecSuccess(write);
      const read = await fixture.provider.exec({
        sandboxId,
        command: 'cat persist.txt',
      });
      ensureExecSuccess(read);
      if (!read.success) {
        throw new Error('unreachable');
      }
      expect(read.response.result).toBe('persist-ok\n');
    });

    it('sandboxes are isolated from each other', async () => {
      const a = await fixture.provider.createSandbox();
      const b = await fixture.provider.createSandbox();
      expect(a.sandboxId).not.toBe(b.sandboxId);

      const write = await fixture.provider.exec({
        sandboxId: a.sandboxId,
        command: "printf 'only-in-a\\n' > secret.txt",
      });
      ensureExecSuccess(write);

      const readRelative = await fixture.provider.exec({
        sandboxId: b.sandboxId,
        command: 'cat secret.txt',
      });
      expect(readRelative.success).toBe(true);
      if (!readRelative.success) {
        throw new Error('unreachable');
      }
      expect(readRelative.response.exitCode).not.toBe(0);
      expect(readRelative.response.result).not.toMatch(/only-in-a/);

      // Path-id backends (Local): deny sibling escape via ../ and absolute paths.
      if (isAbsolute(a.sandboxId) && isAbsolute(b.sandboxId)) {
        const siblingRelative = join('..', basename(a.sandboxId), 'secret.txt');
        const readSiblingRelative = await fixture.provider.exec({
          sandboxId: b.sandboxId,
          command: `cat ${JSON.stringify(siblingRelative)}`,
        });
        expect(readSiblingRelative.success).toBe(true);
        if (!readSiblingRelative.success) {
          throw new Error('unreachable');
        }
        expect(readSiblingRelative.response.exitCode).not.toBe(0);
        expect(readSiblingRelative.response.result).not.toMatch(/only-in-a/);

        const readAbsolute = await fixture.provider.exec({
          sandboxId: b.sandboxId,
          command: `cat ${JSON.stringify(join(a.sandboxId, 'secret.txt'))}`,
        });
        expect(readAbsolute.success).toBe(true);
        if (!readAbsolute.success) {
          throw new Error('unreachable');
        }
        expect(readAbsolute.response.exitCode).not.toBe(0);
        expect(readAbsolute.response.result).not.toMatch(/only-in-a/);

        const writeAbsolute = await fixture.provider.exec({
          sandboxId: b.sandboxId,
          command: `printf 'cross-write\\n' > ${JSON.stringify(join(a.sandboxId, 'cross-write.txt'))}`,
        });
        expect(writeAbsolute.success).toBe(true);
        if (!writeAbsolute.success) {
          throw new Error('unreachable');
        }
        expect(writeAbsolute.response.exitCode).not.toBe(0);

        const writeSiblingRelative = await fixture.provider.exec({
          sandboxId: b.sandboxId,
          command: `printf 'cross-write\\n' > ${JSON.stringify(join('..', basename(a.sandboxId), 'cross-write.txt'))}`,
        });
        expect(writeSiblingRelative.success).toBe(true);
        if (!writeSiblingRelative.success) {
          throw new Error('unreachable');
        }
        expect(writeSiblingRelative.response.exitCode).not.toBe(0);

        const leaked = await fixture.provider.exec({
          sandboxId: a.sandboxId,
          command: 'test -e cross-write.txt',
        });
        expect(leaked.success).toBe(true);
        if (!leaked.success) {
          throw new Error('unreachable');
        }
        expect(leaked.response.exitCode).not.toBe(0);
      }
    });

    it('upload then download round-trips bytes', async () => {
      const { sandboxId } = await fixture.provider.createSandbox();
      const payload = Buffer.from('upload-download-contract\n', 'utf8');
      await fixture.provider.uploadFile({
        sandboxId,
        remotePath: 'roundtrip.bin',
        content: payload,
      });
      const downloaded = await fixture.provider.downloadFile({
        sandboxId,
        path: 'roundtrip.bin',
      });
      expect(Buffer.compare(downloaded, payload)).toBe(0);
    });
  });
}
