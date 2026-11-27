import { join } from 'node:path/posix';
import { z } from 'zod';
import { shellEscape } from '../provider/Provider';

const UPLOAD_REQUESTS_DIR_NAME = 'uploads';
// Above the script's own upload deadline, so the script reports timeouts itself.
export const ARTIFACT_UPLOAD_EXEC_TIMEOUT_SECONDS = 300;
// Hashes every file before size limits apply, so allow for a large dir.
export const ARTIFACT_METADATA_EXEC_TIMEOUT_SECONDS = 120;

export interface ArtifactUploadRequest {
  concurrency: number;
  base_path: string;
  files: { relative_path: string; url: string; headers: Record<string, string> }[];
}

const ArtifactResultEnvelope = {
  success: z.boolean(),
  exit_code: z.number().int(),
};

export const ArtifactDirMetadataSchema = z.object({
  ...ArtifactResultEnvelope,
  error: z.string().nullable(),
  files: z.array(
    z.object({
      relative_path: z.string(),
      size_bytes: z.number().int(),
      sha256_b64: z.string(),
    }),
  ),
});
export type ArtifactDirMetadata = z.infer<typeof ArtifactDirMetadataSchema>;

export const ArtifactUploadResultSchema = z.object({
  ...ArtifactResultEnvelope,
  files: z.array(
    z.object({
      path: z.string(),
      status: z.number().int().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
export type ArtifactUploadResult = z.infer<typeof ArtifactUploadResultSchema>;

export function artifactUploadRequestPath(params: { artifactsDir: string; requestId: string }): string {
  return join(params.artifactsDir, UPLOAD_REQUESTS_DIR_NAME, `uploadFile_${params.requestId}.json`);
}

// Also creates the owner-only folder the upload request is written to.
export function buildArtifactMetadataCommand(params: {
  scriptPath: string;
  artifactsDir: string;
  dir: string;
}): string {
  return [
    `umask 077 && mkdir -p ${shellEscape(join(params.artifactsDir, UPLOAD_REQUESTS_DIR_NAME))}`,
    `python3 ${shellEscape(params.scriptPath)} metadata ${shellEscape(params.dir)}`,
  ].join(' && ');
}

export function buildArtifactUploadCommand(params: { scriptPath: string; requestPath: string }): string {
  const request = shellEscape(params.requestPath);
  return `python3 ${shellEscape(params.scriptPath)} upload ${request}; rc=$?; rm -f ${request}; exit $rc`;
}

export function buildArtifactUploadRequestFile(request: ArtifactUploadRequest): Buffer {
  return Buffer.from(JSON.stringify({ ...request, created_at: new Date().toISOString() }), 'utf-8');
}
