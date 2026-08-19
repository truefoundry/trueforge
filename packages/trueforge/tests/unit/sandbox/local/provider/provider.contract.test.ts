import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from 'winston';
import { runSandboxProviderContractSuite } from '../../../../../../trueforge-core/tests/core/sandbox/provider/sandboxProviderContractSuite';
import { LocalSandboxProvider } from '../../../../../src/sandbox/local/provider/LocalSandboxProvider';

describe('LocalSandboxProvider (SandboxProvider contract)', () => {
  runSandboxProviderContractSuite(async () => {
    const support = await LocalSandboxProvider.isSupported();
    if (!support.supported) {
      pending(`Local sandbox not supported: ${support.reason}`);
    }
    if (!support.supported) {
      throw new Error(support.reason);
    }
    const sandboxRootPathParent = await mkdtemp(join(tmpdir(), 'tfy-local-sandbox-contract-'));
    // Short path: macOS tmpdir ~48 bytes; keep parent ≤65 for Code Mode UDS.
    const codeModeSocketParentPath = join(tmpdir(), 'cm');
    await mkdir(codeModeSocketParentPath, { recursive: true, mode: 0o700 });
    const provider = new LocalSandboxProvider({
      sandboxRootPathParent,
      codeModeSocketParentPath,
      support,
      logger: createLogger({ silent: true }),
    });
    return {
      provider,
      dispose: async () => {
        await provider.dispose();
        await rm(sandboxRootPathParent, { recursive: true, force: true });
      },
    };
  });
});
