import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'winston';

const SOCKET_PARENT_MODE = 0o700;

/** Exists → warn, then rm + mkdir 0700. Reliability path for leftover UDS files (including watch restarts). */
export async function prepareCodeModeSocketParent(params: { path: string; logger: Logger }): Promise<void> {
  if (existsSync(params.path)) {
    params.logger.warn('Removing leftover Code Mode socket parent', { path: params.path });
    await rm(params.path, { recursive: true, force: true });
  }
  await mkdir(params.path, { recursive: true, mode: SOCKET_PARENT_MODE });
}

export async function removeCodeModeSocketParent(socketParentPath: string): Promise<void> {
  await rm(socketParentPath, { recursive: true, force: true });
}

/** Single path segment under the sandboxes parent (`_` when sessionId is missing or unsafe). */
export function localSandboxSessionSegment(sessionId: string | undefined): string {
  if (sessionId === undefined || sessionId.length === 0 || sessionId.includes('/') || sessionId.includes('..')) {
    return '_';
  }
  return sessionId;
}

/**
 * Removes one session's local sandbox root. The shared `_` fallback segment is
 * never touched; a missing root (including a missing parent) is a no-op.
 */
export async function removeLocalSandboxSessionRoot(params: {
  sandboxRootPathParent: string;
  sessionId: string;
}): Promise<void> {
  const segment = localSandboxSessionSegment(params.sessionId);
  if (segment === '_') {
    return;
  }
  await rm(join(params.sandboxRootPathParent, segment), { recursive: true, force: true });
}

export async function ensureLocalSandboxRootParent(sandboxRootPathParent: string): Promise<void> {
  await mkdir(sandboxRootPathParent, { recursive: true, mode: SOCKET_PARENT_MODE });
}
