/**
 * Peered turn id grammar: `<ulid>.<executorId>`. The executor segment names
 * the process that owns the running turn, so any replica can route a command
 * (e.g. cancel) to it.
 *
 * Server-owned on purpose: the shared request-reply transport only ever sees
 * a plain `executorId` — each host application defines and parses its own id
 * grammar in its own code.
 */
import { HTTPException } from 'hono/http-exception';
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

/** Decodes the owning executor; throws 400 for an id outside the grammar. */
export function executorFromTurnId(turnId: string): string {
  const parts = turnId.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new HTTPException(400, { message: `ID ${turnId} is not a valid turn id` });
  }
  return parts[1];
}
