import { resolveTrueFoundrySandboxProviderConfig } from '../../../src/config';
import {
  __resetDaytonaSettingsCacheForTests,
  TrueFoundrySandboxProviderStore,
} from '../../../src/truefoundry/TrueFoundrySandboxProviderStore';
import { TRUEFOUNDRY_MANAGED_MESSAGE, TRUEFOUNDRY_MANAGED_STATUS } from '../../../src/truefoundry/trueFoundryManaged';

jest.mock('../../../src/config', () => {
  const resolveTrueFoundrySandboxProviderConfig = jest.fn();
  return {
    __esModule: true,
    default: {
      SANDBOX_SETTINGS_SERVER_URL: 'https://settings.example/daytona/settings',
    },
    resolveTrueFoundrySandboxProviderConfig,
  };
});

const mockResolveConfig = resolveTrueFoundrySandboxProviderConfig as jest.MockedFunction<
  typeof resolveTrueFoundrySandboxProviderConfig
>;

const ACCESS_TOKEN = 'caller-token';
const TENANT = 'acme';
const SETTINGS_BODY = {
  snapshotName: 'tfy-sandbox-snap',
  autoStopIntervalInMinutes: 10,
  autoArchiveIntervalInMinutes: 90,
  autoDeleteIntervalInMinutes: 10_000,
  timeoutMs: 90_000,
};

function mockSettingsFetch(body: unknown = SETTINGS_BODY, status = 200): jest.Mock {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  });
  global.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

describe('TrueFoundrySandboxProviderStore', () => {
  beforeEach(() => {
    __resetDaytonaSettingsCacheForTests();
    mockResolveConfig.mockReset();
    mockResolveConfig.mockReturnValue({
      type: 'daytona',
      apiKey: 'dtn-shared-key',
      settingsServerUrl: 'https://settings.example/daytona/settings',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('get returns undefined when shared sandbox is not configured', async () => {
    mockResolveConfig.mockReturnValue(undefined);
    const fetchMock = mockSettingsFetch();
    const store = new TrueFoundrySandboxProviderStore({ accessToken: ACCESS_TOKEN });
    await expect(store.getSandboxProvider(TENANT)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('get returns ready Daytona record with snapshot build_ref from settings server', async () => {
    const fetchMock = mockSettingsFetch();
    const store = new TrueFoundrySandboxProviderStore({ accessToken: ACCESS_TOKEN });

    const record = await store.getSandboxProvider(TENANT);

    expect(fetchMock).toHaveBeenCalledWith('https://settings.example/daytona/settings', {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      signal: expect.any(AbortSignal),
    });
    expect(record).toMatchObject({
      tenant_id: TENANT,
      status: 'ready',
      status_reason: null,
      build_metadata: { build_ref: SETTINGS_BODY.snapshotName },
      manifest: {
        type: 'daytona',
        auth: { api_key: 'dtn-shared-key' },
        exec_timeout_ms: SETTINGS_BODY.timeoutMs,
        auto_stop_interval_in_minutes: SETTINGS_BODY.autoStopIntervalInMinutes,
        auto_archive_interval_in_minutes: SETTINGS_BODY.autoArchiveIntervalInMinutes,
        auto_delete_interval_in_minutes: SETTINGS_BODY.autoDeleteIntervalInMinutes,
      },
    });
  });

  it('caches settings across gets within TTL', async () => {
    const fetchMock = mockSettingsFetch();
    const store = new TrueFoundrySandboxProviderStore({ accessToken: ACCESS_TOKEN });

    await store.getSandboxProvider(TENANT);
    await store.getSandboxProvider(TENANT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('get fails when settings fetch times out', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    global.fetch = jest.fn().mockRejectedValue(timeout) as typeof fetch;
    const store = new TrueFoundrySandboxProviderStore({ accessToken: ACCESS_TOKEN });

    await expect(store.getSandboxProvider(TENANT)).rejects.toThrow('Sandbox settings endpoint timed out after 10s');
  });

  it('writes and get-for-update are managed (424)', () => {
    const store = new TrueFoundrySandboxProviderStore({ accessToken: ACCESS_TOKEN });
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
