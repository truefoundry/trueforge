import { createLogger } from 'winston';
import { DockerSandboxProvider } from '../../../../../src/sandbox/docker/provider/DockerSandboxProvider';

/**
 * Regression guards for issues found in code review of the initial provider.
 * Each test corresponds to a specific defect, named in its description.
 */

const IMAGE = process.env['TFY_DOCKER_SANDBOX_TEST_IMAGE'] ?? 'nvidia/cuda:13.0.0-base-ubuntu24.04';

/**
 * Every provider in this suite gets a scope unique to the run. The reaper only
 * removes containers in its own scope, so this suite cannot delete sandboxes
 * belonging to another test worker or to a dev server on the same daemon.
 */
const TEST_SCOPE = `test-${String(process.pid)}-${String(Date.now())}`;

function newProvider(overrides: { execTimeoutSeconds?: number } = {}): DockerSandboxProvider {
  return new DockerSandboxProvider({
    image: IMAGE,
    scope: TEST_SCOPE,
    logger: createLogger({ silent: true }),
    ...overrides,
  });
}

describe('DockerSandboxProvider hardening', () => {
  let supported = false;

  beforeAll(async () => {
    supported = (await DockerSandboxProvider.isSupported()).supported;
  }, 60_000);

  it('addresses a sandbox from a provider instance that did not create it', async () => {
    if (!supported) {
      pending('no docker host');
      return;
    }
    // The server builds a fresh provider per turn and hands it a sandbox id
    // carried over from an earlier turn. An instance-local id->container map
    // would be empty exactly when it was needed.
    const creator = newProvider();
    const laterTurn = newProvider();
    try {
      const { sandboxId } = await creator.createSandbox();

      const write = await creator.exec({ sandboxId, command: "printf 'turn-one\\n' > carried.txt" });
      expect(write.success).toBe(true);

      const read = await laterTurn.exec({ sandboxId, command: 'cat carried.txt' });
      expect(read.success).toBe(true);
      if (!read.success) {
        throw new Error('unreachable');
      }
      expect(read.response.exitCode).toBe(0);
      expect(read.response.result).toContain('turn-one');
    } finally {
      await creator.dispose();
      await laterTurn.dispose();
    }
  }, 180_000);

  it('rejects a sandbox id it does not own instead of shelling out with it', async () => {
    if (!supported) {
      pending('no docker host');
      return;
    }
    const provider = newProvider();
    for (const bogus of ['/etc', '/sandbox/../etc', '/sandbox/not-a-ulid', '/sandbox/x; rm -rf /']) {
      // SandboxNotAvailableError propagates rather than being folded into a
      // success:false result, matching the local provider's behaviour.
      await expect(provider.exec({ sandboxId: bogus, command: 'echo reached' })).rejects.toThrow(
        /not a docker sandbox id/,
      );
    }
  }, 120_000);

  it('refuses to read through a symlink that escapes the sandbox root', async () => {
    if (!supported) {
      pending('no docker host');
      return;
    }
    const provider = newProvider();
    try {
      const { sandboxId } = await provider.createSandbox();

      // Lexically this path is inside the sandbox; only resolution reveals it is not.
      const link = await provider.exec({ sandboxId, command: 'ln -s /etc/passwd escape.txt' });
      expect(link.success).toBe(true);

      await expect(provider.downloadFile({ sandboxId, path: 'escape.txt' })).rejects.toThrow();

      // Same for a symlinked directory component.
      const dirLink = await provider.exec({ sandboxId, command: 'ln -s /etc etcdir' });
      expect(dirLink.success).toBe(true);
      await expect(provider.downloadFile({ sandboxId, path: 'etcdir/passwd' })).rejects.toThrow();
    } finally {
      await provider.dispose();
    }
  }, 180_000);

  it('refuses to write through a symlink that escapes the sandbox root', async () => {
    if (!supported) {
      pending('no docker host');
      return;
    }
    const provider = newProvider();
    try {
      const { sandboxId } = await provider.createSandbox();
      const link = await provider.exec({ sandboxId, command: 'ln -s /tmp/pwned outfile' });
      expect(link.success).toBe(true);

      await expect(
        provider.uploadFile({ sandboxId, remotePath: 'outfile', content: Buffer.from('nope') }),
      ).rejects.toThrow();

      const leaked = await provider.exec({ sandboxId, command: 'test -e /tmp/pwned' });
      expect(leaked.success).toBe(true);
      if (!leaked.success) {
        throw new Error('unreachable');
      }
      expect(leaked.response.exitCode).not.toBe(0);
    } finally {
      await provider.dispose();
    }
  }, 180_000);

  it('kills the timed-out workload inside the container, not just the client', async () => {
    if (!supported) {
      pending('no docker host');
      return;
    }
    // Killing `docker exec` locally leaves the command running inside the
    // container (runc#3359), so the bound is applied in-container as well.
    //
    // Scope: this covers the foreground workload, which is what a compile or a
    // benchmark is. A command that deliberately detaches a child (`cmd &` then
    // exits) still outlives the timeout, because `timeout` signals its own child
    // rather than the process group; those are bounded by container removal and
    // by reapStale rather than by this mechanism.
    const provider = newProvider({ execTimeoutSeconds: 2 });
    try {
      const { sandboxId } = await provider.createSandbox();

      const started = Date.now();
      const result = await provider.exec({ sandboxId, command: 'sleep 120' });
      const elapsed = Date.now() - started;

      // Returned on the in-container bound, nowhere near the 120s the command asked for.
      expect(elapsed).toBeLessThan(30_000);
      // A timeout is a command outcome, not an infrastructure fault, so it rides in
      // a successful envelope carrying exit 124 plus `timeout --verbose`'s note.
      expect(result.success).toBe(true);
      if (!result.success) {
        throw new Error('unreachable');
      }
      expect(result.response.exitCode).toBe(124);
      expect(result.response.result).toMatch(/timeout: sending signal/);

      // The workload itself is gone, not merely detached from its client.
      // The bracket idiom keeps the pattern from matching this command's own
      // argv, which `ps` would otherwise list and grep would happily count.
      const survivors = await provider.exec({
        sandboxId,
        command: 'ps -eo args= 2>/dev/null | grep -c "[s]leep 120" || true',
        timeoutSeconds: 30,
      });
      expect(survivors.success).toBe(true);
      if (!survivors.success) {
        throw new Error('unreachable');
      }
      expect(survivors.response.result.trim()).toBe('0');
    } finally {
      await provider.dispose();
    }
  }, 180_000);

  it('refuses a cutoff that would mark live sandboxes stale', async () => {
    await expect(
      DockerSandboxProvider.reapStale({
        scope: TEST_SCOPE,
        olderThanMs: -1,
        logger: createLogger({ silent: true }),
      }),
    ).rejects.toThrow(RangeError);
  });

  it('reaps only sandboxes in its own scope', async () => {
    if (!supported) {
      pending('no docker host');
      return;
    }
    const mine = newProvider();
    // Stands in for another server or test worker sharing the daemon. Its sandbox
    // must survive a reap aimed at TEST_SCOPE.
    const other = new DockerSandboxProvider({
      image: IMAGE,
      scope: `${TEST_SCOPE}-bystander`,
      logger: createLogger({ silent: true }),
    });
    try {
      const { sandboxId } = await mine.createSandbox();
      const bystander = await other.createSandbox();

      const { removed } = await DockerSandboxProvider.reapStale({
        scope: TEST_SCOPE,
        olderThanMs: 0,
        logger: createLogger({ silent: true }),
      });
      expect(removed.length).toBeGreaterThan(0);

      // Mine is gone...
      const afterReap = await mine.exec({ sandboxId, command: 'echo alive' });
      if (afterReap.success) {
        expect(afterReap.response.exitCode).not.toBe(0);
      }

      // ...and the bystander's is untouched.
      const survived = await other.exec({ sandboxId: bystander.sandboxId, command: 'echo alive' });
      expect(survived.success).toBe(true);
      if (!survived.success) {
        throw new Error('unreachable');
      }
      expect(survived.response.exitCode).toBe(0);
    } finally {
      await mine.dispose();
      await other.dispose();
    }
  }, 240_000);

  it('reports a command that exits 124 as itself, not as a timeout', async () => {
    if (!supported) {
      pending('no docker host');
      return;
    }
    // GNU timeout exits 124 when it fires and also passes a command's own 124
    // through, so status alone cannot tell them apart.
    const provider = newProvider();
    try {
      const { sandboxId } = await provider.createSandbox();
      const result = await provider.exec({ sandboxId, command: 'exit 124' });
      expect(result.success).toBe(true);
      if (!result.success) {
        throw new Error('unreachable');
      }
      expect(result.response.exitCode).toBe(124);
      // No timeout diagnostic, because nothing timed out.
      expect(result.response.result).not.toMatch(/timeout: sending signal/);
    } finally {
      await provider.dispose();
    }
  }, 180_000);

  it('reports an oversized download as too large, not missing', async () => {
    if (!supported) {
      pending('no docker host');
      return;
    }
    // Classification must survive both enforcement layers: the in-shell size
    // check, and the streaming cap that catches a file growing mid-`cat`.
    const provider = new DockerSandboxProvider({
      image: IMAGE,
      scope: TEST_SCOPE,
      logger: createLogger({ silent: true }),
      fileMaxBytesForDownload: 1024,
    });
    try {
      const { sandboxId } = await provider.createSandbox();
      const made = await provider.exec({ sandboxId, command: 'head -c 65536 /dev/zero > big.bin' });
      expect(made.success).toBe(true);

      await expect(provider.downloadFile({ sandboxId, path: 'big.bin' })).rejects.toThrow(/too large|exceeds/i);
    } finally {
      await provider.dispose();
    }
  }, 180_000);
});
