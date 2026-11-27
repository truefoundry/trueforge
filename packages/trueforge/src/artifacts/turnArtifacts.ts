import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import type { ArtifactsBackend } from '@truefoundry/trueforge-core/core';
import { z } from 'zod';
import type { ArtifactsConfig } from '../config';
import type { IArtifactStore } from '../db/artifactStore';
import type { ResolveObjectStore } from '../resolvers';
import { ArtifactNameSchema } from '../schemas/artifact';

/**
 * `push_artifact` backend for one turn, or undefined when artifacts are off for the tenant. Records
 * are bound to the session's tenant, creator and agent, never to model input.
 */
export function resolveTurnArtifactsBackend(input: {
  tenant_id: string;
  session_id: string;
  /** The session's registry agent; null for inline-spec sessions. */
  agent_id: string | null;
  subject: Subject;
  artifactStore: Pick<IArtifactStore, 'getArtifact' | 'createArtifact' | 'createVersion'>;
  resolveObjectStore: ResolveObjectStore;
  artifactsConfig: ArtifactsConfig | undefined;
}): ArtifactsBackend | undefined {
  const { tenant_id, session_id, agent_id, subject, artifactStore, artifactsConfig } = input;
  const objectStore = input.resolveObjectStore(tenant_id);
  if (objectStore === undefined || artifactsConfig === undefined) {
    return undefined;
  }
  const createdBy = { created_by_subject: subject, created_by_session_id: session_id, created_by_agent_id: agent_id };
  return {
    tenantId: tenant_id,
    objectStore,
    limits: { max_files: artifactsConfig.max_files, max_total_bytes: artifactsConfig.max_total_bytes },
    store: {
      checkPushAccess: async ({ artifact_id }) => {
        const artifact = await artifactStore.getArtifact({ tenant_id, id: artifact_id });
        if (artifact === undefined) {
          return `Artifact not found: ${artifact_id}`;
        }
        if (artifact.created_by_subject.subject_id !== subject.subject_id) {
          return 'User does not have access to push to this artifact.';
        }
        return undefined;
      },
      createArtifact: async ({ name }) => {
        const parsed = ArtifactNameSchema.safeParse(name);
        if (!parsed.success) {
          throw new Error(`Invalid artifact name: ${z.prettifyError(parsed.error)}`);
        }
        return await artifactStore.createArtifact({ tenant_id, name: parsed.data, ...createdBy });
      },
      createVersion: ({ artifact_id, files_metadata }) =>
        artifactStore.createVersion({ tenant_id, artifact_id, files_metadata, ...createdBy }),
    },
  };
}
