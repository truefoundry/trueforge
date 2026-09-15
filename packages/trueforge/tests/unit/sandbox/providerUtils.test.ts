let mockDaytonaProvider: {
  buildImage: jest.Mock;
  getImageBuildStatus: jest.Mock;
};

jest.mock('@truefoundry/trueforge-core/core', () => {
  const actual = jest.requireActual('@truefoundry/trueforge-core/core');
  return {
    ...actual,
    DaytonaSandboxProvider: jest.fn(function DaytonaSandboxProvider() {
      return mockDaytonaProvider;
    }),
  };
});

import { DaytonaError } from '@daytona/sdk';
import { createLogger } from 'winston';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../../../src/db/sandboxProviderStore';
import type { SandboxProviderManifest } from '../../../src/schemas/sandboxProvider';
import { checkSnapshotStatus } from '../../../src/sandbox/providerUtils';

const silentLogger = createLogger({ silent: true });
const tenantId = 'tenant-1';
const buildMetadata = { build_ref: 'trueforge-build-1', image_uri: 'tfy.example/sandbox:1' };
const manifest: SandboxProviderManifest = {
  type: 'daytona',
  auth: { api_key: 'dtn-test-secret' },
  exec_timeout_ms: 60000,
  auto_stop_interval_in_minutes: 5,
  auto_archive_interval_in_minutes: 60,
  auto_delete_interval_in_minutes: 7200,
};

function pendingRecord(): SandboxProviderRecord {
  return {
    tenant_id: tenantId,
    manifest,
    status: 'pending',
    status_reason: null,
    build_metadata: buildMetadata,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function storeWithRecord({ record }: { record: SandboxProviderRecord }): ISandboxProviderStore {
  let current: SandboxProviderRecord | undefined = record;
  return {
    async getSandboxProvider() {
      return current;
    },
    async getSandboxProviderForUpdate() {
      return current;
    },
    async upsertSandboxProvider(input) {
      current = {
        ...input,
        created_at: current?.created_at ?? '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:01.000Z',
      };
      return current;
    },
    async updateSandboxStatus(input) {
      if (current === undefined) {
        return undefined;
      }
      current = {
        ...current,
        status: input.status,
        status_reason: input.status_reason,
        build_metadata: input.build_metadata,
        updated_at: '2026-08-01T00:00:01.000Z',
      };
      return current;
    },
  };
}

beforeEach(() => {
  mockDaytonaProvider = {
    buildImage: jest.fn(),
    getImageBuildStatus: jest.fn(),
  };
});

describe('checkSnapshotStatus', () => {
  it('marks the provider failed when Daytona denies status refresh access', async () => {
    const store = storeWithRecord({ record: pendingRecord() });
    mockDaytonaProvider.getImageBuildStatus.mockRejectedValue(new DaytonaError('Access denied', 403));

    await expect(checkSnapshotStatus({ store, tenant_id: tenantId, logger: silentLogger })).resolves.toEqual({
      status: 'failed',
      status_reason: 'Daytona denied access to the configured API key.',
      build_metadata: buildMetadata,
    });
    await expect(store.getSandboxProvider(tenantId)).resolves.toEqual(
      expect.objectContaining({
        status: 'failed',
        status_reason: 'Daytona denied access to the configured API key.',
        build_metadata: buildMetadata,
      }),
    );
  });
});
