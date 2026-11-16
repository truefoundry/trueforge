import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import path from 'node:path';
import { Readable } from 'node:stream';
import type {
  ArtifactFileRecord,
  ArtifactRecord,
  ArtifactVersionRecord,
  IArtifactStore,
  ListArtifactVersionsResult,
} from '../db/artifactStore';
import { ArtifactSlugConflictError } from '../db/artifactStore';
import { newId } from '../utils/id';
import {
  collectArtifactBundle,
  type ArtifactLimits,
  type CollectedBundle,
  type SandboxFileReader,
} from './collectBundle';
import { signArtifactContentToken } from './contentToken';
import { rewriteSiteAbsoluteUrls } from './rewriteSiteUrls';
import { generateArtifactSlug, isValidArtifactSlug, normalizeSlugInput } from './slug';
import type { ArtifactBlobStorage, ArtifactStorageBackendName } from './storage/ArtifactBlobStorage';

export class ArtifactRequestError extends Error {
  readonly statusCode: 403 | 404 | 409 | 413 | 422;
  readonly code: string;

  constructor(
    statusCode: ArtifactRequestError['statusCode'],
    code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ArtifactRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ArtifactVersionView extends ArtifactVersionRecord {
  files: ArtifactFileRecord[];
}

export interface ArtifactView extends ArtifactRecord {
  url: string;
  latest: ArtifactVersionRecord;
}

export interface BundlePreview {
  root: string;
  entry_path: string;
  entry_content_type: CollectedBundle['entryContentType'];
  files: { path: string; size_bytes: number }[];
  missing: string[];
  total_size_bytes: number;
  changes: { added: number; removed: number; changed: number } | undefined;
}

export interface PublishResult {
  artifact: ArtifactView;
  version: ArtifactVersionView;
  deduplicated: boolean;
}

interface StorageRegistry {
  write: ArtifactBlobStorage;
  get(backend: ArtifactStorageBackendName): ArtifactBlobStorage | undefined;
}

export class ArtifactService<TTransaction> {
  readonly #store: IArtifactStore<TTransaction>;
  readonly #storage: StorageRegistry;
  readonly #withTransaction: <T>(callback: (transaction: TTransaction) => Promise<T>) => Promise<T>;
  readonly #limits: ArtifactLimits;
  readonly #maxTenantBytes: number;
  readonly #signingKey: string;
  /** HMAC key for content URLs. The content route verifies tokens with the same key. */
  get signingKey(): string {
    return this.#signingKey;
  }
  readonly #urlForSlug: (slug: string) => string;

  constructor(deps: {
    store: IArtifactStore<TTransaction>;
    storage: StorageRegistry;
    withTransaction: <T>(callback: (transaction: TTransaction) => Promise<T>) => Promise<T>;
    limits: ArtifactLimits;
    maxTenantBytes: number;
    signingKey: string;
    urlForSlug: (slug: string) => string;
  }) {
    this.#store = deps.store;
    this.#storage = deps.storage;
    this.#withTransaction = deps.withTransaction;
    this.#limits = deps.limits;
    this.#maxTenantBytes = deps.maxTenantBytes;
    this.#signingKey = deps.signingKey;
    this.#urlForSlug = deps.urlForSlug;
  }

  async list(input: {
    tenantId: string;
    limit: number;
    pageToken: string | undefined;
    slug: string | undefined;
    sessionId: string | undefined;
    createdBySubjectId: string | undefined;
    query: string | undefined;
  }): Promise<{
    data: ArtifactView[];
    pagination: Awaited<ReturnType<IArtifactStore['listArtifacts']>>['pagination'];
  }> {
    const page = await this.#store.listArtifacts({
      tenant_id: input.tenantId,
      limit: input.limit,
      page_token: input.pageToken,
      slug: input.slug,
      session_id: input.sessionId,
      created_by_subject_id: input.createdBySubjectId,
      query: input.query,
    });
    const latest = await this.#store.listLatestVersions({
      tenant_id: input.tenantId,
      artifact_ids: page.data.map(record => record.id),
    });
    const latestByArtifact = new Map(latest.map(version => [version.artifact_id, version]));
    const data = page.data.map(record => this.#view(record, requireLatest(record, latestByArtifact.get(record.id))));
    return { data, pagination: page.pagination };
  }

  async get(input: { tenantId: string; artifactId: string }): Promise<ArtifactView> {
    const record = await this.#requireArtifact(input);
    return this.#toView(record);
  }

  async preview(input: {
    sandbox: SandboxFileReader;
    entryPath: string;
    artifactId: string | undefined;
    tenantId: string;
  }): Promise<BundlePreview> {
    const bundle = await collectArtifactBundle({
      entryPath: input.entryPath,
      sandbox: input.sandbox,
      limits: this.#limits,
    });
    let changes: BundlePreview['changes'];
    if (input.artifactId !== undefined) {
      const artifact = await this.#requireArtifact({ tenantId: input.tenantId, artifactId: input.artifactId });
      const latest = await this.#latestVersion(artifact);
      changes = latest === undefined ? undefined : diffFiles(latest.files, bundle);
    }
    return {
      root: bundle.root,
      entry_path: bundle.entryPath,
      entry_content_type: bundle.entryContentType,
      files: bundle.files.map(file => ({ path: file.bundlePath, size_bytes: file.sizeBytes })),
      missing: bundle.missing,
      total_size_bytes: bundle.totalSizeBytes,
      changes,
    };
  }

  async publishNew(input: {
    tenantId: string;
    subject: Subject;
    title: string;
    description: string | null;
    slug: string | undefined;
    note: string | null;
    sandbox: SandboxFileReader;
    entryPath: string;
    sessionId: string;
    turnId: string;
  }): Promise<PublishResult> {
    const bundle = await collectArtifactBundle({
      entryPath: input.entryPath,
      sandbox: input.sandbox,
      limits: this.#limits,
    });
    const requestedSlug = input.slug === undefined ? undefined : normalizeSlugInput(input.slug);
    if (requestedSlug !== undefined && !isValidArtifactSlug(requestedSlug)) {
      throw new ArtifactRequestError(
        422,
        'invalid_slug',
        'Slug must be 3–64 lowercase letters, numbers, and single hyphens',
      );
    }
    await this.#assertQuotaAllows({ tenantId: input.tenantId, incomingBytes: bundle.totalSizeBytes });
    const artifactId = newId();
    const versionId = newId();
    const location = await this.#upload(input.tenantId, artifactId, versionId, bundle);
    let slug = requestedSlug ?? generateArtifactSlug(input.title);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const published = await this.#withTransaction(async transaction => {
          const artifact = await this.#store.insertArtifact(
            {
              id: artifactId,
              tenant_id: input.tenantId,
              slug,
              title: input.title,
              description: input.description,
              created_by_subject: input.subject,
            },
            transaction,
          );
          const version = await this.#store.insertVersion(
            versionInput({
              versionId,
              tenantId: input.tenantId,
              artifactId: artifact.id,
              version: 1,
              bundle,
              sessionId: input.sessionId,
              turnId: input.turnId,
              note: input.note,
              location,
              subject: input.subject,
            }),
            transaction,
          );
          await this.#assertQuotaHolds({ tenantId: input.tenantId, transaction });
          return { artifact: { ...artifact, latest_version: 1 }, version };
        });
        const files = bundle.files.map(toFileRecord);
        return {
          artifact: this.#view(published.artifact, published.version),
          version: { ...published.version, files },
          deduplicated: false,
        };
      } catch (error) {
        const slugTaken = error instanceof ArtifactSlugConflictError;
        if (slugTaken && requestedSlug === undefined && attempt < 4) {
          slug = generateArtifactSlug(input.title);
          continue;
        }
        await this.#storage.write.deletePrefix({ prefix: location.prefix });
        if (slugTaken) {
          throw new ArtifactRequestError(409, 'slug_taken', 'This link is already used by another artifact', {
            cause: error,
          });
        }
        throw error;
      }
    }
    await this.#storage.write.deletePrefix({ prefix: location.prefix });
    throw new ArtifactRequestError(409, 'slug_taken', 'Could not allocate a unique link');
  }

  async publishVersion(input: {
    tenantId: string;
    artifactId: string;
    subject: Subject;
    isAdmin: boolean;
    note: string | null;
    sandbox: SandboxFileReader;
    entryPath: string;
    sessionId: string;
    turnId: string;
  }): Promise<PublishResult> {
    const existing = await this.#requireArtifact({ tenantId: input.tenantId, artifactId: input.artifactId });
    this.#assertCanManage(existing, input.subject, input.isAdmin);
    const bundle = await collectArtifactBundle({
      entryPath: input.entryPath,
      sandbox: input.sandbox,
      limits: this.#limits,
    });
    const current = await this.#latestVersion(existing);
    if (current?.manifest_sha256 === bundle.manifestSha256) {
      const view = await this.#toView(existing);
      return { artifact: view, version: current, deduplicated: true };
    }
    await this.#assertQuotaAllows({ tenantId: input.tenantId, incomingBytes: bundle.totalSizeBytes });
    const versionId = newId();
    const location = await this.#upload(input.tenantId, existing.id, versionId, bundle);
    try {
      const published = await this.#withTransaction(async transaction => {
        const locked = await this.#store.getArtifactForUpdate(
          { tenant_id: input.tenantId, id: existing.id },
          transaction,
        );
        if (locked === undefined) {
          throw new ArtifactRequestError(404, 'not_found', 'Artifact not found');
        }
        const latest = await this.#store.getVersion(
          { tenant_id: input.tenantId, artifact_id: locked.id, version: locked.latest_version },
          transaction,
        );
        if (latest?.manifest_sha256 === bundle.manifestSha256) {
          return { artifact: locked, version: latest, deduplicated: true, discardPrefix: true };
        }
        const version = await this.#store.insertVersion(
          versionInput({
            versionId,
            tenantId: input.tenantId,
            artifactId: locked.id,
            version: locked.latest_version + 1,
            bundle,
            sessionId: input.sessionId,
            turnId: input.turnId,
            note: input.note,
            location,
            subject: input.subject,
          }),
          transaction,
        );
        await this.#assertQuotaHolds({ tenantId: input.tenantId, transaction });
        return {
          artifact: { ...locked, latest_version: version.version },
          version,
          deduplicated: false,
          discardPrefix: false,
        };
      });
      if (published.discardPrefix) {
        await this.#storage.write.deletePrefix({ prefix: location.prefix });
        const files = await this.#store.listFiles({
          tenant_id: input.tenantId,
          artifact_version_id: published.version.id,
        });
        const version = { ...published.version, files };
        return { artifact: this.#view(published.artifact, version), version, deduplicated: true };
      }
      const files = bundle.files.map(toFileRecord);
      const version = { ...published.version, files };
      return { artifact: this.#view(published.artifact, version), version, deduplicated: false };
    } catch (error) {
      await this.#storage.write.deletePrefix({ prefix: location.prefix });
      throw error;
    }
  }

  async update(input: {
    tenantId: string;
    artifactId: string;
    subject: Subject;
    isAdmin: boolean;
    title: string;
    description: string | null | undefined;
  }): Promise<ArtifactView> {
    const existing = await this.#requireArtifact(input);
    this.#assertCanManage(existing, input.subject, input.isAdmin);
    const updated = await this.#store.updateArtifact({
      tenant_id: input.tenantId,
      id: input.artifactId,
      title: input.title,
      description: input.description,
    });
    if (updated === undefined) {
      throw new ArtifactRequestError(404, 'not_found', 'Artifact not found');
    }
    return this.#toView(updated);
  }

  async delete(input: {
    tenantId: string;
    artifactId: string;
    subject: Subject;
    isAdmin: boolean;
  }): Promise<unknown[]> {
    const existing = await this.#requireArtifact(input);
    this.#assertCanManage(existing, input.subject, input.isAdmin);
    const locations = await this.#store.listVersionLocations({ tenant_id: input.tenantId, artifact_id: existing.id });
    const deleted = await this.#withTransaction(transaction =>
      this.#store.deleteArtifact({ tenant_id: input.tenantId, id: existing.id }, transaction),
    );
    if (!deleted) {
      throw new ArtifactRequestError(404, 'not_found', 'Artifact not found');
    }
    const storageFailures: unknown[] = [];
    for (const location of locations) {
      const storage = this.#storage.get(location.storage_backend);
      if (storage === undefined) {
        continue;
      }
      try {
        await storage.deletePrefix({ prefix: location.storage_location });
      } catch (error) {
        storageFailures.push(error);
      }
    }
    return storageFailures;
  }

  async getVersion(input: { tenantId: string; artifactId: string; version: number }): Promise<ArtifactVersionView> {
    await this.#requireArtifact(input);
    const version = await this.#store.getVersion({
      tenant_id: input.tenantId,
      artifact_id: input.artifactId,
      version: input.version,
    });
    if (version === undefined) {
      throw new ArtifactRequestError(404, 'not_found', 'Artifact version not found');
    }
    const files = await this.#store.listFiles({ tenant_id: input.tenantId, artifact_version_id: version.id });
    return { ...version, files };
  }

  async listVersions(input: {
    tenantId: string;
    artifactId: string;
    limit: number;
    pageToken: string | undefined;
  }): Promise<{ data: ArtifactVersionView[]; pagination: ListArtifactVersionsResult['pagination'] }> {
    await this.#requireArtifact(input);
    const page = await this.#store.listVersions({
      tenant_id: input.tenantId,
      artifact_id: input.artifactId,
      limit: input.limit,
      page_token: input.pageToken,
    });
    const rows = await this.#store.listFilesForVersions({
      tenant_id: input.tenantId,
      artifact_version_ids: page.data.map(version => version.id),
    });
    const filesByVersion = new Map<string, ArtifactFileRecord[]>();
    for (const row of rows) {
      const existing = filesByVersion.get(row.artifact_version_id) ?? [];
      existing.push(row.file);
      filesByVersion.set(row.artifact_version_id, existing);
    }
    return {
      data: page.data.map(version => ({ ...version, files: filesByVersion.get(version.id) ?? [] })),
      pagination: page.pagination,
    };
  }

  contentToken(input: { tenantId: string; versionId: string }): { token: string; expiresAt: string } {
    return signArtifactContentToken({
      tenantId: input.tenantId,
      versionId: input.versionId,
      signingKey: this.#signingKey,
    });
  }

  async openFile(input: { tenantId: string; versionId: string; filePath: string }): Promise<{
    stream: Readable;
    mediaType: string;
    bundlePath: string;
    version: ArtifactVersionRecord;
    files: ArtifactFileRecord[];
  }> {
    const version = await this.#versionById(input.tenantId, input.versionId);
    const files = await this.#store.listFiles({ tenant_id: input.tenantId, artifact_version_id: version.id });
    const bundlePath = input.filePath === '' ? version.entry_path : input.filePath;
    const file = files.find(item => item.path === bundlePath);
    if (file === undefined) {
      throw new ArtifactRequestError(404, 'not_found', 'Artifact file not found');
    }
    const storage = this.#storageFor(version);
    const stream = await storage.get({ prefix: version.storage_location, path: file.path });
    return { stream, mediaType: file.media_type, bundlePath: file.path, version, files };
  }

  async openDownload(input: { tenantId: string; artifactId: string; version: number }): Promise<{
    single: { stream: Readable; filename: string; mediaType: string } | undefined;
    bundle: { files: { path: string; stream: Readable }[]; filename: string } | undefined;
  }> {
    const version = await this.getVersion(input);
    const storage = this.#storageFor(version);
    if (version.files.length === 1) {
      const file = version.files[0];
      if (file === undefined) {
        throw new ArtifactRequestError(404, 'not_found', 'Artifact file not found');
      }
      const stream = await storage.get({ prefix: version.storage_location, path: file.path });
      return {
        single: { stream, filename: path.posix.basename(file.path), mediaType: file.media_type },
        bundle: undefined,
      };
    }
    const files = [];
    for (const file of version.files) {
      files.push({
        path: file.path,
        stream: await storage.get({ prefix: version.storage_location, path: file.path }),
      });
    }
    return { single: undefined, bundle: { files, filename: `v${String(version.version)}.zip` } };
  }

  async #upload(
    tenantId: string,
    artifactId: string,
    versionId: string,
    bundle: CollectedBundle,
  ): Promise<{ prefix: string; backend: ArtifactStorageBackendName }> {
    const prefix = this.#storage.write.resolvePrefix({ key: `${tenantId}/${artifactId}/${versionId}` });
    for (const file of bundle.files) {
      await this.#storage.write.put({
        prefix,
        path: file.bundlePath,
        body: file.body,
        mediaType: file.mediaType,
      });
    }
    return { prefix, backend: this.#storage.write.backend };
  }

  async #requireArtifact(input: { tenantId: string; artifactId: string }): Promise<ArtifactRecord> {
    const record = await this.#store.getArtifact({ tenant_id: input.tenantId, id: input.artifactId });
    if (record === undefined) {
      throw new ArtifactRequestError(404, 'not_found', 'Artifact not found');
    }
    return record;
  }

  #assertCanManage(artifact: ArtifactRecord, subject: Subject, isAdmin: boolean): void {
    if (isAdmin || artifact.created_by_subject.subject_id === subject.subject_id) {
      return;
    }
    throw new ArtifactRequestError(403, 'forbidden', 'Only the creator or an admin can change this artifact');
  }

  async #latestVersion(artifact: ArtifactRecord): Promise<ArtifactVersionView | undefined> {
    if (artifact.latest_version < 1) {
      return undefined;
    }
    const version = await this.#store.getVersion({
      tenant_id: artifact.tenant_id,
      artifact_id: artifact.id,
      version: artifact.latest_version,
    });
    if (version === undefined) {
      return undefined;
    }
    const files = await this.#store.listFiles({ tenant_id: artifact.tenant_id, artifact_version_id: version.id });
    return { ...version, files };
  }

  async #toView(record: ArtifactRecord): Promise<ArtifactView> {
    const latest = await this.#store.getVersion({
      tenant_id: record.tenant_id,
      artifact_id: record.id,
      version: record.latest_version,
    });
    return this.#view(record, requireLatest(record, latest));
  }

  #view(record: ArtifactRecord, latest: ArtifactVersionRecord): ArtifactView {
    return { ...record, url: this.#urlForSlug(record.slug), latest };
  }

  /** Rejects an upload up front; the in-transaction recheck below closes most of the race between publishes. */
  async #assertQuotaAllows(input: { tenantId: string; incomingBytes: number }): Promise<void> {
    const used = await this.#store.sumVersionBytes({ tenant_id: input.tenantId });
    if (used + input.incomingBytes > this.#maxTenantBytes) {
      throw quotaExceeded();
    }
  }

  async #assertQuotaHolds(input: { tenantId: string; transaction: TTransaction }): Promise<void> {
    const used = await this.#store.sumVersionBytes({ tenant_id: input.tenantId }, input.transaction);
    if (used > this.#maxTenantBytes) {
      throw quotaExceeded();
    }
  }

  async #versionById(tenantId: string, versionId: string): Promise<ArtifactVersionRecord> {
    const version = await this.#store.getVersionById({ tenant_id: tenantId, id: versionId });
    if (version === undefined) {
      throw new ArtifactRequestError(404, 'not_found', 'Artifact version not found');
    }
    return version;
  }

  #storageFor(version: ArtifactVersionRecord): ArtifactBlobStorage {
    const storage = this.#storage.get(version.storage_backend);
    if (storage === undefined) {
      throw new ArtifactRequestError(404, 'not_found', 'Artifact storage is no longer configured');
    }
    return storage;
  }
}

function quotaExceeded(): ArtifactRequestError {
  return new ArtifactRequestError(
    413,
    'artifact_too_large',
    'Artifact storage quota exceeded. Delete unused artifacts.',
  );
}

function requireLatest(record: ArtifactRecord, latest: ArtifactVersionRecord | undefined): ArtifactVersionRecord {
  if (latest === undefined) {
    throw new Error(`Artifact ${record.id} has no version ${String(record.latest_version)}`);
  }
  return latest;
}

function versionInput(input: {
  versionId: string;
  tenantId: string;
  artifactId: string;
  version: number;
  bundle: CollectedBundle;
  sessionId: string;
  turnId: string;
  note: string | null;
  location: { prefix: string; backend: ArtifactStorageBackendName };
  subject: Subject;
}) {
  return {
    id: input.versionId,
    tenant_id: input.tenantId,
    artifact_id: input.artifactId,
    version: input.version,
    entry_path: input.bundle.entryPath,
    entry_content_type: input.bundle.entryContentType,
    file_count: input.bundle.files.length,
    total_size_bytes: input.bundle.totalSizeBytes,
    manifest_sha256: input.bundle.manifestSha256,
    session_id: input.sessionId,
    turn_id: input.turnId,
    source_root: input.bundle.root,
    note: input.note,
    storage_backend: input.location.backend,
    storage_location: input.location.prefix,
    created_by_subject: input.subject,
    files: input.bundle.files.map(toFileRecord),
  };
}

function toFileRecord(file: CollectedBundle['files'][number]): ArtifactFileRecord {
  return { path: file.bundlePath, size_bytes: file.sizeBytes, sha256: file.sha256, media_type: file.mediaType };
}

function diffFiles(
  previous: readonly ArtifactFileRecord[],
  next: CollectedBundle,
): { added: number; removed: number; changed: number } {
  const before = new Map(previous.map(file => [file.path, file.sha256]));
  const after = new Map(next.files.map(file => [file.bundlePath, file.sha256]));
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const [filePath, hash] of after) {
    const prior = before.get(filePath);
    if (prior === undefined) {
      added += 1;
    } else if (prior !== hash) {
      changed += 1;
    }
  }
  for (const filePath of before.keys()) {
    if (!after.has(filePath)) {
      removed += 1;
    }
  }
  return { added, removed, changed };
}

export function rewrittenHtml(input: {
  content: string;
  files: readonly string[];
  entryPath: string;
  urlPrefix: string;
}): string {
  const entryDirectory = path.posix.dirname(input.entryPath);
  return rewriteSiteAbsoluteUrls({
    content: input.content,
    files: input.files,
    entryDirectory: entryDirectory === '.' ? '' : entryDirectory,
    urlPrefix: input.urlPrefix,
  });
}
