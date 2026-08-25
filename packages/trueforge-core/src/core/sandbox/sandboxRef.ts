export interface SandboxRefParts {
  /** Provider kind from `SandboxProvider.type` (e.g. `daytona`, `local`) — plain string, not a closed union. */
  providerType: string;
  rawId: string;
}

const SANDBOX_ID_VERSION = 'v1';
const SANDBOX_ID_PREFIX = `${SANDBOX_ID_VERSION}:`;

/** `v1:type:raw` — raw may contain `:` (split only on the first two colons after version). */
export function formatSandboxId(parts: SandboxRefParts): string {
  return `${SANDBOX_ID_PREFIX}${parts.providerType}:${parts.rawId}`;
}

/**
 * Parse a fancy id. No `v1:` prefix, or a malformed `v1:` (too few segments),
 * → `{ kind: 'legacy', rawId: fullString }` so carry-forward stays safe.
 */
export function parseSandboxId(
  sandboxId: string,
): { kind: 'v1'; parts: SandboxRefParts } | { kind: 'legacy'; rawId: string } {
  if (!sandboxId.startsWith(SANDBOX_ID_PREFIX)) {
    return { kind: 'legacy', rawId: sandboxId };
  }
  const rest = sandboxId.slice(SANDBOX_ID_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0 || colon === rest.length - 1) {
    return { kind: 'legacy', rawId: sandboxId };
  }
  return {
    kind: 'v1',
    parts: { providerType: rest.slice(0, colon), rawId: rest.slice(colon + 1) },
  };
}

/** Raw id for provider calls. Legacy ids pass through unchanged. */
export function rawSandboxId(sandboxId: string): string {
  const parsed = parseSandboxId(sandboxId);
  return parsed.kind === 'v1' ? parsed.parts.rawId : parsed.rawId;
}

/** Carry-forward gate for turn admit / download. Type mismatch drops the id (create fresh). */
export function existingSandboxIdForProvider(params: {
  existingSandboxId: string | undefined;
  currentProviderType: string;
}): string | undefined {
  if (params.existingSandboxId === undefined) {
    return undefined;
  }
  const parsed = parseSandboxId(params.existingSandboxId);
  if (parsed.kind === 'v1' && parsed.parts.providerType !== params.currentProviderType) {
    return undefined;
  }
  return params.existingSandboxId;
}
