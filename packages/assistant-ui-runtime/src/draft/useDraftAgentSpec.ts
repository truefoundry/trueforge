'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AgentSpec } from '../server/types.js';
import { mergeAgentSpec, type AgentSpecUpdate } from './agentSpec.js';
import type { DraftSessionBridge } from './draftSessionBridge.js';

const SPEC_SYNC_DEBOUNCE_MS = 400;

export interface UseDraftAgentSpecOptions {
  draftSessionId: string | undefined;
  draftBridge: DraftSessionBridge | null;
  defaultAgentSpec: AgentSpec;
  onAgentSpecChange?: ((spec: AgentSpec) => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
}

export interface UseDraftAgentSpecResult {
  agentSpec: AgentSpec | null;
  draftSessionId: string | undefined;
  isSpecLoading: boolean;
  isSpecSyncing: boolean;
  specError: unknown;
  updateAgentSpec: (update: AgentSpecUpdate) => void;
  flushAgentSpec: () => Promise<void>;
  adoptAgentSpec: (request: { agentSpec: AgentSpec; updatedAt?: string }) => void;
  takeTurnHeaderTimestamp: () => Promise<string | undefined>;
}

export function useDraftAgentSpec({
  draftSessionId,
  draftBridge,
  defaultAgentSpec,
  onAgentSpecChange,
  onError,
}: UseDraftAgentSpecOptions): UseDraftAgentSpecResult {
  const enabled = draftBridge != null;
  const [agentSpec, setAgentSpec] = useState<AgentSpec>(defaultAgentSpec);
  const [isSpecLoading, setIsSpecLoading] = useState(false);
  const [isSpecSyncing, setIsSpecSyncing] = useState(false);
  const [specError, setSpecError] = useState<unknown>(null);

  const agentSpecRef = useRef(agentSpec);
  agentSpecRef.current = agentSpec;

  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncGenerationRef = useRef(0);
  const loadedDraftIdRef = useRef<string | undefined>(undefined);
  const localDirtyRef = useRef(false);
  const lastUpdatedAtRef = useRef<string | undefined>(undefined);
  const pendingFlushRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const inFlightFlushRef = useRef<Promise<void> | undefined>(undefined);
  const activeDraftIdRef = useRef(draftSessionId);

  // Invalidate sync state from the previous draft so a stale pending flush or
  // stored updatedAt can't update the wrong draft or leak into the next
  // turn's header. Bumping the generation makes any in-flight sync a no-op.
  useEffect(() => {
    const previousDraftId = activeDraftIdRef.current;
    if (previousDraftId === draftSessionId) {
      return;
    }
    activeDraftIdRef.current = draftSessionId;
    syncGenerationRef.current++;
    if (syncTimeoutRef.current != null) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = undefined;
    }
    pendingFlushRef.current = undefined;
    inFlightFlushRef.current = undefined;
    lastUpdatedAtRef.current = undefined;
    setIsSpecSyncing(false);
    // Dirty edits made against a previous draft must not be replayed onto
    // the new one. Keep them only for lazy creation (undefined -> id).
    if (previousDraftId != null) {
      localDirtyRef.current = false;
    }
  }, [draftSessionId]);

  useEffect(() => {
    if (draftBridge == null) {
      return;
    }
    if (draftSessionId == null) {
      loadedDraftIdRef.current = undefined;
      setAgentSpec(defaultAgentSpec);
      localDirtyRef.current = false;
      setSpecError(null);
      setIsSpecLoading(false);
      return;
    }

    if (loadedDraftIdRef.current === draftSessionId) {
      return;
    }

    const abortController = new AbortController();
    setIsSpecLoading(true);
    void (async () => {
      try {
        const loaded = await draftBridge.getDraftAgentSpec(draftSessionId);
        if (abortController.signal.aborted) {
          return;
        }
        loadedDraftIdRef.current = draftSessionId;

        if (localDirtyRef.current) {
          scheduleSpecSyncRef.current(draftSessionId, agentSpecRef.current);
          localDirtyRef.current = false;
          setSpecError(null);
          setIsSpecLoading(false);
          return;
        }

        setAgentSpec(loaded);
        setSpecError(null);
        setIsSpecLoading(false);
      } catch (error) {
        if (!abortController.signal.aborted) {
          onError?.(error);
          setSpecError(error);
          setIsSpecLoading(false);
        }
      }
    })();

    return () => {
      abortController.abort();
      // The cancelled load can no longer clear the flag itself. Releasing it
      // here keeps it from sticking when the next run early-returns on an
      // already-loaded draft; a run that starts a fresh load re-raises it in
      // the same commit.
      setIsSpecLoading(false);
    };
  }, [defaultAgentSpec, draftBridge, draftSessionId, enabled, onError]);

  const flushSpecSync = useCallback(
    async (draftId: string, spec: AgentSpec, generation: number) => {
      if (draftBridge == null) {
        return;
      }
      setIsSpecSyncing(true);
      try {
        const updatedAt = await draftBridge.syncAgentSpec(draftId, spec);
        if (generation !== syncGenerationRef.current) {
          return;
        }
        lastUpdatedAtRef.current = updatedAt || new Date().toISOString();
        setSpecError(null);
        onAgentSpecChange?.(spec);
      } catch (error) {
        if (generation === syncGenerationRef.current) {
          setSpecError(error);
          onError?.(error);
        }
      } finally {
        if (generation === syncGenerationRef.current) {
          setIsSpecSyncing(false);
        }
      }
    },
    [draftBridge, onAgentSpecChange, onError],
  );

  const scheduleSpecSync = useCallback(
    (draftId: string, spec: AgentSpec) => {
      if (syncTimeoutRef.current != null) {
        clearTimeout(syncTimeoutRef.current);
      }
      const generation = ++syncGenerationRef.current;
      const flush = () => {
        pendingFlushRef.current = undefined;
        syncTimeoutRef.current = undefined;
        const promise = flushSpecSync(draftId, spec, generation).finally(() => {
          if (inFlightFlushRef.current === promise) {
            inFlightFlushRef.current = undefined;
          }
        });
        inFlightFlushRef.current = promise;
        return promise;
      };
      pendingFlushRef.current = flush;
      syncTimeoutRef.current = setTimeout(() => {
        void flush();
      }, SPEC_SYNC_DEBOUNCE_MS);
    },
    [flushSpecSync],
  );

  const scheduleSpecSyncRef = useRef(scheduleSpecSync);
  scheduleSpecSyncRef.current = scheduleSpecSync;

  const flushPendingSpecSyncNow = useCallback(async () => {
    if (syncTimeoutRef.current != null) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = undefined;
    }
    const pending = pendingFlushRef.current;
    if (pending != null) {
      pendingFlushRef.current = undefined;
      await pending();
      return;
    }
    if (inFlightFlushRef.current != null) {
      await inFlightFlushRef.current;
    }
  }, []);

  const adoptAgentSpec = useCallback(
    ({ agentSpec: persistedSpec, updatedAt }: { agentSpec: AgentSpec; updatedAt?: string }) => {
      if (syncTimeoutRef.current != null) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = undefined;
      }
      syncGenerationRef.current++;
      pendingFlushRef.current = undefined;
      inFlightFlushRef.current = undefined;
      localDirtyRef.current = false;
      // Keep the last successful sync timestamp when the caller omits
      // updatedAt (e.g. a save that did not return sessionUpdatedAt).
      if (updatedAt !== undefined) {
        lastUpdatedAtRef.current = updatedAt;
      }
      agentSpecRef.current = persistedSpec;
      setAgentSpec(persistedSpec);
      setSpecError(null);
      setIsSpecSyncing(false);
    },
    [],
  );

  const takeTurnHeaderTimestamp = useCallback(async () => {
    await flushPendingSpecSyncNow();
    const updatedAt = lastUpdatedAtRef.current;
    lastUpdatedAtRef.current = undefined;
    return updatedAt;
  }, [flushPendingSpecSyncNow]);

  useEffect(
    () => () => {
      if (syncTimeoutRef.current != null) {
        clearTimeout(syncTimeoutRef.current);
      }
    },
    [],
  );

  const updateAgentSpec = useCallback(
    (update: AgentSpecUpdate) => {
      if (draftBridge == null) {
        return;
      }
      const next = mergeAgentSpec(agentSpecRef.current, update);
      setAgentSpec(next);
      localDirtyRef.current = true;
      if (draftSessionId != null) {
        scheduleSpecSync(draftSessionId, next);
      }
    },
    [draftBridge, draftSessionId, enabled, scheduleSpecSync],
  );

  return useMemo(
    () => ({
      agentSpec: enabled ? agentSpec : null,
      draftSessionId: enabled ? draftSessionId : undefined,
      isSpecLoading: enabled ? isSpecLoading : false,
      isSpecSyncing: enabled ? isSpecSyncing : false,
      specError: enabled ? specError : null,
      updateAgentSpec,
      flushAgentSpec: flushPendingSpecSyncNow,
      adoptAgentSpec,
      takeTurnHeaderTimestamp,
    }),
    [
      agentSpec,
      draftSessionId,
      enabled,
      isSpecLoading,
      isSpecSyncing,
      specError,
      flushPendingSpecSyncNow,
      adoptAgentSpec,
      takeTurnHeaderTimestamp,
      updateAgentSpec,
    ],
  );
}
