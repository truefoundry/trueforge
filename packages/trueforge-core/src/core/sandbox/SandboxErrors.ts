export abstract class SandboxError extends Error {
  /**
   * Every sandbox failure is caused by the request itself — a bad path, a missing
   * or oversized file — so each subclass carries the status a host should reply with.
   * Listing the codes in use rather than `number` lets a typed route return this directly; adding
   * a subclass with a new code means widening this union and declaring it on the route.
   */
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

/** Daytona/TFY raw ids are `tenantName.<uuid>`. Fancy ids and local paths must not be passed here. */
export function validateSandboxOwnedByTenant(params: { sandboxId: string; tenantName: string }): void {
  const dotIndex = params.sandboxId.indexOf('.');
  if (dotIndex === -1 || params.sandboxId.slice(0, dotIndex) !== params.tenantName) {
    throw new SandboxTenantMismatchError(params.tenantName);
  }
}

class SandboxPathTraversalError extends SandboxError {
  readonly statusCode = 400;

  constructor(path: string) {
    super(`Path must not contain ".." segments: ${path}`);
    this.name = 'SandboxPathTraversalError';
  }
}

const PATH_TRAVERSAL_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

export function validateNoPathTraversal(path: string): void {
  if (PATH_TRAVERSAL_RE.test(path)) {
    throw new SandboxPathTraversalError(path);
  }
}
