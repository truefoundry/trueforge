import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import type { IObjectStore } from '@truefoundry/trueforge-core/core';
import { resolveTurnArtifactsProvider } from '../../../src/artifacts/turnArtifacts';
import type { ArtifactsConfig } from '../../../src/config';
import type { ArtifactRecord, ArtifactVersionRecord } from '../../../src/db/artifactStore';

const SUBJECT: Subject = { subject_id: 'u1', subject_type: 'user', subject_display_name: 'User' };
const OBJECT_STORE: IObjectStore = {
  presignPut: () => Promise.resolve({ url: 'https://s3.test/a', headers: {} }),
  listObjects: () => Promise.resolve([]),
};
const FILES_METADATA = { entry_point: 'index.html', total_bytes: 5, root_path: 'artifacts/t1/art-new/p1' };
const ARTIFACTS_CONFIG: ArtifactsConfig = { tenants: { t1: { enabled: 'on' } }, max_files: 5, max_total_bytes: 100 };

function artifactRecord(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: 'art-1',
    tenant_id: 't1',
    name: 'Report',
    latest_version: 1,
    latest_entry_point: 'index.html',
    created_by_subject: SUBJECT,
    created_by_session_id: 's1',
    created_by_agent_id: null,
    created_at: '2026-11-26T00:00:00.000Z',
    updated_at: '2026-11-26T00:00:00.000Z',
    ...overrides,
  };
}

function setup(options: { existing?: ArtifactRecord; objectStore?: IObjectStore | undefined } = {}) {
  const version: ArtifactVersionRecord = {
    artifact_id: 'art-new',
    version: 1,
    files_metadata: FILES_METADATA,
    created_by_subject: SUBJECT,
    created_by_session_id: 's1',
    created_by_agent_id: 'agent-1',
    created_at: '2026-11-26T00:00:00.000Z',
  };
  const createArtifactWithVersion = jest.fn(() => Promise.resolve({ artifact: artifactRecord(), version }));
  const createVersion = jest.fn((): Promise<ArtifactVersionRecord | undefined> => Promise.resolve(undefined));
  const provider = resolveTurnArtifactsProvider({
    tenant_id: 't1',
    session_id: 's1',
    agent_id: 'agent-1',
    subject: SUBJECT,
    artifactStore: {
      getArtifact: ({ id }) => Promise.resolve(options.existing?.id === id ? options.existing : undefined),
      createArtifactWithVersion,
      createVersion,
    },
    resolveObjectStore: () => ('objectStore' in options ? options.objectStore : OBJECT_STORE),
    artifactsConfig: ARTIFACTS_CONFIG,
  });
  return { provider, createArtifactWithVersion, createVersion };
}

describe('resolveTurnArtifactsProvider', () => {
  it('is undefined when the tenant has no object store', () => {
    expect(setup({ objectStore: undefined }).provider).toBeUndefined();
  });

  it('uses the configured limits', () => {
    expect(setup().provider?.limits).toEqual({ max_files: 5, max_total_bytes: 100 });
  });

  it.each([
    ['a missing artifact', undefined, 'Artifact not found: art-1'],
    [
      "another user's artifact",
      artifactRecord({ created_by_subject: { ...SUBJECT, subject_id: 'u2' } }),
      'User does not have access to push to this artifact.',
    ],
    ["the user's own artifact", artifactRecord(), undefined],
  ])('checks push access to %s', async (_name, existing, expected) => {
    const { provider } = setup(existing === undefined ? {} : { existing });
    await expect(provider?.store.checkPushAccess({ artifact_id: 'art-1' })).resolves.toBe(expected);
  });

  it('creates artifacts and versions bound to the session', async () => {
    const { provider, createArtifactWithVersion, createVersion } = setup();
    const files_metadata = FILES_METADATA;
    const id = provider?.store.newArtifactId({ name: 'Q3 report' }) ?? '';

    expect(id).toMatch(/^[0-9a-z]{26}$/);
    await expect(
      provider?.store.createArtifactWithVersion({ id, name: '  Q3   report ', files_metadata }),
    ).resolves.toMatchObject({ version: 1 });
    await provider?.store.createVersion({ artifact_id: id, files_metadata });

    const createdBy = { created_by_subject: SUBJECT, created_by_session_id: 's1', created_by_agent_id: 'agent-1' };
    expect(createArtifactWithVersion).toHaveBeenCalledWith({
      id,
      tenant_id: 't1',
      name: 'Q3 report',
      files_metadata,
      ...createdBy,
    });
    expect(createVersion).toHaveBeenCalledWith({ tenant_id: 't1', artifact_id: id, files_metadata, ...createdBy });
  });

  it('rejects an invalid artifact name', async () => {
    const { provider, createArtifactWithVersion } = setup();
    expect(() => provider?.store.newArtifactId({ name: 'a/b' })).toThrow('Invalid artifact name');
    await expect(
      provider?.store.createArtifactWithVersion({ id: 'x', name: 'a/b', files_metadata: FILES_METADATA }),
    ).rejects.toThrow('Invalid artifact name');
    expect(createArtifactWithVersion).not.toHaveBeenCalled();
  });
});
