import { DAYTONA_SNAPSHOT_NOT_STARTED_REASON } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { createLogger } from 'winston';
import type { ISandboxEnvironmentStore } from '../../../src/db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from '../../../src/db/sandboxProviderStore';
import { progressSandboxEnvironmentVersion } from '../../../src/sandbox/progressSandboxEnvironmentVersion';
import * as providerUtils from '../../../src/sandbox/providerUtils';
import * as sentry from '../../../src/sentry';

jest.mock('../../../src/sentry', () => ({
  captureCriticalException: jest.fn(),
}));

jest.mock('../../../src/sandbox/providerUtils', () => {
  const actual = jest.requireActual<typeof import('../../../src/sandbox/providerUtils')>(
    '../../../src/sandbox/providerUtils',
  );
  return {
    ...actual,
    toDaytonaSandboxProvider: jest.fn(),
  };
});

const logger = createLogger({ silent: true });

const PENDING = {
  id: 'ver-1',
  tenant_id: 'tenant-1',
  environment_id: 'env-1',
  environment_name: 'pyjokes-env',
  version: 1,
  external_ref: 'trueforge-abc',
  manifest: {
    name: 'pyjokes-env',
    resources: { cpu: 1, memory: 1, disk: 3 },
    type: 'daytona' as const,
    sandbox_provider: 'daytona' as const,
    image: { type: 'build' as const, build_script: 'pip install pyjokes' },
  },
};

const PROVIDER_RECORD = {
  tenant_id: 'tenant-1',
  manifest: {
    type: 'daytona' as const,
    auth: { api_key: 'dtn-test' },
    exec_timeout_ms: 60_000,
    auto_stop_interval_in_minutes: 5,
    auto_archive_interval_in_minutes: 60,
    auto_delete_interval_in_minutes: 7200,
  },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function makeStores(options?: { pending?: typeof PENDING | null; provider?: typeof PROVIDER_RECORD | null }) {
  const pending = options?.pending === null ? undefined : (options?.pending ?? PENDING);
  const provider = options?.provider === null ? undefined : (options?.provider ?? PROVIDER_RECORD);
  const sandboxEnvironmentStore = {
    getSandboxEnvironmentVersion: jest.fn().mockResolvedValue(pending),
    markVersionReady: jest.fn().mockResolvedValue(undefined),
    markVersionFailed: jest.fn().mockResolvedValue(undefined),
  };
  const sandboxProviderStore = {
    getSandboxProvider: jest.fn().mockResolvedValue(provider),
  };
  return {
    sandboxEnvironmentStore: sandboxEnvironmentStore as unknown as ISandboxEnvironmentStore,
    sandboxProviderStore: sandboxProviderStore as unknown as ISandboxProviderStore,
    envStore: sandboxEnvironmentStore,
  };
}

function mockProvider(methods: { getBuildStatus: jest.Mock; build: jest.Mock }): void {
  jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReturnValue(methods as never);
}

describe('progressSandboxEnvironmentVersion', () => {
  beforeEach(() => {
    jest.mocked(providerUtils.toDaytonaSandboxProvider).mockReset();
    jest.mocked(sentry.captureCriticalException).mockClear();
  });

  it('throws 404 when the version is missing', async () => {
    const { sandboxEnvironmentStore, sandboxProviderStore } = makeStores({ pending: null });
    await expect(
      progressSandboxEnvironmentVersion({
        sandboxEnvironmentStore,
        sandboxProviderStore,
        environment_version_id: 'missing',
        logger,
      }),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<HTTPException>);
    expect(sentry.captureCriticalException).toHaveBeenCalled();
  });

  it('marks ready when getBuildStatus reports ready', async () => {
    const { sandboxEnvironmentStore, sandboxProviderStore, envStore } = makeStores();
    const build = jest.fn();
    mockProvider({
      getBuildStatus: jest.fn().mockResolvedValue({ status: 'ready', reason: null, metadata: null }),
      build,
    });

    await progressSandboxEnvironmentVersion({
      sandboxEnvironmentStore,
      sandboxProviderStore,
      environment_version_id: 'ver-1',
      logger,
    });

    expect(build).not.toHaveBeenCalled();
    expect(envStore.markVersionReady).toHaveBeenCalledWith({ environment_version_id: 'ver-1' });
  });

  it('calls build when snapshot has not started, then marks ready', async () => {
    const { sandboxEnvironmentStore, sandboxProviderStore, envStore } = makeStores();
    const build = jest.fn().mockResolvedValue({ status: 'ready', reason: null, metadata: null });
    mockProvider({
      getBuildStatus: jest.fn().mockResolvedValue({
        status: 'pending',
        reason: DAYTONA_SNAPSHOT_NOT_STARTED_REASON,
        metadata: null,
      }),
      build,
    });

    await progressSandboxEnvironmentVersion({
      sandboxEnvironmentStore,
      sandboxProviderStore,
      environment_version_id: 'ver-1',
      logger,
    });

    expect(build).toHaveBeenCalledTimes(1);
    expect(envStore.markVersionReady).toHaveBeenCalledWith({ environment_version_id: 'ver-1' });
  });

  it('marks failed when build status is failed', async () => {
    const { sandboxEnvironmentStore, sandboxProviderStore, envStore } = makeStores();
    mockProvider({
      getBuildStatus: jest.fn().mockResolvedValue({
        status: 'failed',
        reason: 'pip blew up',
        metadata: null,
      }),
      build: jest.fn(),
    });

    await progressSandboxEnvironmentVersion({
      sandboxEnvironmentStore,
      sandboxProviderStore,
      environment_version_id: 'ver-1',
      logger,
    });

    expect(envStore.markVersionFailed).toHaveBeenCalledWith({
      environment_version_id: 'ver-1',
      status_reason: 'pip blew up',
    });
  });

  it('leaves pending when still building', async () => {
    const { sandboxEnvironmentStore, sandboxProviderStore, envStore } = makeStores();
    mockProvider({
      getBuildStatus: jest.fn().mockResolvedValue({
        status: 'pending',
        reason: 'building…',
        metadata: null,
      }),
      build: jest.fn(),
    });

    await progressSandboxEnvironmentVersion({
      sandboxEnvironmentStore,
      sandboxProviderStore,
      environment_version_id: 'ver-1',
      logger,
    });

    expect(envStore.markVersionReady).not.toHaveBeenCalled();
    expect(envStore.markVersionFailed).not.toHaveBeenCalled();
  });

  it('times out a hung getBuildStatus so the build loop can continue', async () => {
    jest.useFakeTimers();
    try {
      const { sandboxEnvironmentStore, sandboxProviderStore } = makeStores();
      mockProvider({
        getBuildStatus: jest.fn().mockReturnValue(new Promise(() => undefined)),
        build: jest.fn(),
      });

      const progressPromise = progressSandboxEnvironmentVersion({
        sandboxEnvironmentStore,
        sandboxProviderStore,
        environment_version_id: 'ver-1',
        logger,
      });
      const expectation = expect(progressPromise).rejects.toThrow(/Timed out.*getBuildStatus/);
      await jest.advanceTimersByTimeAsync(30_000);
      await expectation;
      expect(sentry.captureCriticalException).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
