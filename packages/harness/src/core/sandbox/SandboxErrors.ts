export abstract class SandboxError extends Error {
  /** Narrow rather than `number` so hosts can return it from a typed route without asserting. */
  abstract readonly statusCode: 400 | 403 | 404 | 410 | 413;
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

class SandboxPathNotAbsoluteError extends SandboxError {
  readonly statusCode = 400;

  constructor(path: string) {
    super(`Path must be absolute: ${path}`);
    this.name = 'SandboxPathNotAbsoluteError';
  }
}

export function validateSandboxOwnedByTenant(sandboxId: string, tenantName: string): void {
  const dotIndex = sandboxId.indexOf('.');
  if (dotIndex === -1 || sandboxId.substring(0, dotIndex) !== tenantName) {
    throw new SandboxTenantMismatchError(tenantName);
  }
}

const PATH_TRAVERSAL_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

export function validateNoPathTraversal(path: string): void {
  if (PATH_TRAVERSAL_RE.test(path)) {
    throw new SandboxPathTraversalError(path);
  }
}

/** Every check a caller-supplied download path must pass before it reaches a provider. */
export function validateSandboxFilePath(path: string): void {
  if (!path.startsWith('/')) {
    throw new SandboxPathNotAbsoluteError(path);
  }
  validateNoPathTraversal(path);
}
