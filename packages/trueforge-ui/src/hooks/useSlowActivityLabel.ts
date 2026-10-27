'use client';

import { useEffect, useState } from 'react';

export const SLOW_ACTIVITY_AFTER_MS = 10_000;

const SLOW_ACTIVITY_NOTE = 'Taking longer than expected';

export function useSlowActivityLabel({ label, activityKey }: { label: string; activityKey: string | null }): string {
  const [slowKey, setSlowKey] = useState<string | null>(null);
  const [trackedKey, setTrackedKey] = useState(activityKey);
  if (trackedKey !== activityKey) {
    setTrackedKey(activityKey);
    setSlowKey(null);
  }

  useEffect(() => {
    if (activityKey == null) return;
    const id = window.setTimeout(() => setSlowKey(activityKey), SLOW_ACTIVITY_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [activityKey]);

  if (activityKey == null || slowKey !== activityKey) return label;
  return SLOW_ACTIVITY_NOTE;
}
