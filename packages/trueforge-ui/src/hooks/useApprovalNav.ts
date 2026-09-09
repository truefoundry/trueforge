'use client';

import { useTrueFoundryApprovals } from '@truefoundry/assistant-ui-runtime';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useOptionalApprovalFocus } from '../containers/approvalFocus.js';

export type ApprovalNavState = {
  count: number;
  /** 0-based index into pending approvals. */
  index: number;
  canPrev: boolean;
  canNext: boolean;
  goPrev: () => void;
  goNext: () => void;
  /** Scroll to the currently selected approval (e.g. after the user scrolled away). */
  focusCurrent: () => void;
};

/**
 * Tracks the focused pending tool approval for the composer banner.
 * Auto-focuses #1 when approvals appear; after allow/deny, stays on the same
 * index so the next pending item fills the slot; chevrons do not wrap.
 */
export function useApprovalNav(): ApprovalNavState {
  const { pending } = useTrueFoundryApprovals();
  const focusApi = useOptionalApprovalFocus();
  const [selection, setSelection] = useState<{ approvalId: string | null; index: number }>({
    approvalId: null,
    index: 0,
  });
  const focusedIdRef = useRef<string | null>(null);

  const count = pending.length;
  const matchedIndex =
    selection.approvalId == null ? -1 : pending.findIndex(item => item.approvalId === selection.approvalId);
  const safeIndex = matchedIndex >= 0 ? matchedIndex : count === 0 ? 0 : Math.min(selection.index, count - 1);
  const currentId = pending[safeIndex]?.approvalId;

  useEffect(() => {
    const approvalId = currentId ?? null;
    if (selection.approvalId === approvalId && selection.index === safeIndex) return;
    setSelection({ approvalId, index: safeIndex });
  }, [currentId, safeIndex, selection.approvalId, selection.index]);

  useEffect(() => {
    if (currentId == null || focusApi == null) {
      if (currentId == null) focusedIdRef.current = null;
      return;
    }
    if (focusedIdRef.current === currentId) return;
    focusedIdRef.current = currentId;
    focusApi.focus(currentId);
  }, [currentId, focusApi]);

  const goPrev = useCallback(() => {
    const index = Math.max(0, safeIndex - 1);
    setSelection({ approvalId: pending[index]?.approvalId ?? null, index });
  }, [pending, safeIndex]);

  const goNext = useCallback(() => {
    const index = Math.min(Math.max(count - 1, 0), safeIndex + 1);
    setSelection({ approvalId: pending[index]?.approvalId ?? null, index });
  }, [count, pending, safeIndex]);

  const focusCurrent = useCallback(() => {
    if (currentId == null || focusApi == null) return;
    focusApi.focus(currentId);
  }, [currentId, focusApi]);

  return {
    count,
    index: safeIndex,
    canPrev: safeIndex > 0,
    canNext: safeIndex < count - 1,
    goPrev,
    goNext,
    focusCurrent,
  };
}
