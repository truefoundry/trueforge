import type { Context } from 'hono';

import type { RequestContext } from './identity';

export interface Authenticator {
  authenticate(c: Context): Promise<RequestContext>;
}
