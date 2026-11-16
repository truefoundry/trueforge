/**
 * Artifacts API (mounted at /api/v1/artifacts).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { InvalidPageTokenError, type Sessions } from '@truefoundry/trueforge-core/agent-session';
import { listSandboxFiles, rawSandboxId, SandboxError } from '@truefoundry/trueforge-core/core';
import { ZipArchive } from 'archiver';
import { HTTPException } from 'hono/http-exception';
import { Readable } from 'node:stream';
import type { Logger } from 'winston';
import {
  ArtifactRequestError,
  ArtifactService,
  type ArtifactVersionView,
  type ArtifactView,
} from '../artifacts/ArtifactService';
import type { SandboxFileReader } from '../artifacts/collectBundle';
import { ArtifactBundleError } from '../artifacts/collectBundle';
import { createdBySubjectFromRequestContext, hasAdminRole, type ResolveRequestContext } from '../auth/identity';
import configuration, { effectivePublicBaseUrl, getPublicUiBasePath } from '../config';
import type { ArtifactVersionRecord, IArtifactStore } from '../db/artifactStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import {
  createArtifactRoute,
  createArtifactVersionRoute,
  deleteArtifactRoute,
  downloadArtifactVersionRoute,
  getArtifactContentTokenRoute,
  getArtifactRoute,
  getArtifactVersionRoute,
  listArtifactsRoute,
  listArtifactVersionsRoute,
  previewArtifactBundleRoute,
  updateArtifactRoute,
} from '../routes/artifactRoutes';
import { validateSandboxFilePath } from '../runtime/sandboxFilePath';
import { resolveSandboxProvider } from '../runtime/sessionResources';
import type { Artifact, ArtifactVersion, ArtifactVersionSummary } from '../schemas/artifact';

export interface ArtifactRouterDeps<TTransaction> {
  artifactService: ArtifactService<TTransaction>;
  sessions: Sessions<TTransaction>;
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
  logger: Logger;
}

function toWireVersionSummary(version: ArtifactVersionRecord): ArtifactVersionSummary {
  return {
    artifact_id: version.artifact_id,
    version: version.version,
    note: version.note,
    entry_path: version.entry_path,
    entry_content_type: version.entry_content_type,
    file_count: version.file_count,
    total_size_bytes: version.total_size_bytes,
    session_id: version.session_id,
    turn_id: version.turn_id,
    source_root: version.source_root,
    storage_backend: version.storage_backend,
    created_by_subject: version.created_by_subject,
    created_at: version.created_at,
  };
}

function toWireVersion(version: ArtifactVersionView): ArtifactVersion {
  return {
    ...toWireVersionSummary(version),
    files: version.files.map(file => ({
      path: file.path,
      size_bytes: file.size_bytes,
      sha256: file.sha256,
      media_type: file.media_type,
    })),
  };
}

function toWireArtifact(artifact: ArtifactView): Artifact {
  return {
    id: artifact.id,
    slug: artifact.slug,
    title: artifact.title,
    description: artifact.description,
    url: artifact.url,
    latest_version: toWireVersionSummary(artifact.latest),
    created_by_subject: artifact.created_by_subject,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
  };
}

function fail(error: unknown): never {
  if (error instanceof ArtifactRequestError || error instanceof ArtifactBundleError) {
    throw new HTTPException(error.statusCode, { message: error.message, cause: error });
  }
  if (error instanceof InvalidPageTokenError) {
    throw new HTTPException(400, { message: error.message, cause: error });
  }
  if (error instanceof SandboxError) {
    throw new HTTPException(error.statusCode === 404 ? 409 : error.statusCode, {
      message: 'The sandbox for this turn is no longer available',
      cause: error,
    });
  }
  throw error;
}

export function createArtifactsRouter<TTransaction>(deps: ArtifactRouterDeps<TTransaction>): OpenAPIHono {
  const router = new OpenAPIHono();

  const openSandbox = async ({
    tenantId,
    sessionId,
    turnId,
    subjectId,
  }: {
    tenantId: string;
    sessionId: string;
    turnId: string;
    subjectId: string;
  }): Promise<{ reader: SandboxFileReader; sessionId: string; turnId: string }> => {
    const session = await deps.sessions.get({ tenant_id: tenantId, session_id: sessionId });
    if (!session) {
      throw new ArtifactRequestError(404, 'not_found', `Session not found: ${sessionId}`);
    }
    if (session.record.created_by_subject.subject_id !== subjectId) {
      throw new ArtifactRequestError(403, 'forbidden', 'Only the session owner can publish its files');
    }
    const turn = await session.getTurn(turnId);
    if (!turn) {
      throw new ArtifactRequestError(404, 'not_found', `Turn not found: ${turnId}`);
    }
    const sandboxId = turn.snapshot.sandbox_info?.sandbox_id;
    if (sandboxId === undefined) {
      throw new ArtifactRequestError(409, 'sandbox_unavailable', 'This turn has no sandbox');
    }
    const provider = await resolveSandboxProvider({
      tenant_id: tenantId,
      store: deps.sandboxProviderStore,
      logger: deps.logger,
      sessionId,
    });
    if (provider === undefined) {
      throw new ArtifactRequestError(409, 'sandbox_unavailable', 'No sandbox provider is configured');
    }
    const resolvedId = rawSandboxId(sandboxId);
    const reader: SandboxFileReader = {
      async listDirectory(root) {
        try {
          return await listSandboxFiles({
            exec: params => provider.exec(params),
            sandboxId: resolvedId,
            root,
            maxFiles: configuration.ARTIFACT_MAX_LISTED_FILES,
          });
        } catch (error) {
          throw new ArtifactRequestError(
            409,
            'sandbox_unavailable',
            'The sandbox for this turn is no longer available',
            {
              cause: error,
            },
          );
        }
      },
      async readFile(absolutePath) {
        try {
          return await provider.downloadFile({ sandboxId: resolvedId, path: absolutePath });
        } catch (error) {
          throw new ArtifactRequestError(
            409,
            'sandbox_unavailable',
            'The sandbox for this turn is no longer available',
            {
              cause: error,
            },
          );
        }
      },
    };
    return { reader, sessionId, turnId };
  };

  const listHandler: RouteHandler<typeof listArtifactsRoute> = async c => {
    try {
      const query = c.req.valid('query');
      const requestContext = deps.resolveRequestContext(c);
      const page = await deps.artifactService.list({
        tenantId: requestContext.tenant_id,
        limit: query.limit,
        pageToken: query.page_token,
        slug: query.slug,
        sessionId: query.session_id,
        createdBySubjectId: query.created_by_me === true ? requestContext.subject.id : undefined,
        query: query.q,
      });
      return c.json({ data: page.data.map(toWireArtifact), pagination: page.pagination }, 200);
    } catch (error) {
      fail(error);
    }
  };

  const previewHandler: RouteHandler<typeof previewArtifactBundleRoute> = async c => {
    try {
      const body = c.req.valid('json');
      validateSandboxFilePath(body.entry_path);
      const requestContext = deps.resolveRequestContext(c);
      const sandbox = await openSandbox({
        tenantId: requestContext.tenant_id,
        sessionId: body.session_id,
        turnId: body.turn_id,
        subjectId: requestContext.subject.id,
      });
      const preview = await deps.artifactService.preview({
        sandbox: sandbox.reader,
        entryPath: body.entry_path,
        artifactId: body.artifact_id,
        tenantId: requestContext.tenant_id,
      });
      return c.json({ data: { ...preview, changes: preview.changes ?? null } }, 200);
    } catch (error) {
      fail(error);
    }
  };

  const createHandler: RouteHandler<typeof createArtifactRoute> = async c => {
    try {
      const body = c.req.valid('json');
      validateSandboxFilePath(body.source.entry_path);
      const requestContext = deps.resolveRequestContext(c);
      const sandbox = await openSandbox({
        tenantId: requestContext.tenant_id,
        sessionId: body.source.session_id,
        turnId: body.source.turn_id,
        subjectId: requestContext.subject.id,
      });
      const published = await deps.artifactService.publishNew({
        tenantId: requestContext.tenant_id,
        subject: createdBySubjectFromRequestContext(requestContext),
        title: body.title,
        description: body.description ?? null,
        slug: body.slug,
        note: body.note ?? null,
        sandbox: sandbox.reader,
        entryPath: body.source.entry_path,
        sessionId: body.source.session_id,
        turnId: body.source.turn_id,
      });
      return c.json({ data: toWireArtifact(published.artifact) }, 201);
    } catch (error) {
      fail(error);
    }
  };

  const getHandler: RouteHandler<typeof getArtifactRoute> = async c => {
    try {
      const { artifact_id: artifactId } = c.req.valid('param');
      const requestContext = deps.resolveRequestContext(c);
      const artifact = await deps.artifactService.get({ tenantId: requestContext.tenant_id, artifactId });
      return c.json({ data: toWireArtifact(artifact) }, 200);
    } catch (error) {
      fail(error);
    }
  };

  const updateHandler: RouteHandler<typeof updateArtifactRoute> = async c => {
    try {
      const { artifact_id: artifactId } = c.req.valid('param');
      const body = c.req.valid('json');
      const requestContext = deps.resolveRequestContext(c);
      const artifact = await deps.artifactService.update({
        tenantId: requestContext.tenant_id,
        artifactId,
        subject: createdBySubjectFromRequestContext(requestContext),
        isAdmin: hasAdminRole(requestContext),
        title: body.title,
        description: body.description,
      });
      return c.json({ data: toWireArtifact(artifact) }, 200);
    } catch (error) {
      fail(error);
    }
  };

  const deleteHandler: RouteHandler<typeof deleteArtifactRoute> = async c => {
    try {
      const { artifact_id: artifactId } = c.req.valid('param');
      const requestContext = deps.resolveRequestContext(c);
      const storageFailures = await deps.artifactService.delete({
        tenantId: requestContext.tenant_id,
        artifactId,
        subject: createdBySubjectFromRequestContext(requestContext),
        isAdmin: hasAdminRole(requestContext),
      });
      for (const failure of storageFailures) {
        deps.logger.warn('Artifact row was deleted but its files could not be removed', { error: failure });
      }
      return c.json({}, 200);
    } catch (error) {
      fail(error);
    }
  };

  const listVersionsHandler: RouteHandler<typeof listArtifactVersionsRoute> = async c => {
    try {
      const { artifact_id: artifactId } = c.req.valid('param');
      const query = c.req.valid('query');
      const requestContext = deps.resolveRequestContext(c);
      const page = await deps.artifactService.listVersions({
        tenantId: requestContext.tenant_id,
        artifactId,
        limit: query.limit,
        pageToken: query.page_token,
      });
      return c.json({ data: page.data.map(toWireVersion), pagination: page.pagination }, 200);
    } catch (error) {
      fail(error);
    }
  };

  const createVersionHandler: RouteHandler<typeof createArtifactVersionRoute> = async c => {
    try {
      const { artifact_id: artifactId } = c.req.valid('param');
      const body = c.req.valid('json');
      validateSandboxFilePath(body.source.entry_path);
      const requestContext = deps.resolveRequestContext(c);
      const sandbox = await openSandbox({
        tenantId: requestContext.tenant_id,
        sessionId: body.source.session_id,
        turnId: body.source.turn_id,
        subjectId: requestContext.subject.id,
      });
      const published = await deps.artifactService.publishVersion({
        tenantId: requestContext.tenant_id,
        artifactId,
        subject: createdBySubjectFromRequestContext(requestContext),
        isAdmin: hasAdminRole(requestContext),
        note: body.note ?? null,
        sandbox: sandbox.reader,
        entryPath: body.source.entry_path,
        sessionId: body.source.session_id,
        turnId: body.source.turn_id,
      });
      const payload = { data: toWireVersion(published.version) };
      if (published.deduplicated) {
        return c.json(payload, 200);
      }
      return c.json(payload, 201);
    } catch (error) {
      fail(error);
    }
  };

  const getVersionHandler: RouteHandler<typeof getArtifactVersionRoute> = async c => {
    try {
      const { artifact_id: artifactId, version } = c.req.valid('param');
      const requestContext = deps.resolveRequestContext(c);
      const found = await deps.artifactService.getVersion({ tenantId: requestContext.tenant_id, artifactId, version });
      return c.json({ data: toWireVersion(found) }, 200);
    } catch (error) {
      fail(error);
    }
  };

  const tokenHandler: RouteHandler<typeof getArtifactContentTokenRoute> = async c => {
    try {
      const { artifact_id: artifactId, version } = c.req.valid('param');
      const requestContext = deps.resolveRequestContext(c);
      const found = await deps.artifactService.getVersion({ tenantId: requestContext.tenant_id, artifactId, version });
      const signed = deps.artifactService.contentToken({ tenantId: requestContext.tenant_id, versionId: found.id });
      const prefix = getPublicUiBasePath().replace(/\/$/, '');
      return c.json(
        {
          data: {
            token: signed.token,
            base_url: `${prefix}/artifact-content/${signed.token}/`,
            expires_at: signed.expiresAt,
          },
        },
        200,
      );
    } catch (error) {
      fail(error);
    }
  };

  const downloadHandler: RouteHandler<typeof downloadArtifactVersionRoute> = async c => {
    try {
      const { artifact_id: artifactId, version } = c.req.valid('param');
      const requestContext = deps.resolveRequestContext(c);
      const download = await deps.artifactService.openDownload({
        tenantId: requestContext.tenant_id,
        artifactId,
        version,
      });
      if (download.single !== undefined) {
        const body = Readable.toWeb(download.single.stream);
        return c.body(body, 200, {
          'Content-Type': download.single.mediaType,
          'Content-Disposition': attachmentDisposition(download.single.filename),
          'X-Content-Type-Options': 'nosniff',
        });
      }
      const bundle = download.bundle;
      if (bundle === undefined) {
        throw new ArtifactRequestError(404, 'not_found', 'Artifact version not found');
      }
      const archive = new ZipArchive({ zlib: { level: 6 } });
      for (const file of bundle.files) {
        archive.append(file.stream, { name: file.path });
      }
      void archive.finalize();
      return c.body(Readable.toWeb(archive), 200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': attachmentDisposition(bundle.filename),
        'X-Content-Type-Options': 'nosniff',
      });
    } catch (error) {
      fail(error);
    }
  };

  router.openapi(listArtifactsRoute, listHandler);
  router.openapi(previewArtifactBundleRoute, previewHandler);
  router.openapi(createArtifactRoute, createHandler);
  router.openapi(getArtifactRoute, getHandler);
  router.openapi(updateArtifactRoute, updateHandler);
  router.openapi(deleteArtifactRoute, deleteHandler);
  router.openapi(listArtifactVersionsRoute, listVersionsHandler);
  router.openapi(createArtifactVersionRoute, createVersionHandler);
  router.openapi(getArtifactVersionRoute, getVersionHandler);
  router.openapi(getArtifactContentTokenRoute, tokenHandler);
  router.openapi(downloadArtifactVersionRoute, downloadHandler);
  return router;
}

function attachmentDisposition(filename: string): string {
  const cleaned = filename.replace(/["\r\n]/g, '');
  return `attachment; filename="${cleaned}"`;
}

export function artifactPublicUrl(slug: string): string {
  const base = effectivePublicBaseUrl();
  if (base === '') {
    return `/artifacts/${slug}`;
  }
  const url = new URL(base);
  const prefix = url.pathname.replace(/\/$/, '');
  url.pathname = `${prefix}/artifacts/${slug}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function createArtifactService<TTransaction>(deps: {
  store: IArtifactStore<TTransaction>;
  storage: ConstructorParameters<typeof ArtifactService<TTransaction>>[0]['storage'];
  withTransaction: WithTransaction<TTransaction>;
  signingKey: string;
}): ArtifactService<TTransaction> {
  return new ArtifactService({
    store: deps.store,
    storage: deps.storage,
    withTransaction: deps.withTransaction,
    limits: {
      maxFiles: configuration.ARTIFACT_MAX_FILES,
      maxFileBytes: configuration.ARTIFACT_MAX_FILE_BYTES,
      maxVersionBytes: configuration.ARTIFACT_MAX_VERSION_BYTES,
    },
    maxTenantBytes: configuration.ARTIFACT_MAX_TENANT_BYTES,
    signingKey: deps.signingKey,
    urlForSlug: artifactPublicUrl,
  });
}
