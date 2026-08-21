import { E2BSandboxProvider } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import { toSandboxProvider } from '../../../src/sandbox/providerUtils';

describe('toSandboxProvider', () => {
  it('constructs the E2B runtime provider for an E2B manifest without remote I/O', () => {
    const provider = toSandboxProvider({
      manifest: {
        type: 'e2b',
        auth: { api_key: 'e2b-test' },
        exec_timeout_ms: 60_000,
        sandbox_timeout_ms: 300_000,
      },
      tenant_id: 'tenant-a',
      logger: createLogger({ silent: true }),
      build_metadata: {
        build_ref: 'trueforge-build-029ea5ff',
        image_uri: 'registry.example.com/trueforge-sandbox:029ea5ff',
        build_id: 'build-1',
        template_id: 'template-1',
      },
    });

    expect(provider).toBeInstanceOf(E2BSandboxProvider);
    expect(provider.type).toBe('e2b');
    expect(provider.getToolResultDumpDir('sandbox-1')).toBe('/home/trueforge/tool-results');
  });
});
