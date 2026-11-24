'use client';

import { EmptyScreen, EmptyScreenQueryHighlight } from '../EmptyScreen.js';
import type { ArtifactScope } from './ArtifactScopeFilter.js';

export function ArtifactsEmptyState({ title, scope }: { title: string; scope: ArtifactScope }) {
  if (title !== '') {
    return (
      <EmptyScreen
        title="No artifacts found"
        description={
          <>
            No artifacts match <EmptyScreenQueryHighlight>{title}</EmptyScreenQueryHighlight>.
          </>
        }
        className="min-h-full"
      />
    );
  }
  if (scope === 'all') {
    return (
      <EmptyScreen
        title="No artifacts yet"
        description="Files your agents publish will show up here."
        className="min-h-full"
      />
    );
  }
  return <EmptyScreen title="No artifacts in this view" description="Try another filter." className="min-h-full" />;
}
