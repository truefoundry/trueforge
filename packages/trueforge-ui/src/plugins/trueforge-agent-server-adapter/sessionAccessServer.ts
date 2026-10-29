import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';

import type { DirectoryUser, ListResult, SessionAccessGrant, SessionAccessServer } from '../../server/types.js';
import { toListResult } from './chatServer.js';
import { createTrueForgeClient, type CreateTrueForgeClientOptions } from './client.js';

/** `GET /users?ids=` rejects more than 100 ids. */
const USER_LOOKUP_CHUNK = 100;

export type CreateHarnessSessionAccessServerOptions = CreateTrueForgeClientOptions & {
  client?: TrueForge;
};

function toDirectoryUser(user: TrueForgeApi.User): DirectoryUser {
  return { id: user.id, displayName: user.displayName, email: user.email };
}

async function usersById({
  client,
  ids,
}: {
  client: TrueForge;
  ids: string[];
}): Promise<Map<string, TrueForgeApi.User>> {
  const byId = new Map<string, TrueForgeApi.User>();
  for (let start = 0; start < ids.length; start += USER_LOOKUP_CHUNK) {
    const page = await client.users.list({ ids: ids.slice(start, start + USER_LOOKUP_CHUNK).join(',') });
    for (const user of page.data) byId.set(user.id, user);
  }
  return byId;
}

async function toAccessGrants({
  client,
  grants,
}: {
  client: TrueForge;
  grants: TrueForgeApi.SessionGrant[];
}): Promise<SessionAccessGrant[]> {
  // Tenant-wide sharing is session.shared (a tenant grant); this port is user collaborators only.
  const userGrants = grants.filter(grant => grant.subject.subjectType === 'user');
  const users = await usersById({ client, ids: userGrants.map(grant => grant.subject.subjectId) });
  return userGrants.map(grant => {
    const user = users.get(grant.subject.subjectId);
    return {
      subjectType: 'user',
      subjectId: grant.subject.subjectId,
      displayName: user?.displayName ?? null,
      email: user?.email ?? null,
      createdAt: grant.createdAt,
    };
  });
}

export function createHarnessSessionAccessServer(
  options: CreateHarnessSessionAccessServerOptions = {},
): SessionAccessServer {
  const client = options.client ?? createTrueForgeClient(options);
  return {
    async listAccess({ sessionId }) {
      const { data } = await client.sessions.listGrants(sessionId);
      return toAccessGrants({ client, grants: data });
    },
    async grantAccess({ sessionId, subjects }) {
      const { data } = await client.sessions.updateGrants(sessionId, { grant: subjects });
      return toAccessGrants({ client, grants: data });
    },
    async revokeAccess({ sessionId, subjectType, subjectId }) {
      await client.sessions.updateGrants(sessionId, { revoke: [{ subjectType, subjectId }] });
    },
    async searchUsers(req): Promise<ListResult<DirectoryUser>> {
      const page = await client.users.list({
        ...(req.query === undefined || req.query.length === 0 ? {} : { query: req.query }),
        ...(req.limit === undefined ? {} : { limit: req.limit }),
        ...(req.pageToken === undefined || req.pageToken.length === 0 ? {} : { pageToken: req.pageToken }),
      });
      return toListResult(page, toDirectoryUser);
    },
  };
}
