import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { Authenticator } from '../auth/authenticator';
import type { RequestContext } from '../auth/identity';
import { extractRequestToken } from '../auth/token';
import configuration from '../config';
import { createTrueFoundryRequestContext } from './accessToken';
import type { GetSessionResponse } from './TrueFoundryServiceFoundryServerClient';

/** Narrow port used by the authenticator (avoids depending on the full SFY client). */
export interface TrueFoundrySessionClient {
  getSession(accessToken: string): Promise<GetSessionResponse>;
}

export class TrueFoundryAuthenticator implements Authenticator {
  readonly #client: TrueFoundrySessionClient;

  constructor(client: TrueFoundrySessionClient) {
    this.#client = client;
  }

  async authenticate(c: Context): Promise<RequestContext> {
    const token = extractRequestToken(c);
    if (!token) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }

    // Service key: accept TRUEFOUNDRY_API_KEY by string equality (no /v1/session).
    if (
      !configuration.STANDALONE &&
      configuration.TRUEFOUNDRY_API_KEY !== undefined &&
      token === configuration.TRUEFOUNDRY_API_KEY
    ) {
      return createTrueFoundryRequestContext({
        tenant_id: 'default',
        subject: {
          id: 'truefoundry-api-key',
          type: 'user',
          display_name: 'truefoundry-api-key',
        },
        roles: [],
        user_credential: token,
      });
    }

    const session = await this.#client.getSession(token);
    const { subject } = session.user;
    return createTrueFoundryRequestContext({
      tenant_id: session.user.tenantName,
      subject: {
        id: subject.subjectId,
        type: subject.subjectType,
        display_name: subject.subjectDisplayName ?? subject.subjectSlug ?? subject.subjectId,
      },
      roles: session.user.roles,
      user_credential: token,
    });
  }
}
