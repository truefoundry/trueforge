import { createLogger } from 'winston';
import { runSandboxProviderContractSuite } from '../../../../../../trueforge-core/tests/core/sandbox/provider/sandboxProviderContractSuite';
import { DockerSandboxProvider } from '../../../../../src/sandbox/docker/provider/DockerSandboxProvider';

/**
 * Image is overridable so CI can pin something small. The default only needs a
 * POSIX shell and coreutils -- the contract suite never invokes Python, and
 * requiring a CUDA image here would make the suite depend on a GPU host.
 */
const IMAGE = process.env['TFY_DOCKER_SANDBOX_TEST_IMAGE'] ?? 'nvidia/cuda:13.0.0-base-ubuntu24.04';

describe('DockerSandboxProvider (SandboxProvider contract)', () => {
  runSandboxProviderContractSuite(async () => {
    const support = await DockerSandboxProvider.isSupported();
    if (!support.supported) {
      pending(`Docker sandbox not supported: ${support.reason}`);
      throw new Error(support.reason);
    }
    const provider = new DockerSandboxProvider({
      image: IMAGE,
      logger: createLogger({ silent: true }),
    });
    const build = await provider.buildImage();
    if (build.status === 'failed') {
      pending(`image unavailable: ${build.reason ?? 'unknown'}`);
      throw new Error(build.reason ?? 'image build failed');
    }
    return {
      provider,
      dispose: async () => {
        await provider.dispose();
      },
    };
  });
});
