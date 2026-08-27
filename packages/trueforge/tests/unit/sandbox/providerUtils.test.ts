// The refresh builds a real provider and then talks to Daytona. Stub the provider class itself so
// these exercise the refresh's timing behaviour without a network, keeping the rest of the module
// (withTimeout, PromiseTimeoutError) real.
jest.mock('@truefoundry/trueforge-core/core', () => {
  const actual = jest.requireActual('@truefoundry/trueforge-core/core');
  return { ...actual, DaytonaSandboxProvider: jest.fn() };
});

import { DaytonaSandboxProvider } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../../../src/db/sandboxProviderStore';
import { checkSnapshotStatus, SANDBOX_BUILD_REQUEST_TIMEOUT_MS } from '../../../src/sandbox/providerUtils';

const mockProvider = DaytonaSandboxProvider as unknown as jest.Mock;
const silentLogger = createLogger({ silent: true });

const BUILD_METADATA = { build_ref: 'trueforge-build-029ea5ff', image_uri: 'sandbox:029ea5ff' };

function recordWith(overrides: Partial<SandboxProviderRecord>): SandboxProviderRecord {
  return {
    tenant_id: 'tenant',
    manifest: { auth: { api_key: 'dt-key' } },
    status: 'pending',
    status_reason: 'Sandbox image build in progress (building).',
    build_metadata: BUILD_METADATA,
    updated_at: new Date().toISOString(),
    ...overrides,
  } as SandboxProviderRecord;
}

function storeReturning(record: SandboxProviderRecord | undefined) {
  return {
    getSandboxProvider: jest.fn().mockResolvedValue(record),
    updateSandboxStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as ISandboxProviderStore & {
    getSandboxProvider: jest.Mock;
    updateSandboxStatus: jest.Mock;
  };
}

/** A call that never settles, standing in for a Daytona endpoint that accepts and then stalls. */
const neverSettles = () => new Promise<never>(() => undefined);

describe('checkSnapshotStatus when Daytona stalls', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockProvider.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives up on a stalled status read and reports the persisted status', async () => {
    /*
     * This refresh sits on the capability probe, the settings read, and turn creation. Unbounded, a
     * provider that accepts the connection and never answers held each of those for undici's
     * multi-minute default.
     */
    const store = storeReturning(recordWith({ status: 'pending' }));
    mockProvider.mockImplementation(() => ({ getImageBuildStatus: neverSettles, buildImage: neverSettles }));

    const pending = checkSnapshotStatus({ store, tenant_id: 'tenant', logger: silentLogger });
    await jest.advanceTimersByTimeAsync(SANDBOX_BUILD_REQUEST_TIMEOUT_MS + 1);

    expect(await pending).toEqual({
      status: 'pending',
      status_reason: 'Sandbox image build in progress (building).',
      build_metadata: BUILD_METADATA,
    });
    // Nothing was written, so a stalled provider cannot overwrite a good status with a guess.
    expect(store.updateSandboxStatus).not.toHaveBeenCalled();
  });

  it('gives up on a stalled reactivation of a ready snapshot', async () => {
    // A 'ready' record older than the revalidate interval takes the buildImage branch.
    const stale = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const store = storeReturning(recordWith({ status: 'ready', status_reason: null, updated_at: stale }));
    mockProvider.mockImplementation(() => ({ getImageBuildStatus: neverSettles, buildImage: neverSettles }));

    const pending = checkSnapshotStatus({ store, tenant_id: 'tenant', logger: silentLogger });
    await jest.advanceTimersByTimeAsync(SANDBOX_BUILD_REQUEST_TIMEOUT_MS + 1);

    expect((await pending)?.status).toBe('ready');
  });

  it('still surfaces a real failure rather than hiding it behind the persisted status', async () => {
    const store = storeReturning(recordWith({ status: 'pending' }));
    const refused = new Error('Daytona rejected the API key');
    mockProvider.mockImplementation(() => ({
      getImageBuildStatus: () => Promise.reject(refused),
      buildImage: neverSettles,
    }));

    await expect(checkSnapshotStatus({ store, tenant_id: 'tenant', logger: silentLogger })).rejects.toBe(refused);
  });

  it('reports a status that arrives within the budget', async () => {
    const store = storeReturning(recordWith({ status: 'pending' }));
    store.updateSandboxStatus.mockResolvedValue(undefined);
    mockProvider.mockImplementation(() => ({
      getImageBuildStatus: () => Promise.resolve({ status: 'ready', reason: null, metadata: BUILD_METADATA }),
      buildImage: neverSettles,
    }));

    const status = await checkSnapshotStatus({ store, tenant_id: 'tenant', logger: silentLogger });

    expect(status?.status).toBe('ready');
    expect(store.updateSandboxStatus).toHaveBeenCalled();
  });
});
