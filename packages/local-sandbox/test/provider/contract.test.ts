import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSandboxProviderContractSuite } from '../../../harness/tests/core/sandbox/provider/sandboxProviderContractSuite';
import { LocalSandboxProvider } from '../../src/provider/LocalSandboxProvider';

describe('LocalSandboxProvider (SandboxProvider contract)', () => {
  runSandboxProviderContractSuite(async () => {
    const support = await LocalSandboxProvider.isSupported();
    if (!support.supported) {
      throw new Error(support.reason);
    }
    const sandboxRootPathParent = await mkdtemp(join(tmpdir(), 'tfy-local-sandbox-contract-'));
    // Short path: macOS tmpdir ~48 bytes; keep parent ≤60 for Code Mode UDS.
    const codeModeSocketParentPath = join(tmpdir(), 'cm');
    await mkdir(codeModeSocketParentPath, { recursive: true, mode: 0o700 });
    const provider = new LocalSandboxProvider({
      sandboxRootPathParent,
      codeModeSocketParentPath,
      support,
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
