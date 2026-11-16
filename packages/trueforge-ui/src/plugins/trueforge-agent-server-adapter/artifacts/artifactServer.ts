/**
 * ArtifactServer adapter. Calls `/api/v1/artifacts` directly until the generated SDK has an artifacts group.
 */
import { z } from 'zod';

import type {
  Artifact,
  ArtifactBundlePreview,
  ArtifactContentToken,
  ArtifactFile,
  ArtifactServer,
  ArtifactVersion,
  ArtifactVersionSummary,
  CreateArtifactRequest,
  CreateArtifactVersionRequest,
  ListArtifactsParams,
  ListResult,
  PreviewArtifactBundleRequest,
  Subject,
  UpdateArtifactRequest,
} from '../../../server/types.js';
import { resolveTrueForgeBaseUrl, type CreateTrueForgeClientOptions } from '../client.js';

const WireSubjectSchema = z.object({
  subject_id: z.string(),
  subject_type: z.string(),
  subject_display_name: z.string(),
});
type WireSubject = z.infer<typeof WireSubjectSchema>;

const WireFileSchema = z.object({
  path: z.string(),
  size_bytes: z.number(),
  sha256: z.string(),
  media_type: z.string(),
});
type WireFile = z.infer<typeof WireFileSchema>;

const WireVersionSummarySchema = z.object({
  artifact_id: z.string(),
  version: z.number(),
  note: z.string().nullable(),
  entry_path: z.string(),
  entry_content_type: z.enum(['html', 'markdown']),
  file_count: z.number(),
  total_size_bytes: z.number(),
  session_id: z.string(),
  turn_id: z.string(),
  source_root: z.string(),
  storage_backend: z.enum(['local', 's3']),
  created_by_subject: WireSubjectSchema,
  created_at: z.string(),
});
type WireVersionSummary = z.infer<typeof WireVersionSummarySchema>;

const WireVersionSchema = WireVersionSummarySchema.extend({
  files: z.array(WireFileSchema),
});
type WireVersion = z.infer<typeof WireVersionSchema>;

const WireArtifactSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  latest_version: WireVersionSummarySchema,
  created_by_subject: WireSubjectSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
type WireArtifact = z.infer<typeof WireArtifactSchema>;

const WirePreviewSchema = z.object({
  data: z.object({
    root: z.string(),
    entry_path: z.string(),
    entry_content_type: z.enum(['html', 'markdown']),
    files: z.array(z.object({ path: z.string(), size_bytes: z.number() })),
    missing: z.array(z.string()),
    total_size_bytes: z.number(),
    changes: z.object({ added: z.number(), removed: z.number(), changed: z.number() }).nullable(),
  }),
});

const WireTokenSchema = z.object({
  data: z.object({
    token: z.string(),
    base_url: z.string(),
    expires_at: z.string(),
  }),
});

const ErrorBodySchema = z.object({ error: z.object({ message: z.string().optional() }).optional() });

function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    pagination: z.object({
      next_page_token: z.string().optional(),
      previous_page_token: z.string().optional(),
    }),
  });
}

const ArtifactPageSchema = pageSchema(WireArtifactSchema);
const VersionPageSchema = pageSchema(WireVersionSchema);
const ArtifactDataSchema = z.object({ data: WireArtifactSchema });
const VersionDataSchema = z.object({ data: WireVersionSchema });

function toSubject(wire: WireSubject): Subject {
  return {
    subjectId: wire.subject_id,
    subjectType: wire.subject_type,
    subjectDisplayName: wire.subject_display_name,
  };
}

function toFile(wire: WireFile): ArtifactFile {
  return { path: wire.path, sizeBytes: wire.size_bytes, sha256: wire.sha256, mediaType: wire.media_type };
}

function toVersionSummary(wire: WireVersionSummary): ArtifactVersionSummary {
  return {
    artifactId: wire.artifact_id,
    version: wire.version,
    note: wire.note,
    entryPath: wire.entry_path,
    entryContentType: wire.entry_content_type,
    fileCount: wire.file_count,
    totalSizeBytes: wire.total_size_bytes,
    sessionId: wire.session_id,
    turnId: wire.turn_id,
    sourceRoot: wire.source_root,
    storageBackend: wire.storage_backend,
    createdBySubject: toSubject(wire.created_by_subject),
    createdAt: wire.created_at,
  };
}

function toVersion(wire: WireVersion): ArtifactVersion {
  return {
    ...toVersionSummary(wire),
    files: wire.files.map(toFile),
  };
}

function toArtifact(wire: WireArtifact): Artifact {
  return {
    id: wire.id,
    slug: wire.slug,
    title: wire.title,
    description: wire.description,
    url: wire.url,
    latestVersion: toVersionSummary(wire.latest_version),
    createdBySubject: toSubject(wire.created_by_subject),
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  };
}

function toList<T, U>(
  page: { data: T[]; pagination: { next_page_token?: string; previous_page_token?: string } },
  map: (item: T) => U,
): ListResult<U> {
  const next = page.pagination.next_page_token;
  const previous = page.pagination.previous_page_token;
  return {
    data: page.data.map(map),
    ...(next === undefined || next === '' ? {} : { nextPageToken: next }),
    ...(previous === undefined || previous === '' ? {} : { previousPageToken: previous }),
  };
}

export function createArtifactServer(options: CreateTrueForgeClientOptions = {}): ArtifactServer {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = resolveTrueForgeBaseUrl(options.baseUrl ?? '/').replace(/\/$/, '');

  async function send(input: {
    path: string;
    method?: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  }): Promise<Response> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined) search.set(key, String(value));
    }
    const query = search.toString();
    const response = await fetchFn(`${baseUrl}/api/v1/artifacts${input.path}${query === '' ? '' : `?${query}`}`, {
      method: input.method ?? 'GET',
      headers: {
        ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
        ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
    if (!response.ok) {
      let message = response.statusText;
      const body: unknown = await response.json().catch(() => null);
      const parsed = ErrorBodySchema.safeParse(body);
      const detail = parsed.success ? parsed.data.error?.message : undefined;
      if (detail != null && detail !== '') message = detail;
      throw new Error(message);
    }
    return response;
  }

  async function request<T>(schema: z.ZodType<T>, input: Parameters<typeof send>[0]): Promise<T> {
    const response = await send(input);
    const body: unknown = await response.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new Error('Unexpected artifact response');
    return parsed.data;
  }

  return {
    async listArtifacts(req?: ListArtifactsParams) {
      const page = await request(ArtifactPageSchema, {
        path: '',
        query: {
          limit: req?.limit,
          page_token: req?.pageToken,
          slug: req?.slug,
          session_id: req?.sessionId,
          created_by_me: req?.createdByMe,
          q: req?.query,
        },
      });
      return toList(page, toArtifact);
    },
    async getArtifact({ id }) {
      const response = await request(ArtifactDataSchema, { path: `/${encodeURIComponent(id)}` });
      return toArtifact(response.data);
    },
    async previewBundle(req: PreviewArtifactBundleRequest) {
      const response = await request(WirePreviewSchema, {
        path: '/bundle-preview',
        method: 'POST',
        body: {
          session_id: req.sessionId,
          turn_id: req.turnId,
          entry_path: req.entryPath,
          ...(req.artifactId === undefined ? {} : { artifact_id: req.artifactId }),
        },
      });
      return {
        root: response.data.root,
        entryPath: response.data.entry_path,
        entryContentType: response.data.entry_content_type,
        files: response.data.files.map(file => ({ path: file.path, sizeBytes: file.size_bytes })),
        missing: response.data.missing,
        totalSizeBytes: response.data.total_size_bytes,
        changes: response.data.changes,
      } satisfies ArtifactBundlePreview;
    },
    async createArtifact(req: CreateArtifactRequest) {
      const response = await request(ArtifactDataSchema, {
        path: '',
        method: 'POST',
        body: {
          title: req.title,
          ...(req.slug === undefined ? {} : { slug: req.slug }),
          ...(req.description === undefined ? {} : { description: req.description }),
          ...(req.note === undefined ? {} : { note: req.note }),
          source: { session_id: req.sessionId, turn_id: req.turnId, entry_path: req.entryPath },
        },
      });
      return toArtifact(response.data);
    },
    async updateArtifact(req: UpdateArtifactRequest) {
      const response = await request(ArtifactDataSchema, {
        path: `/${encodeURIComponent(req.id)}`,
        method: 'PUT',
        body: {
          title: req.title,
          ...(req.description === undefined ? {} : { description: req.description }),
        },
      });
      return toArtifact(response.data);
    },
    async deleteArtifact({ id }) {
      await send({ path: `/${encodeURIComponent(id)}`, method: 'DELETE' });
    },
    async listVersions(req) {
      const page = await request(VersionPageSchema, {
        path: `/${encodeURIComponent(req.artifactId)}/versions`,
        query: { limit: req.limit, page_token: req.pageToken },
      });
      return toList(page, toVersion);
    },
    async getVersion(req) {
      const response = await request(VersionDataSchema, {
        path: `/${encodeURIComponent(req.artifactId)}/versions/${String(req.version)}`,
      });
      return toVersion(response.data);
    },
    async createVersion(req: CreateArtifactVersionRequest) {
      const response = await request(VersionDataSchema, {
        path: `/${encodeURIComponent(req.artifactId)}/versions`,
        method: 'POST',
        body: {
          ...(req.note === undefined ? {} : { note: req.note }),
          source: { session_id: req.sessionId, turn_id: req.turnId, entry_path: req.entryPath },
        },
      });
      return toVersion(response.data);
    },
    async getContentToken(req) {
      const response = await request(WireTokenSchema, {
        path: `/${encodeURIComponent(req.artifactId)}/versions/${String(req.version)}/content-token`,
      });
      return {
        token: response.data.token,
        baseUrl: response.data.base_url,
        expiresAt: response.data.expires_at,
      } satisfies ArtifactContentToken;
    },
    async downloadVersion(req) {
      const response = await send({
        path: `/${encodeURIComponent(req.artifactId)}/versions/${String(req.version)}/download`,
      });
      return response.blob();
    },
  };
}
