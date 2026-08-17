import { HTTPException } from 'hono/http-exception';
import { ulid } from 'ulid';

/**
 * Mints a turn id owned by `executorId`. The server calls this at turn
 * creation (the id is opaque to the session library); `executorFromTurnId`
 * is the matching decoder on the routing path.
 */
export function mintPeeredTurnId(executorId: string): string {
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
