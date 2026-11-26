import { join } from 'node:path/posix';
import { z } from 'zod';
import { shellEscape } from './provider/Provider';

// Bump the version when the script's request/result contract changes.
const ARTIFACT_TRANSFER_SCRIPT_NAME = 'artifact_transfer_v1.py';
// Must match REQUESTS_DIR in the script.
const REQUESTS_DIR_NAME = 'uploads';
// Above the script's own upload deadline, so the script reports timeouts itself.
export const ARTIFACT_UPLOAD_EXEC_TIMEOUT_SECONDS = 300;

export interface ArtifactUploadRequest {
  concurrency: number;
  base_path: string;
  files: { relative_path: string; url: string; headers: Record<string, string> }[];
}

const ArtifactResultEnvelope = {
  success: z.boolean(),
  exit_code: z.number().int(),
};

export const ArtifactValidateResultSchema = z.object({
  mode: z.literal('validate'),
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
export type ArtifactValidateResult = z.infer<typeof ArtifactValidateResultSchema>;

export const ArtifactUploadResultSchema = z.object({
  mode: z.literal('upload'),
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

export function artifactTransferScriptPath(transferDir: string): string {
  return join(transferDir, ARTIFACT_TRANSFER_SCRIPT_NAME);
}

export function artifactUploadRequestPath(params: { transferDir: string; requestId: string }): string {
  return join(params.transferDir, REQUESTS_DIR_NAME, `uploadFile_${params.requestId}.json`);
}

// Also creates the owner-only folder the upload request is written to.
export function buildArtifactValidateCommand(params: { transferDir: string; dir: string }): string {
  return [
    `umask 077 && mkdir -p ${shellEscape(join(params.transferDir, REQUESTS_DIR_NAME))}`,
    `python3 ${shellEscape(artifactTransferScriptPath(params.transferDir))} validate ${shellEscape(params.dir)}`,
  ].join(' && ');
}

export function buildArtifactUploadCommand(params: { transferDir: string; requestPath: string }): string {
  const script = shellEscape(artifactTransferScriptPath(params.transferDir));
  const request = shellEscape(params.requestPath);
  return `python3 ${script} upload ${request}; rc=$?; rm -f ${request}; exit $rc`;
}

export function buildArtifactUploadRequestFile(request: ArtifactUploadRequest): Buffer {
  return Buffer.from(JSON.stringify({ ...request, created_at: new Date().toISOString() }), 'utf-8');
}
