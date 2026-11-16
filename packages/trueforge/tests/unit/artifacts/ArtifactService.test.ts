import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import type { Transaction } from 'kysely';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArtifactService } from '../../../src/artifacts/ArtifactService';
import type { SandboxFileReader } from '../../../src/artifacts/collectBundle';
import { LocalArtifactStorage } from '../../../src/artifacts/storage/LocalArtifactStorage';
import { SqliteArtifactStore } from '../../../src/db/sqlite/artifact-store/SqliteArtifactStore';
import type { Database } from '../../../src/db/sqlite/types';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../../db/sqlite/testDatabase';

const TENANT = 'default';
const SUBJECT: Subject = { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'User One' };
const PAGE = '<p>hello</p>';

type Service = ArtifactService<Transaction<Database>>;

function sandboxWith(files: Record<string, string>): SandboxFileReader {
  return {
    listDirectory: root =>
      Promise.resolve({
        files: Object.entries(files)
          .filter(([filePath]) => filePath.startsWith(`${root}/`))
          .map(([filePath, body]) => ({ path: filePath.slice(root.length + 1), sizeBytes: Buffer.byteLength(body) })),
        truncated: false,
      }),
    readFile: absolutePath => Promise.resolve(Buffer.from(files[absolutePath] ?? '')),
  };
}

describe('ArtifactService', () => {
  let env: SqliteTestDatabase;
  let storageRoot: string;
  let store: SqliteArtifactStore;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'artifact-service-'));
    store = new SqliteArtifactStore(env.db);
  }, 120_000);

  afterEach(async () => {
    await env.teardown();
    await rm(storageRoot, { recursive: true, force: true });
  });

  function createService(maxTenantBytes: number): Service {
    const storage = new LocalArtifactStorage(storageRoot);
    return new ArtifactService({
      store,
      storage: { write: storage, get: () => storage },
      withTransaction: callback => env.db.transaction().execute(callback),
      limits: { maxFiles: 20, maxFileBytes: 1024 * 1024, maxVersionBytes: 5 * 1024 * 1024 },
      maxTenantBytes,
      signingKey: 'test-key',
      urlForSlug: slug => `https://example.test/artifacts/${slug}`,
    });
  }

  async function uploadedPages(): Promise<number> {
    const entries = await readdir(path.join(storageRoot, TENANT), { recursive: true });
    return entries.filter(entry => entry.endsWith('index.html')).length;
  }

  function publish(service: Service, slug: string) {
    return service.publishNew({
      tenantId: TENANT,
      subject: SUBJECT,
      title: slug,
      description: null,
      slug,
      note: null,
      sandbox: sandboxWith({ [`/work/${slug}/index.html`]: PAGE }),
      entryPath: `/work/${slug}/index.html`,
      sessionId: 'session-1',
      turnId: 'turn-1',
    });
  }

  it('lists artifacts with their latest version from one batched lookup', async () => {
    const service = createService(1024 * 1024);
    await publish(service, 'first-report');
    await publish(service, 'second-report');
    const batched = jest.spyOn(store, 'listLatestVersions');
    const single = jest.spyOn(store, 'getVersion');

    const page = await service.list({
      tenantId: TENANT,
      limit: 25,
      pageToken: undefined,
      slug: undefined,
      sessionId: undefined,
      createdBySubjectId: undefined,
      query: undefined,
    });

    expect(page.data.map(artifact => artifact.slug).sort()).toEqual(['first-report', 'second-report']);
    expect(page.data.every(artifact => artifact.latest.version === 1)).toBe(true);
    expect(page.data[0]?.url).toContain('https://example.test/artifacts/');
    expect(batched).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
  });

  it('refuses to publish past the tenant storage quota before uploading', async () => {
    const service = createService(Buffer.byteLength(PAGE) * 2 - 1);
    await publish(service, 'first-report');

    await expect(publish(service, 'second-report')).rejects.toMatchObject({
      statusCode: 413,
      code: 'artifact_too_large',
    });

    expect(await store.sumVersionBytes({ tenant_id: TENANT })).toBe(Buffer.byteLength(PAGE));
    expect(await uploadedPages()).toBe(1);
  });

  it('rolls back and removes the upload when a concurrent publish used the quota first', async () => {
    const service = createService(Buffer.byteLength(PAGE) * 2 - 1);
    await publish(service, 'first-report');
    // The up-front check sees a stale total; the in-transaction check sees the real one.
    jest.spyOn(store, 'sumVersionBytes').mockResolvedValueOnce(0);

    await expect(publish(service, 'second-report')).rejects.toMatchObject({ statusCode: 413 });

    expect(await store.getArtifactBySlug({ tenant_id: TENANT, slug: 'second-report' })).toBeUndefined();
    expect(await store.sumVersionBytes({ tenant_id: TENANT })).toBe(Buffer.byteLength(PAGE));
    expect(await uploadedPages()).toBe(1);
  });

  it('skips the quota check when republishing identical content', async () => {
    const service = createService(Buffer.byteLength(PAGE));
    const first = await publish(service, 'first-report');

    const again = await service.publishVersion({
      tenantId: TENANT,
      artifactId: first.artifact.id,
      subject: SUBJECT,
      isAdmin: false,
      note: null,
      sandbox: sandboxWith({ '/work/first-report/index.html': PAGE }),
      entryPath: '/work/first-report/index.html',
      sessionId: 'session-1',
      turnId: 'turn-2',
    });

    expect(again.deduplicated).toBe(true);
  });

  it('keeps the description when update omits it and clears it with null', async () => {
    const service = createService(1024 * 1024);
    const created = await service.publishNew({
      tenantId: TENANT,
      subject: SUBJECT,
      title: 'Report',
      description: 'about',
      slug: 'described-report',
      note: null,
      sandbox: sandboxWith({ '/work/index.html': PAGE }),
      entryPath: '/work/index.html',
      sessionId: 'session-1',
      turnId: 'turn-1',
    });
    const base = { tenantId: TENANT, artifactId: created.artifact.id, subject: SUBJECT, isAdmin: false };

    const kept = await service.update({ ...base, title: 'Renamed', description: undefined });
    expect(kept.description).toBe('about');
    const cleared = await service.update({ ...base, title: 'Renamed', description: null });
    expect(cleared.description).toBeNull();
  });
});
