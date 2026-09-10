import { TRUEFOUNDRY_MANAGED_MESSAGE, TRUEFOUNDRY_MANAGED_STATUS } from '../../../src/truefoundry/errors';
import { resolveTrueFoundrySandboxProviderConfig } from '../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig';
import { TrueFoundrySandboxProviderStore } from '../../../src/truefoundry/TrueFoundrySandboxProviderStore';

jest.mock('../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig', () => {
  const actual = jest.requireActual('../../../src/truefoundry/resolveTrueFoundrySandboxProviderConfig');
  return {
    ...actual,
    resolveTrueFoundrySandboxProviderConfig: jest.fn(),
  };
});

const mockResolveConfig = resolveTrueFoundrySandboxProviderConfig as jest.MockedFunction<
  typeof resolveTrueFoundrySandboxProviderConfig
>;

const TENANT = 'acme';
const DAYTONA_SETTINGS = {
  snapshotName: 'tfy-sandbox-snap',
  autoStopIntervalInMinutes: 10,
  autoArchiveIntervalInMinutes: 90,
  autoDeleteIntervalInMinutes: 10_000,
  timeoutMs: 90_000,
} as const;

describe('TrueFoundrySandboxProviderStore', () => {
  beforeEach(() => {
    mockResolveConfig.mockReset();
    mockResolveConfig.mockReturnValue({
      type: 'daytona',
      apiKey: 'dtn-shared-key',
      settings: { ...DAYTONA_SETTINGS },
    });
  });

  it('get returns undefined when shared sandbox is not configured', async () => {
    mockResolveConfig.mockReturnValue(undefined);
    const store = new TrueFoundrySandboxProviderStore();
    await expect(store.getSandboxProvider(TENANT)).resolves.toBeUndefined();
  });

  it('get returns ready Daytona record from static settings', async () => {
    const store = new TrueFoundrySandboxProviderStore();

    const record = await store.getSandboxProvider(TENANT);

    expect(record).toMatchObject({
      tenant_id: TENANT,
      status: 'ready',
      status_reason: null,
      build_metadata: { build_ref: DAYTONA_SETTINGS.snapshotName },
      manifest: {
        type: 'daytona',
        auth: { api_key: 'dtn-shared-key' },
        exec_timeout_ms: DAYTONA_SETTINGS.timeoutMs,
        auto_stop_interval_in_minutes: DAYTONA_SETTINGS.autoStopIntervalInMinutes,
        auto_archive_interval_in_minutes: DAYTONA_SETTINGS.autoArchiveIntervalInMinutes,
        auto_delete_interval_in_minutes: DAYTONA_SETTINGS.autoDeleteIntervalInMinutes,
      },
    });
  });

  it('get returns ready truefoundry record from static settings', async () => {
    mockResolveConfig.mockReturnValue({
      type: 'truefoundry',
      serverUrl: 'http://sandbox-server',
      natsBridgeUrl: 'ws://nats-bridge',
    });
    const store = new TrueFoundrySandboxProviderStore();

    const record = await store.getSandboxProvider(TENANT);

    expect(record).toMatchObject({
      tenant_id: TENANT,
      status: 'ready',
      status_reason: null,
      build_metadata: null,
      manifest: {
        type: 'truefoundry',
        server_url: 'http://sandbox-server',
        nats_bridge_url: 'ws://nats-bridge',
        exec_timeout_ms: 60_000,
      },
    });
  });

  it('writes and get-for-update are managed (424)', () => {
    const store = new TrueFoundrySandboxProviderStore();
    const assertManaged = (run: () => unknown) => {
      try {
        run();
        throw new Error('expected managed HTTPException');
      } catch (error) {
        expect(error).toMatchObject({ status: TRUEFOUNDRY_MANAGED_STATUS, message: TRUEFOUNDRY_MANAGED_MESSAGE });
      }
    };

    assertManaged(() => store.getSandboxProviderForUpdate(TENANT, null as never));
    assertManaged(() =>
      store.upsertSandboxProvider({
        tenant_id: TENANT,
        manifest: {
          type: 'daytona',
          auth: { api_key: 'x' },
          exec_timeout_ms: 60_000,
          auto_stop_interval_in_minutes: 5,
          auto_archive_interval_in_minutes: 60,
          auto_delete_interval_in_minutes: 7200,
        },
        status: 'ready',
        status_reason: null,
        build_metadata: null,
      }),
    );
    assertManaged(() =>
      store.updateSandboxStatus({
        tenant_id: TENANT,
        status: 'ready',
        status_reason: null,
        build_metadata: null,
      }),
    );
  });
});
