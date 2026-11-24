import type { Artifact, ArtifactServer, ListArtifactsParams } from '@truefoundry/trueforge-ui';

import { buildDummyArtifacts, DUMMY_CURRENT_SUBJECT_ID } from './dummyArtifacts';

const DEFAULT_LIMIT = 10;

function matchesScope(artifact: Artifact, scope: ListArtifactsParams['scope']): boolean {
  if (scope === undefined || scope === 'all') {
    return true;
  }
  const mine = artifact.createdBySubject.subjectId === DUMMY_CURRENT_SUBJECT_ID;
  return scope === 'created_by_me' ? mine : !mine;
}

function sampleContent({ title, entryPoint }: Pick<Artifact, 'title' | 'entryPoint'>): Blob {
  if (entryPoint?.endsWith('.md')) {
    return new Blob([`# ${title}\n\nSample report content.\n\n- Item one\n- Item two\n`], { type: 'text/markdown' });
  }
  return new Blob([`<!doctype html><html><body><h1>${title}</h1><p>Sample artifact.</p></body></html>`], {
    type: 'text/html',
  });
}

// TODO: remove once the artifacts API ships and the host passes a real ArtifactServer.
export function createDummyArtifactServer(): ArtifactServer {
  const artifacts = buildDummyArtifacts().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    listArtifacts: ({
      limit = DEFAULT_LIMIT,
      pageToken,
      title,
      createdBySessionId,
      scope,
    }: ListArtifactsParams = {}) => {
      const needle = title?.trim().toLowerCase() ?? '';
      const matches = artifacts.filter(
        artifact =>
          (needle === '' || artifact.title.toLowerCase().includes(needle)) &&
          (createdBySessionId === undefined || artifact.createdBySessionId === createdBySessionId) &&
          matchesScope(artifact, scope),
      );
      const offset = pageToken === undefined ? 0 : Number(pageToken);
      const data = matches.slice(offset, offset + limit);
      const previousOffset = Math.max(offset - limit, 0);
      return Promise.resolve({
        data,
        ...(offset + limit < matches.length ? { nextPageToken: String(offset + limit) } : {}),
        ...(offset > 0 ? { previousPageToken: String(previousOffset) } : {}),
      });
    },
    getArtifact: ({ id }) => {
      const artifact = artifacts.find(candidate => candidate.id === id);
      return artifact === undefined
        ? Promise.reject(new Error(`Artifact "${id}" not found`))
        : Promise.resolve(artifact);
    },
    updateArtifact: ({ id, title }) => {
      const index = artifacts.findIndex(candidate => candidate.id === id);
      const current = index < 0 ? undefined : artifacts[index];
      if (current === undefined) {
        return Promise.reject(new Error(`Artifact "${id}" not found`));
      }
      const next = { ...current, title: title.trim(), updatedAt: new Date().toISOString() };
      artifacts[index] = next;
      artifacts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return Promise.resolve(next);
    },
    deleteArtifact: ({ id }) => {
      const index = artifacts.findIndex(candidate => candidate.id === id);
      if (index < 0) {
        return Promise.reject(new Error(`Artifact "${id}" not found`));
      }
      artifacts.splice(index, 1);
      return Promise.resolve();
    },
    readArtifactFile: ({ slug }) => {
      const artifact = artifacts.find(candidate => candidate.slug === slug);
      return artifact === undefined
        ? Promise.reject(new Error(`Artifact "${slug}" not found`))
        : Promise.resolve(sampleContent(artifact));
    },
  };
}
