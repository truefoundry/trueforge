/**
 * Harness ArtifactServer adapter. Only `list` exists on the API; the other methods reject
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
    latestVersion: artifact.latestVersion,
    entryPoint: artifact.entryPoint,
    createdBySubject: artifact.createdBySubject,
    createdBySessionId: artifact.createdBySessionId,
    createdByAgentId: artifact.createdByAgentId,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  };
}

export function createArtifactServer(client: TrueForge): ArtifactServer {
  return {
    async listArtifacts(request: ListArtifactsParams = {}) {
      // `scope` stays on the page until the backend confirms it. The list route has no such param.
      const page = await client.artifacts.list({
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.pageToken === undefined ? {} : { pageToken: request.pageToken }),
        ...(request.createdBySessionId === undefined ? {} : { createdBySessionId: request.createdBySessionId }),
        ...(request.name === undefined || request.name.length === 0 ? {} : { name: request.name }),
      });
      return toListResult(page, toUiArtifact);
    },
    getArtifact: () => unavailable('Get artifact'),
    updateArtifact: () => unavailable('Rename artifact'),
    deleteArtifact: () => unavailable('Delete artifact'),
    readArtifactFile: () => unavailable('Read artifact file'),
  };
}
