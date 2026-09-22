/**
 * Request shape for {@link AgentChatServer.downloadSandboxFile}.
 * Turn-scoped hosts resolve the sandbox from `turnId` and may omit `sandboxId`;
 * hosts that address sandboxes directly still receive `sandboxId` when known.
 */
export interface SandboxDownloadRequest {
  sessionId: string;
  turnId: string;
  path: string;
  sandboxId?: string;
}

/**
 * Builds the host download request. Requires a saved session and a turn scope;
 * does not require `sandboxId` (it may be missing after resume when
 * `sandbox.created` fell outside the loaded history window).
 */
export function buildSandboxDownloadRequest(args: {
  sessionId: string | undefined;
  turnId: string;
  path: string;
  sandboxId?: string;
}): SandboxDownloadRequest {
  if (args.sessionId == null) {
    throw new Error('This session has not been saved yet, so its files cannot be downloaded.');
  }
  return {
    sessionId: args.sessionId,
    turnId: args.turnId,
    path: args.path,
    ...(args.sandboxId != null ? { sandboxId: args.sandboxId } : {}),
  };
}
