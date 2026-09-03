import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { jwtVerify } from 'jose';

import type { Authenticator } from './authenticator';
import { toRequestContext, type IdTokenClaims } from './claims';
import type { RequestContext } from './identity';
import { getOidcVerify } from './oidc';
import { extractRequestToken, toBearerAuthorization } from './token';

export class OidcAuthenticator implements Authenticator {
  async authenticate(c: Context): Promise<RequestContext> {
    const oidcVerify = getOidcVerify();
    if (!oidcVerify) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }

    const token = extractRequestToken(c);
    if (!token) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }

    let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
    try {
      ({ payload } = await jwtVerify(token, oidcVerify.jwks, {
        issuer: oidcVerify.issuer,
        audience: oidcVerify.audience,
      }));
    } catch {
      throw new HTTPException(401, { message: 'Authentication required' });
    }

    try {
      const claims: IdTokenClaims = { ...payload };
      return toRequestContext({
        claims,
        config: oidcVerify.oidcConfig,
        authorization: toBearerAuthorization(token),
      });
    } catch (error) {
      throw new HTTPException(401, { message: 'Authentication required', cause: error });
    }
  }
}
