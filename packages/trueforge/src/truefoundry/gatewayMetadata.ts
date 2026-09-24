import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { TurnMetadata } from '../db/turnMetadata';

/** Gateway header carrying stringified JSON metadata. */
export const X_TFY_METADATA = 'x-tfy-metadata';

/** Prefix for harness-owned keys. */
export const TFG_METADATA_PREFIX = 'tfg';

const GatewayMetadataSchema = z.record(z.string().min(1), z.string());

/**
 * Parse inbound `x-tfy-metadata`. Rejects malformed values rather than dropping them.
 */
export function parseGatewayMetadataHeader(raw: string): Record<string, string> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    throw new HTTPException(400, { message: `${X_TFY_METADATA} must be a JSON object`, cause: error });
  }
  const parsed = GatewayMetadataSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `${X_TFY_METADATA} must be a JSON object of string values`,
    });
  }
  return parsed.data;
}

/**
 * Reject a malformed inbound `x-tfy-metadata` before the turn starts.
 * No-op when the header is absent (e.g. schedule runs).
 */
export function assertGatewayMetadataRequestHeaders(headers: Record<string, string> | undefined): void {
  if (headers === undefined) {
    return;
  }
  const raw = headerValue(headers, X_TFY_METADATA);
  if (raw !== undefined) {
    parseGatewayMetadataHeader(raw);
  }
}

export function buildGatewayMetadata(input: {
  sessionId: string;
  turnId: string;
  agent?: { id: string; name: string | null };
}): Record<string, string> {
  // Session.metadata is intentionally omitted for now (Unicode-in-header risk); re-add later.
  const metadata: Record<string, string> = {
    [`${TFG_METADATA_PREFIX}.session_id`]: input.sessionId,
    [`${TFG_METADATA_PREFIX}.turn_id`]: input.turnId,
  };
  const { agent } = input;
  if (agent !== undefined) {
    metadata[`${TFG_METADATA_PREFIX}.agent_id`] = agent.id;
    if (agent.name !== null) {
      metadata[`${TFG_METADATA_PREFIX}.agent_name`] = agent.name;
    }
  }
  return metadata;
}

/** Caller requestMetadata first; harness tfg.* always win. */
export function mergeGatewayMetadata(input: {
  sessionId: string;
  turnId: string;
  agent?: { id: string; name: string | null };
  requestMetadata?: Record<string, string> | undefined;
}): Record<string, string> {
  return {
    ...input.requestMetadata,
    ...buildGatewayMetadata({
      sessionId: input.sessionId,
      turnId: input.turnId,
      ...(input.agent === undefined ? {} : { agent: input.agent }),
    }),
  };
}

export function gatewayMetadataHeaders(metadata: Record<string, string>): Record<string, string> {
  if (Object.keys(metadata).length === 0) {
    return {};
  }
  return { [X_TFY_METADATA]: JSON.stringify(metadata) };
}

/** Metadata header for a turn. Reads `x-tfy-metadata` from the raw request headers. */
export function gatewayMetadataHeadersForTurn(turnMetadata: TurnMetadata): Record<string, string> {
  const raw = headerValue(turnMetadata.requestHeaders, X_TFY_METADATA);
  return gatewayMetadataHeaders(
    mergeGatewayMetadata({
      sessionId: turnMetadata.sessionId,
      turnId: turnMetadata.turnId,
      ...(turnMetadata.agent === undefined ? {} : { agent: turnMetadata.agent }),
      requestMetadata: raw === undefined ? undefined : parseGatewayMetadataHeader(raw),
    }),
  );
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (headers === undefined) {
    return undefined;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}
