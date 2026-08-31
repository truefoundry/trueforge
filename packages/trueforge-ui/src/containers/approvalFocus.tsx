'use client';

import { useAuiState } from '@assistant-ui/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { findSubAgentAncestorsForApproval } from '../utils/findApprovalAncestors.js';

const FLASH_MS = 2000;
const MOUNT_RETRY_MS = 50;
const MOUNT_RETRY_MAX = 12;

type ApprovalFocusApi = {
  registerTarget: (approvalId: string, getElement: () => HTMLElement | null) => () => void;
  registerExpand: (toolCallId: string, expand: () => void) => () => void;
  focus: (approvalId: string) => void;
  flashingApprovalId: string | null;
};

const ApprovalFocusContext = createContext<ApprovalFocusApi | null>(null);

export function ApprovalFocusProvider({ children }: { children: ReactNode }) {
  const targetsRef = useRef(new Map<string, () => HTMLElement | null>());
  const expandsRef = useRef(new Map<string, () => void>());
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [flashingApprovalId, setFlashingApprovalId] = useState<string | null>(null);
  const messages = useAuiState(s => s.thread.messages);

  const registerTarget = useCallback((approvalId: string, getElement: () => HTMLElement | null) => {
    targetsRef.current.set(approvalId, getElement);
    return () => {
      if (targetsRef.current.get(approvalId) === getElement) {
        targetsRef.current.delete(approvalId);
      }
    };
  }, []);

  const registerExpand = useCallback((toolCallId: string, expand: () => void) => {
    expandsRef.current.set(toolCallId, expand);
    return () => {
      if (expandsRef.current.get(toolCallId) === expand) {
        expandsRef.current.delete(toolCallId);
      }
    };
  }, []);

  const startFlash = useCallback((approvalId: string) => {
    if (flashTimerRef.current != null) clearTimeout(flashTimerRef.current);
    setFlashingApprovalId(approvalId);
    flashTimerRef.current = setTimeout(() => {
      setFlashingApprovalId(null);
      flashTimerRef.current = null;
    }, FLASH_MS);
  }, []);

  useEffect(
    () => () => {
      if (flashTimerRef.current != null) clearTimeout(flashTimerRef.current);
      if (retryTimerRef.current != null) clearInterval(retryTimerRef.current);
    },
    [],
  );

  const focus = useCallback(
    (approvalId: string) => {
      const ancestors = findSubAgentAncestorsForApproval(messages, approvalId);

      if (retryTimerRef.current != null) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      const tryFocus = (): boolean => {
        for (const toolCallId of ancestors) {
          expandsRef.current.get(toolCallId)?.();
        }

        const el = targetsRef.current.get(approvalId)?.() ?? null;
        if (el == null) return false;
        el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        startFlash(approvalId);
        return true;
      };

      if (tryFocus()) return;

      let attempts = 0;
      retryTimerRef.current = setInterval(() => {
        attempts += 1;
        if (tryFocus() || attempts >= MOUNT_RETRY_MAX) {
          if (retryTimerRef.current != null) {
            clearInterval(retryTimerRef.current);
            retryTimerRef.current = null;
          }
        }
      }, MOUNT_RETRY_MS);
    },
    [messages, startFlash],
  );

  const api = useMemo<ApprovalFocusApi>(
    () => ({
      registerTarget,
      registerExpand,
      focus,
      flashingApprovalId,
    }),
    [registerTarget, registerExpand, focus, flashingApprovalId],
  );

  return <ApprovalFocusContext.Provider value={api}>{children}</ApprovalFocusContext.Provider>;
}

export function useApprovalFocus(): ApprovalFocusApi {
  const api = useContext(ApprovalFocusContext);
  if (api == null) {
    throw new Error('useApprovalFocus requires ApprovalFocusProvider');
  }
  return api;
}

export function useOptionalApprovalFocus(): ApprovalFocusApi | null {
  return useContext(ApprovalFocusContext);
}

/** Registers a DOM target for scroll/flash. No-ops outside the provider (tests). */
export function useRegisterApprovalTarget(approvalId: string | undefined, getElement: () => HTMLElement | null): void {
  const api = useOptionalApprovalFocus();
  const getElementRef = useRef(getElement);
  getElementRef.current = getElement;

  useEffect(() => {
    if (api == null || approvalId == null || approvalId === '') return;
    return api.registerTarget(approvalId, () => getElementRef.current());
  }, [api, approvalId]);
}

/** Registers a sub-agent expand callback. No-ops outside the provider (tests). */
export function useRegisterApprovalExpand(toolCallId: string, expand: () => void): void {
  const api = useOptionalApprovalFocus();
  const expandRef = useRef(expand);
  expandRef.current = expand;

  useEffect(() => {
    if (api == null || toolCallId === '') return;
    return api.registerExpand(toolCallId, () => expandRef.current());
  }, [api, toolCallId]);
}
