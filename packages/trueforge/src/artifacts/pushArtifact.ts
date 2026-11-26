import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import {
  defineTool,
  extractErrorLogFields,
  LocalToolMCP,
  toolResultResponse,
  type AgentCapability,
  type AgentTracing,
  type HarnessSandbox,
  type SandboxInfo,
  type ToolDefinition,
} from '@truefoundry/trueforge-core/core';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'winston';
import { z } from 'zod';
import type { IArtifactStore } from '../db/artifactStore';
import { ArtifactNameSchema } from '../schemas/artifact';
import { checkArtifactPush, type ArtifactPushLimits } from './pushChecks';

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
    name: ArtifactNameSchema.optional().describe('Name of the new artifact. Required when artifact_id is omitted.'),
    dir: z.string().min(1).describe('Absolute sandbox directory to push. Every file under it is uploaded.'),
    entry_point: z.string().min(1).describe('Main file, relative to dir (e.g. index.html).'),
  })
  .strict();

type PushArtifactInput = z.infer<typeof pushArtifactInputSchema>;

const PUSH_ARTIFACT_TOOL_DESCRIPTION =
  'Save a sandbox directory as a new version of an artifact the user can open later. Returns the artifact id, version and URL.';

export interface ArtifactObject {
  key: string;
  size_bytes: number;
  sha256_b64: string;
}

/** Object storage the sandbox uploads to directly. */
export interface ArtifactUploadTransfer {
  /** PUT URL signed to the object's size and sha256; `headers` must be sent unchanged. */
  presignPut(object: ArtifactObject): Promise<{ url: string; headers: Record<string, string> }>;
  /** True when the object landed with the signed size and sha256. */
  verify(object: ArtifactObject): Promise<boolean>;
}

/** Process-wide stores `push_artifact` needs. */
export interface ArtifactPushStores {
  artifactStore: Pick<IArtifactStore, 'getArtifact' | 'createArtifact' | 'createVersion'>;
  transfer: ArtifactUploadTransfer;
}

export interface PushArtifactDeps extends ArtifactPushStores {
  limits: ArtifactPushLimits;
  sandbox: Pick<HarnessSandbox, 'validateArtifactDir' | 'uploadArtifactFiles'>;
  tenant_id: string;
  session_id: string;
  agent_id: string | null;
  subject: Subject;
  tracing: AgentTracing;
  logger: Logger;
}

type SandboxMetadata = { sandboxInfo: SandboxInfo; sandboxCreated: boolean } | undefined;

function failure(error_message: string, sandbox: SandboxMetadata) {
  return toolResultResponse({ text: JSON.stringify({ error_message }), isError: true, overrides: sandbox });
}

class PushArtifactTools extends LocalToolMCP {
  readonly name = ARTIFACTS_SERVER_ID;
  readonly displayName = 'Artifacts';
  readonly #deps: PushArtifactDeps;

  constructor(deps: PushArtifactDeps) {
    super({ tracing: deps.tracing });
    this.#deps = deps;
  }

  private tools: ToolDefinition[] = [
    defineTool({
      name: PUSH_ARTIFACT_TOOL_NAME,
      description: PUSH_ARTIFACT_TOOL_DESCRIPTION,
      schema: pushArtifactInputSchema,
      handler: input => this.push(input),
    }),
  ];

  protected getTools(): ToolDefinition[] {
    return this.tools;
  }

  private async push(input: PushArtifactInput) {
    const deps = this.#deps;
    const sandbox = deps.sandbox;
    let target: { type: 'existing'; id: string } | { type: 'new'; name: string };
    if (input.artifact_id !== undefined) {
      const artifact = await deps.artifactStore.getArtifact({ tenant_id: deps.tenant_id, id: input.artifact_id });
      if (artifact === undefined) {
        return failure(`Artifact not found: ${input.artifact_id}`, undefined);
      }
      if (artifact.created_by_subject.subject_id !== deps.subject.subject_id) {
        return failure('Only the artifact creator can push new versions.', undefined);
      }
      target = { type: 'existing', id: artifact.id };
    } else if (input.name !== undefined) {
      target = { type: 'new', name: input.name };
    } else {
      return failure('name is required when artifact_id is omitted.', undefined);
    }

    let metadata: SandboxMetadata;
    try {
      const validated = await sandbox.validateArtifactDir(input.dir);
      metadata = { sandboxInfo: validated.sandboxInfo, sandboxCreated: validated.sandboxCreated };
      const check = checkArtifactPush({
        validated: validated.result,
        entry_point: input.entry_point,
        limits: deps.limits,
      });
      if (!check.ok) {
        return failure(`Validation failed: ${check.errors.join('; ')}`, metadata);
      }

      const artifactId =
        target.type === 'existing'
          ? target.id
          : (
              await deps.artifactStore.createArtifact({
                tenant_id: deps.tenant_id,
                name: target.name,
                created_by_subject: deps.subject,
                created_by_session_id: deps.session_id,
                created_by_agent_id: deps.agent_id,
              })
            ).id;
      const pushId = randomUUID();
      const rootPath = `artifacts/${deps.tenant_id}/${artifactId}/${pushId}`;
      const keyOf = (relativePath: string) => `${rootPath}/${relativePath}`;

      const files = await Promise.all(
        check.files.map(async file => {
          const { url, headers } = await deps.transfer.presignPut({
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

      const verified = await Promise.all(
        check.files.map(file =>
          deps.transfer.verify({
            key: keyOf(file.relative_path),
            size_bytes: file.size_bytes,
            sha256_b64: file.sha256_b64,
          }),
        ),
      );
      const mismatched = check.files.filter((_, i) => !verified[i]).map(f => f.relative_path);
      if (mismatched.length > 0) {
        return failure(`Upload verification failed: ${mismatched.join(', ')}`, metadata);
      }

      const version = await deps.artifactStore.createVersion({
        tenant_id: deps.tenant_id,
        artifact_id: artifactId,
        files_metadata: { entry_point: check.entry_point, total_bytes: check.total_bytes, root_path: rootPath },
        created_by_subject: deps.subject,
        created_by_session_id: deps.session_id,
        created_by_agent_id: deps.agent_id,
      });
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
      deps.logger.error('push_artifact failed', { ...extractErrorLogFields(error), reportable_error: { error } });
      return failure(`Push failed: ${error instanceof Error ? error.message : String(error)}`, metadata);
    }
  }
}

/** Root-thread capability exposing `push_artifact`; only mounted when the turn has a sandbox. */
export function pushArtifactCapability(deps: PushArtifactDeps): AgentCapability {
  return { systemToolSets: [new PushArtifactTools(deps)] };
}
