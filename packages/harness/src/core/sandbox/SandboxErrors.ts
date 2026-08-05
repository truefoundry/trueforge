export abstract class SandboxError extends Error {
  abstract readonly statusCode: number;
}

export class SandboxFileNotFoundError extends SandboxError {
  readonly statusCode = 404;

  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = 'SandboxFileNotFoundError';
  }
}

export class SandboxNotAvailableError extends SandboxError {
  readonly statusCode = 410;

  constructor(sandboxId: string) {
    super(`Sandbox '${sandboxId}' no longer exists — it may have been auto-deleted`);
    this.name = 'SandboxNotAvailableError';
  }
}

export class SandboxPathIsDirectoryError extends SandboxError {
  readonly statusCode = 400;

  constructor(path: string) {
    super(`Path is a directory, not a file: ${path}`);
    this.name = 'SandboxPathIsDirectoryError';
  }
}

export class SandboxFileTooLargeError extends SandboxError {
  readonly statusCode = 413;
  readonly fileSize: number;
  readonly maxSize: number;

  constructor(path: string, fileSize: number, maxSize: number) {
    super(`File too large: ${path} (${String(fileSize)} bytes, max ${String(maxSize)})`);
    this.name = 'SandboxFileTooLargeError';
    this.fileSize = fileSize;
    this.maxSize = maxSize;
  }
}

class SandboxTenantMismatchError extends SandboxError {
  readonly statusCode = 403;

  constructor(requestTenant: string) {
    super(`Sandbox does not belong to tenant ${requestTenant}`);
    this.name = 'SandboxTenantMismatchError';
  }
}

class SandboxPathTraversalError extends SandboxError {
  readonly statusCode = 400;

  constructor(path: string) {
    super(`Path must not contain ".." segments: ${path}`);
    this.name = 'SandboxPathTraversalError';
  }
}

class SandboxInvalidPathError extends SandboxError {
  readonly statusCode = 400;

  constructor({ path, reason }: { path: string; reason: string }) {
    super(`Path ${reason}: ${path}`);
    this.name = 'SandboxInvalidPathError';
  }
}

export function validateSandboxOwnedByTenant(sandboxId: string, tenantName: string): void {
  const dotIndex = sandboxId.indexOf('.');
  if (dotIndex === -1 || sandboxId.substring(0, dotIndex) !== tenantName) {
    throw new SandboxTenantMismatchError(tenantName);
  }
}

const PATH_TRAVERSAL_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

export function hasPathTraversal(path: string): boolean {
  return PATH_TRAVERSAL_RE.test(path);
}

export function validateNoPathTraversal(path: string): void {
  if (hasPathTraversal(path)) {
    throw new SandboxPathTraversalError(path);
  }
}

/** Linux PATH_MAX / NAME_MAX: beyond these the kernel refuses the path outright. */
const MAX_PATH_BYTES = 4096;
const MAX_SEGMENT_BYTES = 255;

/**
 * Every check a caller-supplied download path must pass. Shape violations are rejected here
 * rather than at the provider, which reports them as opaque backend failures indistinguishable
 * from real infrastructure errors.
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
