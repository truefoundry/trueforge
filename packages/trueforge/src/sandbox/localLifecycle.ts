import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
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

export async function ensureLocalSandboxRootParent(sandboxRootPathParent: string): Promise<void> {
  await mkdir(sandboxRootPathParent, { recursive: true, mode: SOCKET_PARENT_MODE });
}
