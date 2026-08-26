// packages/trueforge/tests/unit/sandbox/providerUtils.test.ts
//
// Mock only the two SDK provider constructors so tests never touch a real Daytona/OpenSandbox
// service — everything else in this module (toSandboxProvider's dispatch, the sandboxImage/
// build_metadata fallback logic, the platform/entrypoint pinning) stays real and gets exercised.
jest.mock('@truefoundry/trueforge-core/core', () => {
  const actual = jest.requireActual('@truefoundry/trueforge-core/core');
  return {
    ...actual,
    DaytonaSandboxProvider: jest.fn(),
    OpenSandboxProvider: jest.fn(),
  };
});

import { DaytonaSandboxProvider, OpenSandboxProvider, SANDBOX_IMAGE_URI } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import { toSandboxProvider } from '../../../src/sandbox/providerUtils';
import type { SandboxProviderManifest } from '../../../src/schemas/sandboxProvider';

const silentLogger = createLogger({ silent: true });

const openSandboxManifest: Extract<SandboxProviderManifest, { type: 'opensandbox' }> = {
  type: 'opensandbox',
  auth: { api_key: 'osb-test' },
  domain: 'localhost:8080',
  protocol: 'http',
  exec_timeout_ms: 60000,
};

const daytonaManifest: Extract<SandboxProviderManifest, { type: 'daytona' }> = {
  type: 'daytona',
  auth: { api_key: 'dtn-test' },
  exec_timeout_ms: 60000,
  auto_stop_interval_in_minutes: 5,
  auto_archive_interval_in_minutes: 60,
  auto_delete_interval_in_minutes: 7200,
};

beforeEach(() => {
  jest.mocked(DaytonaSandboxProvider).mockReset();
  jest.mocked(OpenSandboxProvider).mockReset();
});

describe('toSandboxProvider', () => {
  it(
    'constructs OpenSandboxProvider with the platform/entrypoint override the release image ' +
      'requires — regression guard: omitting either silently breaks sandbox creation ' +
      '(wrong-arch snapshot pull 404) or Code Mode (container boots into a bare `tail -f ' +
      '/dev/null` instead of running supervisord/nats-server), with no error surfaced anywhere',
    () => {
      toSandboxProvider({
        manifest: openSandboxManifest,
        tenant_id: 'tenant-a',
        logger: silentLogger,
      });

      expect(OpenSandboxProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: { os: 'linux', arch: 'amd64' },
          entrypoint: ['/usr/bin/supervisord', '-n'],
        }),
      );
    },
  );

  it('passes OpenSandbox manifest fields through to the constructor', () => {
    toSandboxProvider({
      manifest: openSandboxManifest,
      tenant_id: 'tenant-a',
      logger: silentLogger,
    });

    expect(OpenSandboxProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'osb-test',
        domain: 'localhost:8080',
        protocol: 'http',
        tenantName: 'tenant-a',
        timeoutMs: 60000,
      }),
    );
  });

  it('defaults sandboxImage to SANDBOX_IMAGE_URI when no build_metadata is persisted yet', () => {
    toSandboxProvider({
      manifest: openSandboxManifest,
      tenant_id: 'tenant-a',
      logger: silentLogger,
    });

    expect(OpenSandboxProvider).toHaveBeenCalledWith(expect.objectContaining({ sandboxImage: SANDBOX_IMAGE_URI }));
  });

  it('pins sandboxImage to the persisted build_metadata image_uri (no silent image upgrade on re-save)', () => {
    toSandboxProvider({
      manifest: openSandboxManifest,
      tenant_id: 'tenant-a',
      logger: silentLogger,
      build_metadata: { image_uri: 'pinned.example.com/sandbox:abc123', build_ref: 'ignored-for-opensandbox' },
    });

    expect(OpenSandboxProvider).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxImage: 'pinned.example.com/sandbox:abc123' }),
    );
  });

  it('dispatches to DaytonaSandboxProvider for a daytona manifest (sanity check the discriminator still works)', () => {
    toSandboxProvider({
      manifest: daytonaManifest,
      tenant_id: 'tenant-a',
      logger: silentLogger,
    });

    expect(DaytonaSandboxProvider).toHaveBeenCalled();
    expect(OpenSandboxProvider).not.toHaveBeenCalled();
  });
});
