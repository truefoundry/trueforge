import type { Context } from 'hono';
import { jwtVerify } from 'jose';

import { toRequestContext, type IdTokenClaims } from './claims';
import type { RequestContext } from './identity';
import { getOidcVerify } from './oidc';
import { extractRequestToken, toBearerAuthorization } from './token';

export { extractRequestToken, readBearerToken, toBearerAuthorization } from './token';

/**
 * Bearer or cookie token → {@link RequestContext} when OIDC is enabled and the JWT is valid.
 * Missing/invalid JWT → `undefined`. Claim mapping failures after a successful verify rethrow.
 * Used by OIDC login soft-probes (callback already-authenticated redirect).
 */
export async function resolveOidcRequestContext(c: Context): Promise<RequestContext | undefined> {
  const oidcVerify = getOidcVerify();
  if (!oidcVerify) {
    return undefined;
  }

  const token = extractRequestToken(c);
  if (!token) {
    return undefined;
  }

  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
  try {
    ({ payload } = await jwtVerify(token, oidcVerify.jwks, {
      issuer: oidcVerify.issuer,
      audience: oidcVerify.audience,
    }));
  } catch {
    return undefined;
  }

  const claims: IdTokenClaims = { ...payload };
  return toRequestContext({
    claims,
    config: oidcVerify.oidcConfig,
    authorization: toBearerAuthorization(token),
  });
}
