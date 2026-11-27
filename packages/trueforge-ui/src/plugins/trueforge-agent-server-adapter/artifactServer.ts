/**
 * Harness ArtifactServer adapter. List, session list and rename exist on the API; the other methods reject
 * until their routes land.
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { Artifact, ArtifactServer, ListArtifactsParams } from '../../server/types.js';
import { toListResult } from './chatServer.js';

function unavailable(action: string): Promise<never> {
  return Promise.reject(new Error(`${action} is not available yet`));
}

function toUiArtifact(artifact: TrueForgeApi.Artifact): Artifact {
  return {
    id: artifact.id,
    name: artifact.name,
    createdBySubject: artifact.createdBySubject,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  };
}

export function createArtifactServer(client: TrueForge): ArtifactServer {
  return {
    async listArtifacts(request: ListArtifactsParams = {}) {
      const page = await client.artifacts.list({
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.pageToken === undefined ? {} : { pageToken: request.pageToken }),
        ...(request.name === undefined || request.name.length === 0 ? {} : { name: request.name }),
      });
      return toListResult(page, toUiArtifact);
    },
    async listSessionArtifacts({ sessionId }) {
      const response = await client.sessions.listArtifacts(sessionId);
      return response.data.map(toUiArtifact);
    },
    getArtifact: () => unavailable('Get artifact'),
    async updateArtifact({ id, name }) {
      const response = await client.artifacts.update(id, { name });
      return toUiArtifact(response.data);
    },
    deleteArtifact: () => unavailable('Delete artifact'),
    readArtifactFile: () => unavailable('Read artifact file'),
  };
}
