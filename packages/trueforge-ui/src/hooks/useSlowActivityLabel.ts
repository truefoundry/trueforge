'use client';

import { useEffect, useState } from 'react';

export const SLOW_ACTIVITY_AFTER_MS = 60_000;

const SLOW_ACTIVITY_NOTE = 'Taking longer than expected';

export function useSlowActivityLabel({
  label,
  activityKey,
  progressKey,
}: {
  label: string;
  activityKey: string | null;
  progressKey?: string | null;
}): string {
  // Phase plus the latest stream fingerprint. A new delta must restart the minute and clear a warning already on screen.
  const clockKey = activityKey == null ? null : `${activityKey}:${progressKey ?? ''}`;
  const [slowKey, setSlowKey] = useState<string | null>(null);
  const [trackedKey, setTrackedKey] = useState(clockKey);
  if (trackedKey !== clockKey) {
    setTrackedKey(clockKey);
    setSlowKey(null);
  }

  useEffect(() => {
    if (clockKey == null) return;
    const id = window.setTimeout(() => setSlowKey(clockKey), SLOW_ACTIVITY_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [clockKey]);

  if (clockKey == null || slowKey !== clockKey) return label;
  return SLOW_ACTIVITY_NOTE;
}
