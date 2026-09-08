import { TFYSandboxProvider } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import type { SandboxProviderRecord } from '../../../src/db/sandboxProviderStore';
import { toSandboxProviderFromRecord } from '../../../src/sandbox/providerUtils';

const logger = createLogger({ silent: true });

describe('toSandboxProviderFromRecord', () => {
  it('builds TFYSandboxProvider from a tfy record', () => {
    const record: SandboxProviderRecord = {
      tenant_id: 'acme',
      manifest: {
        type: 'tfy',
        server_url: 'http://sandbox-server',
        nats_bridge_url: 'ws://nats-bridge',
        exec_timeout_ms: 60_000,
      },
      status: 'ready',
      status_reason: null,
      build_metadata: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const provider = toSandboxProviderFromRecord({ record, tenant_id: 'acme', logger });
    expect(provider).toBeInstanceOf(TFYSandboxProvider);
    expect(provider.type).toBe('tfy');
  });
});
