/**
 * Peered turn id grammar: `<ulid>.<executorId>`. The executor segment names
 * the process that owns the running turn, so any replica can route a command
 * (e.g. cancel) to it. Bare ids (no dot) carry no ownership and are treated
 * as local-only.
 *
 * Server-owned on purpose: the shared request-reply transport only ever sees
 * a plain `executorId` — each host defines its own id grammar (the gateway
 * uses a 3-segment `<ulid>.<zone>.<executor>` grammar in its own app code).
 */
import { ulid } from 'ulid';

/**
 * Mints a peered turn id owned by `executorId`. The server calls this at turn
 * creation (the id is opaque to the session library); `executorFromTurnId`
 * is the matching decoder on the routing path.
 */
export function mintPeeredTurnId(executorId: string): string {
  if (!executorId || executorId.includes('.')) {
    throw new Error(`executorId must be a non-empty string without '.', got "${executorId}"`);
  }
  return `${ulid().toLowerCase()}.${executorId}`;
}

export function executorFromTurnId(turnId: string): string | undefined {
  const parts = turnId.split('.');
  if (parts.length !== 2 || !parts[1]) {
    return undefined;
  }
  return parts[1];
}
