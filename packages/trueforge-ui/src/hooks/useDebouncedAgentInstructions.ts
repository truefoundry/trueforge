'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_INSTRUCTIONS_DEBOUNCE_MS = 400;

export function useDebouncedAgentInstructions({
  value,
  onCommit,
  delayMs = DEFAULT_INSTRUCTIONS_DEBOUNCE_MS,
}: {
  value: string;
  onCommit: (value: string) => void;
  delayMs?: number;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    onCommitRef.current(draftRef.current);
  }, [clearTimer]);

  const onChange = useCallback(
    (nextValue: string) => {
      draftRef.current = nextValue;
      dirtyRef.current = true;
      setDraft(nextValue);
      clearTimer();
      timerRef.current = setTimeout(flush, delayMs);
    },
    [clearTimer, delayMs, flush],
  );

  useEffect(() => {
    if (dirtyRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      clearTimer();
      if (dirtyRef.current) {
        dirtyRef.current = false;
        onCommitRef.current(draftRef.current);
      }
    },
    [clearTimer],
  );

  return { draft, onChange, flush };
}
