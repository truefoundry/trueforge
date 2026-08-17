/**
 * Validation for caller-supplied sandbox download paths. This is an HTTP concern — the harness
 * library only guards its own file operations — so it lives with the route that accepts the path.
 */
import { SandboxError, validateNoPathTraversal } from '@truefoundry/trueforge-core/core';

class SandboxInvalidPathError extends SandboxError {
  readonly statusCode = 400;

  constructor({ path, reason }: { path: string; reason: string }) {
    super(`Path ${reason}: ${path}`);
    this.name = 'SandboxInvalidPathError';
  }
}

/**
 * Past these the kernel rejects the path before any file is opened. PATH_MAX (4096) counts the
 * terminating NUL, so the longest usable path is one byte shorter; NAME_MAX (255) does not.
 */
const MAX_PATH_BYTES = 4095;
const MAX_SEGMENT_BYTES = 255;

/**
 * Every check a caller-supplied download path must pass before it reaches a provider. Shape
 * violations are caught here because a provider reports them as opaque backend failures,
 * indistinguishable from a real outage.
 */
export function validateSandboxFilePath(path: string): void {
  if (!path.startsWith('/')) {
    throw new SandboxInvalidPathError({ path, reason: 'must be absolute' });
  }
  if (path.includes('\0')) {
    throw new SandboxInvalidPathError({ path, reason: 'must not contain a NUL byte' });
  }
  if (Buffer.byteLength(path) > MAX_PATH_BYTES) {
    throw new SandboxInvalidPathError({ path, reason: `must be at most ${String(MAX_PATH_BYTES)} bytes` });
  }
  if (path.split('/').some(segment => Buffer.byteLength(segment) > MAX_SEGMENT_BYTES)) {
    throw new SandboxInvalidPathError({
      path,
      reason: `must not have a segment longer than ${String(MAX_SEGMENT_BYTES)} bytes`,
    });
  }
  validateNoPathTraversal(path);
}
