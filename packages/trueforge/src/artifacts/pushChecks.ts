import type { ArtifactValidateResult } from '@truefoundry/trueforge-core/core';
import { normalize } from 'node:path/posix';

export interface ArtifactPushLimits {
  max_files: number;
  max_total_bytes: number;
}

export interface ArtifactPushFile {
  // Relative to the pushed directory; also the object key suffix.
  relative_path: string;
  size_bytes: number;
  sha256_b64: string;
}

export type ArtifactPushCheckResult =
  { ok: true; files: ArtifactPushFile[]; entry_point: string; total_bytes: number } | { ok: false; errors: string[] };

function isSafeRelativePath(path: string): boolean {
  return (
    !path.startsWith('/') && !path.includes('\\') && path.split('/').every(s => s !== '' && s !== '.' && s !== '..')
  );
}

/** Checks the sandbox's validate result against the push limits; `entry_point` is relative to the pushed dir. */
export function checkArtifactPush(input: {
  validated: ArtifactValidateResult;
  entry_point: string;
  limits: ArtifactPushLimits;
}): ArtifactPushCheckResult {
  const { validated, limits } = input;
  if (!validated.success || validated.error !== null) {
    return { ok: false, errors: [validated.error ?? 'validation failed'] };
  }
  const errors: string[] = [];
  const files = validated.files;
  if (files.length === 0) {
    errors.push('directory has no files');
  }
  if (files.length > limits.max_files) {
    errors.push(`too many files: ${String(files.length)} > ${String(limits.max_files)}`);
  }
  let totalBytes = 0;
  for (const file of files) {
    if (!isSafeRelativePath(file.relative_path)) {
      errors.push(`invalid path: ${file.relative_path}`);
    } else if (file.size_bytes <= 0) {
      errors.push(`empty file: ${file.relative_path}`);
    }
    totalBytes += file.size_bytes;
  }
  if (totalBytes > limits.max_total_bytes) {
    errors.push(`total size ${String(totalBytes)} bytes exceeds ${String(limits.max_total_bytes)} bytes`);
  }
  const entryPoint = normalize(input.entry_point);
  if (!files.some(f => f.relative_path === entryPoint)) {
    errors.push(`entry_point ${input.entry_point} is not a file in the directory`);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, files, entry_point: entryPoint, total_bytes: totalBytes };
}
