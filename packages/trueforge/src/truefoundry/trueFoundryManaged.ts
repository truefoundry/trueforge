import type { Context } from 'hono';

import { RequestErrorResponseSchema } from '../schemas/errors';

export const TRUEFOUNDRY_MANAGED_STATUS = 424 as const;
export const TRUEFOUNDRY_MANAGED_MESSAGE = 'This resource is managed by TrueFoundry';

export function respondTrueFoundryManaged(c: Context) {
  return c.json({ error: { message: TRUEFOUNDRY_MANAGED_MESSAGE } }, TRUEFOUNDRY_MANAGED_STATUS);
}

export const trueFoundryManagedResponse = {
  content: { 'application/json': { schema: RequestErrorResponseSchema } },
  description: 'Resource is managed by TrueFoundry (`TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL` is set).',
} as const;
