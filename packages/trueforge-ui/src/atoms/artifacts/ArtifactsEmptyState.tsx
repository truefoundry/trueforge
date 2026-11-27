'use client';

import { EmptyScreen, EmptyScreenQueryHighlight } from '../EmptyScreen.js';

export function ArtifactsEmptyState({ title }: { title: string }) {
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
  return (
    <EmptyScreen
      title="No artifacts yet"
      description="Files your agents publish will show up here."
      className="min-h-full"
    />
  );
}
