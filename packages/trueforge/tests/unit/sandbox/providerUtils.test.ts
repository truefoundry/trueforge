jest.mock('@daytona/sdk', () => {
  const actual = jest.requireActual('@daytona/sdk');
  return { ...actual, Daytona: jest.fn().mockImplementation(() => ({})) };
});

import { DaytonaError } from '@daytona/sdk';
import { DaytonaSandboxProvider } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../../../src/db/sandboxProviderStore';
import { checkSnapshotStatus } from '../../../src/sandbox/providerUtils';

const record: SandboxProviderRecord = {
  tenant_id: 'tenant-1',
  manifest: {
    type: 'daytona',
    auth: { api_key: 'dtn-revoked' },
    exec_timeout_ms: 60_000,
    auto_stop_interval_in_minutes: 5,
    auto_archive_interval_in_minutes: 60,
    auto_delete_interval_in_minutes: 7200,
  },
  status: 'pending',
  status_reason: null,
  build_metadata: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

function makeStore(): ISandboxProviderStore {
  return {
    getSandboxProvider: jest.fn().mockResolvedValue(record),
    getSandboxProviderForUpdate: jest.fn(),
    upsertSandboxProvider: jest.fn(),
    updateSandboxStatus: jest.fn().mockImplementation(async input => ({ ...record, ...input })),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

it('persists Daytona authentication failures instead of surfacing a settings error', async () => {
  jest
    .spyOn(DaytonaSandboxProvider.prototype, 'getImageBuildStatus')
    .mockRejectedValue(new DaytonaError('unauthorized', 401));
  const store = makeStore();

  await expect(
    checkSnapshotStatus({ store, tenant_id: record.tenant_id, logger: createLogger({ silent: true }) }),
  ).resolves.toMatchObject({
    status: 'failed',
    status_reason: 'Daytona rejected the API key. Check the configured credentials.',
  });
  expect(store.updateSandboxStatus).toHaveBeenCalledWith({
    tenant_id: record.tenant_id,
    status: 'failed',
    status_reason: 'Daytona rejected the API key. Check the configured credentials.',
    build_metadata: null,
    expected_updated_at: record.updated_at,
  });
});
