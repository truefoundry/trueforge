import { randomUUID } from 'node:crypto';
import { normalize } from 'node:path/posix';
import type { Logger } from 'winston';
import { z } from 'zod';
import type { IArtifactsProvider } from '../../artifacts/ArtifactsProvider';
import { checkArtifactPush } from '../../artifacts/pushChecks';
import { type CallToolResponse, toolResultResponse } from '../../mcp/IMCPServer';
import { defineTool, LocalToolMCP, type ToolDefinition } from '../../mcp/LocalToolMCP';
import type { HarnessSandbox, SandboxInfo } from '../../sandbox/Sandbox';
import type { AgentTracing } from '../../tracing/AgentTracing';
import { extractErrorLogFields } from '../../util/errorLogFields';
import type { AgentCapability } from '../AgentCapability';

export const ARTIFACTS_SERVER_ID = 'artifacts';
export const PUSH_ARTIFACT_TOOL_NAME = 'push_artifact';
const UPLOAD_CONCURRENCY = 4;

const pushArtifactInputSchema = z
  .object({
    artifact_id: z
      .string()
      .min(1)
      .optional()
      .describe('Artifact to add a new version to. Omit to create a new artifact.'),
    name: z.string().min(1).optional().describe('Name of the new artifact. Required when artifact_id is omitted.'),
    dir: z.string().min(1).describe('Absolute sandbox directory to push. Every file under it is uploaded.'),
    entry_point: z
      .string()
      .min(1)
      .transform(p => normalize(p))
      .describe('Main file, relative to dir (e.g. index.html).'),
  })
  .strict();

type PushArtifactInput = z.infer<typeof pushArtifactInputSchema>;

/** What the tool does and its limits — param details live on the Zod schema `.describe`s. */
function pushArtifactToolDescription(limits: IArtifactsProvider['limits']): string {
  return [
    'Save a sandbox directory as a new version of an artifact the user can open later. Returns the artifact id, version and URL.',
    '',
    'Rules:',
    `- At most ${String(limits.max_files)} files and ${String(limits.max_total_bytes)} bytes in total; empty files are rejected.`,
    '- Symlinks and special files are skipped.',
    '- entry_point must be a file in dir.',
    '- artifact_id must be an artifact this user created.',
  ].join('\n');
}

type SandboxMetadata = { sandboxInfo: SandboxInfo; sandboxCreated: boolean } | undefined;

function failure(error_message: string, sandbox: SandboxMetadata): CallToolResponse {
  return toolResultResponse({ text: JSON.stringify({ error_message }), isError: true, overrides: sandbox });
}

interface ArtifactsOptions {
  provider: IArtifactsProvider;
  sandbox: Pick<HarnessSandbox, 'gatherArtifactDirMetadata' | 'uploadArtifactFiles'>;
  tracing: AgentTracing;
  logger: Logger;
}

class ArtifactTools extends LocalToolMCP {
  readonly name = ARTIFACTS_SERVER_ID;
  readonly displayName = 'Artifacts';
  readonly #options: ArtifactsOptions;
  readonly #tools: ToolDefinition[];

  constructor(options: ArtifactsOptions) {
    super({ tracing: options.tracing });
    this.#options = options;
    this.#tools = [
      defineTool({
        name: PUSH_ARTIFACT_TOOL_NAME,
        description: pushArtifactToolDescription(options.provider.limits),
        schema: pushArtifactInputSchema,
        handler: input => this.push(input),
      }),
    ];
  }

  protected getTools(): ToolDefinition[] {
    return this.#tools;
  }

  private async push(input: PushArtifactInput): Promise<CallToolResponse> {
    const { provider, sandbox, logger } = this.#options;
    if (input.artifact_id !== undefined) {
      const denied = await provider.store.checkPushAccess({ artifact_id: input.artifact_id });
      if (denied !== undefined) {
        return failure(denied, undefined);
      }
    }

    let metadata: SandboxMetadata;
    try {
      const gathered = await sandbox.gatherArtifactDirMetadata(input.dir);
      metadata = { sandboxInfo: gathered.sandboxInfo, sandboxCreated: gathered.sandboxCreated };
      const check = checkArtifactPush({
        metadata: gathered.result,
        entry_point: input.entry_point,
        limits: provider.limits,
      });
      if (!check.ok) {
        return failure(`Validation failed: ${check.errors.join('; ')}`, metadata);
      }

      let artifactId = input.artifact_id;
      let newName: string | undefined;
      if (artifactId === undefined) {
        if (input.name === undefined) {
          return failure('name is required when artifact_id is omitted.', metadata);
        }
        newName = input.name;
        artifactId = provider.store.newArtifact({ name: newName }).id;
      }
      const pushId = randomUUID();
      const rootPath = `artifacts/${provider.tenantId}/${artifactId}/${pushId}`;
      const keyOf = (relativePath: string) => `${rootPath}/${relativePath}`;

      const files = await Promise.all(
        check.files.map(async file => {
          const { url, headers } = await provider.objectStore.presignPut({
            key: keyOf(file.relative_path),
            size_bytes: file.size_bytes,
            sha256_b64: file.sha256_b64,
          });
          return { relative_path: file.relative_path, url, headers };
        }),
      );
      const uploaded = await sandbox.uploadArtifactFiles({
        requestId: pushId,
        request: { concurrency: UPLOAD_CONCURRENCY, base_path: input.dir, files },
      });
      if (!uploaded.result.success) {
        const failed = uploaded.result.files
          .filter(f => f.error !== null || f.status === null || f.status >= 300)
          .map(f => `${f.path}: ${f.error ?? `HTTP ${String(f.status)}`}`);
        return failure(`Upload failed: ${failed.join('; ')}`, metadata);
      }

      // The presigned PUTs are the only writers under this fresh prefix and S3 rejects a body that does not
      // match the signed size and sha256, so the expected keys at the expected sizes mean the approved bytes.
      const stored = new Map(
        (await provider.objectStore.listObjects({ prefix: `${rootPath}/` })).map(o => [o.key, o.size_bytes]),
      );
      const mismatched = [
        ...check.files.filter(f => stored.get(keyOf(f.relative_path)) !== f.size_bytes).map(f => f.relative_path),
        ...(stored.size > check.files.length ? ['unexpected objects'] : []),
      ];
      if (mismatched.length > 0) {
        return failure(`Upload verification failed: ${mismatched.join(', ')}`, metadata);
      }

      const files_metadata = { entry_point: input.entry_point, total_bytes: check.total_bytes, root_path: rootPath };
      const version =
        newName === undefined
          ? await provider.store.createVersion({ artifact_id: artifactId, files_metadata })
          : await provider.store.createArtifactWithVersion({ id: artifactId, name: newName, files_metadata });
      if (version === undefined) {
        return failure(`Artifact not found: ${artifactId}`, metadata);
      }
      return toolResultResponse({
        text: JSON.stringify({
          artifact_id: artifactId,
          version: version.version,
          // TODO: placeholder; no UI or server route serves this path yet.
          url: `/artifacts/${artifactId}/v${String(version.version)}`,
        }),
        overrides: metadata,
      });
    } catch (error) {
      logger.error('push_artifact failed', { ...extractErrorLogFields(error), reportable_error: { error } });
      return failure(`Push failed: ${error instanceof Error ? error.message : String(error)}`, metadata);
    }
  }
}

/** Root-thread `push_artifact`; mounted only when the turn has a sandbox and the host an artifacts provider. */
export function artifacts(options: ArtifactsOptions): AgentCapability {
  return { systemToolSets: [new ArtifactTools(options)] };
}
