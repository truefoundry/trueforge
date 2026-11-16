import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_MS = 60 * 60 * 1000;

export interface ArtifactContentTokenPayload {
  tenantId: string;
  versionId: string;
  expiresAtMs: number;
}

/** HMAC token bound to one version. The path after the token is not signed; the row lookup is. */
export function signArtifactContentToken(input: {
  tenantId: string;
  versionId: string;
  signingKey: string;
  now?: number;
}): { token: string; expiresAt: string } {
  const expiresAtMs = (input.now ?? Date.now()) + TOKEN_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ t: input.tenantId, v: input.versionId, e: expiresAtMs }),
    'utf8',
  ).toString('base64url');
  const signature = createHmac('sha256', input.signingKey).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt: new Date(expiresAtMs).toISOString() };
}

export function verifyArtifactContentToken(input: {
  token: string;
  signingKey: string;
  now?: number;
}): ArtifactContentTokenPayload | undefined {
  const separator = input.token.indexOf('.');
  if (separator <= 0) {
    return undefined;
  }
  const payload = input.token.slice(0, separator);
  const signature = input.token.slice(separator + 1);
  const expected = createHmac('sha256', input.signingKey).update(payload).digest('base64url');
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!isTokenRecord(parsed)) {
    return undefined;
  }
  const tenantId = parsed['t'];
  const versionId = parsed['v'];
  const expiresAtMs = parsed['e'];
  if (typeof tenantId !== 'string' || typeof versionId !== 'string' || typeof expiresAtMs !== 'number') {
    return undefined;
  }
  if (expiresAtMs <= (input.now ?? Date.now())) {
    return undefined;
  }
  return { tenantId, versionId, expiresAtMs };
}

function isTokenRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
