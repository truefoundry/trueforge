'use client';

import type { AssistantClient } from '@assistant-ui/store';
import { useAui } from '@assistant-ui/store';
import { useCallback, useSyncExternalStore } from 'react';
import type { McpAuthRequiredEvent } from './server/index.js';

import type { PendingApproval, PendingToolResponse } from './collectPending.js';
import type { AgentSpecUpdate } from './draft/agentSpec.js';
import type { AgentSpec } from './server/types.js';
import type { RespondToToolApprovalOptions } from './toolApproval.js';
import type { RespondToToolResponseOptions } from './toolResponse.js';

export type { PendingApproval, PendingToolResponse };

export interface TrueForgeDraftRuntimeExtras {
  agentSpec: AgentSpec | null;
  draftSessionId: string | undefined;
  isSpecLoading: boolean;
  isSpecSyncing: boolean;
  specError: unknown;
  updateAgentSpec: (update: AgentSpecUpdate) => void;
  flushAgentSpec: () => Promise<void>;
  adoptAgentSpec: (request: { agentSpec: AgentSpec; updatedAt?: string }) => void;
}

export interface TrueForgeRuntimeExtras {
  pendingApprovals: PendingApproval[];
  pendingToolResponses: PendingToolResponse[];
  pendingMcpAuth: { mcpServers: McpAuthRequiredEvent['mcpServers'] } | null;
  sandboxId: string | undefined;
  respondToToolApproval: (response: RespondToToolApprovalOptions) => Promise<void>;
  respondToToolResponse: (response: RespondToToolResponseOptions) => Promise<void>;
  continueMcpAuth: () => Promise<void>;
  downloadSandboxFile: (req: { turnId: string; path: string }) => Promise<Blob>;
  cancel: () => Promise<void>;
  resetFromTurn: (turnId: string) => Promise<void>;
  reload: () => void;
  hasOlderHistory: boolean;
  isLoadingOlderHistory: boolean;
  loadOlderHistory: () => Promise<void>;
  draft: TrueForgeDraftRuntimeExtras | null;
}

const extrasBrandSymbol = Symbol('useTrueForgeAgentRuntime extras');

const isTrueForgeExtras = (extras: unknown): extras is TrueForgeRuntimeExtras =>
  typeof extras === 'object' && extras !== null && extrasBrandSymbol in extras;

const extrasBrand = {
  provide: (value: TrueForgeRuntimeExtras): TrueForgeRuntimeExtras => {
    Object.defineProperty(value, extrasBrandSymbol, {
      value: true,
      enumerable: false,
      configurable: true,
    });
    return value;
  },
  is: isTrueForgeExtras,
  tryGet: (extras: unknown): TrueForgeRuntimeExtras | undefined => (isTrueForgeExtras(extras) ? extras : undefined),
};

export const EMPTY_DRAFT_EXTRAS: TrueForgeDraftRuntimeExtras = {
  agentSpec: null,
  draftSessionId: undefined,
  isSpecLoading: false,
  isSpecSyncing: false,
  specError: null,
  updateAgentSpec: () => {
    throw new Error('Draft agent extras are only available in draft mode.');
  },
  flushAgentSpec: () => Promise.reject(new Error('Draft agent extras are only available in draft mode.')),
  adoptAgentSpec: () => {
    throw new Error('Draft agent extras are only available in draft mode.');
  },
};

type SubscribeFn = (onStoreChange: () => void) => () => void;

function isThreadAccessor(value: unknown): value is (this: object) => unknown {
  return typeof value === 'function';
}

function isGetState(value: unknown): value is (this: object) => unknown {
  return typeof value === 'function';
}

function isSubscribe(value: unknown): value is (this: object, onStoreChange: () => void) => unknown {
  return typeof value === 'function';
}

/**
 * Walk `Object.create(parent)` AUI clients. Stops before leaving the chain.
 * Callers must try/catch RootAssistantClient proxy gets (it throws on any
 * missing accessor such as `subscribe` / `thread`).
 */
function walkAssistantClientAncestors(client: AssistantClient, visit: (current: object) => 'continue' | 'stop'): void {
  let current: object | null = client;
  const seen = new Set<object>();
  while (!seen.has(current)) {
    seen.add(current);
    if (visit(current) === 'stop') {
      return;
    }
    const parent = Reflect.getPrototypeOf(current);
    if (parent == null || parent === Object.prototype) {
      return;
    }
    current = parent;
  }
}

/**
 * `PartPrimitive.Messages` wraps sub-agent threads in `ReadonlyThreadProvider`,
 * which shadows `thread` (and therefore `thread.extras`) with a readonly client
 * that has no TrueForge extras. Nested AUI clients are `Object.create(parent)`,
 * so walk the prototype chain to reach the root runtime extras.
 */
export function tryGetTrueForgeExtras(client: AssistantClient): TrueForgeRuntimeExtras | undefined {
  let found: TrueForgeRuntimeExtras | undefined;
  walkAssistantClientAncestors(client, current => {
    try {
      const thread: unknown = Reflect.get(current, 'thread');
      if (isThreadAccessor(thread)) {
        const threadClient: unknown = Reflect.apply(thread, current, []);
        if (threadClient == null || typeof threadClient !== 'object') {
          return 'continue';
        }
        const getState: unknown = Reflect.get(threadClient, 'getState');
        if (!isGetState(getState)) {
          return 'continue';
        }
        const state: unknown = Reflect.apply(getState, threadClient, []);
        const extras = extrasBrand.tryGet(
          state != null && typeof state === 'object' ? Reflect.get(state, 'extras') : undefined,
        );
        if (extras != null) {
          found = extras;
          return 'stop';
        }
      }
    } catch {
      // Nested/readonly clients may lack thread; RootAssistantClient proxy
      // throws on missing scope accessors ("thread" / "subscribe").
    }
    return 'continue';
  });
  return found;
}

export function getTrueForgeExtras(client: AssistantClient): TrueForgeRuntimeExtras {
  const extras = tryGetTrueForgeExtras(client);
  if (extras == null) {
    throw new Error('The current thread is not backed by the useTrueForgeAgentRuntime runtime.');
  }
  return extras;
}

function subscribeClientChain(client: AssistantClient): SubscribeFn {
  return onStoreChange => {
    const unsubs: (() => void)[] = [];
    walkAssistantClientAncestors(client, current => {
      try {
        const subscribe: unknown = Reflect.get(current, 'subscribe');
        if (isSubscribe(subscribe)) {
          const unsubscribe: unknown = Reflect.apply(subscribe, current, [onStoreChange]);
          if (typeof unsubscribe === 'function') {
            unsubs.push(() => {
              Reflect.apply(unsubscribe, undefined, []);
            });
          }
        }
        return 'continue';
      } catch {
        // RootAssistantClient proxy — no further usable ancestors.
        return 'stop';
      }
    });
    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  };
}

/**
 * Resolves TrueForge extras from the nearest ancestor runtime, including
 * inside nested readonly sub-agent renderers (`PartPrimitive.Messages`).
 */
export function useTrueForgeRuntimeExtras(): TrueForgeRuntimeExtras | undefined {
  const aui = useAui();
  const subscribe = useCallback(subscribeClientChain(aui), [aui]);
  const getSnapshot = useCallback(() => tryGetTrueForgeExtras(aui), [aui]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useTrueForgeExtrasApi(): TrueForgeRuntimeExtras;
function useTrueForgeExtrasApi<S>(select: (extras: TrueForgeRuntimeExtras) => S, fallback?: S): S;
function useTrueForgeExtrasApi<S>(select?: (extras: TrueForgeRuntimeExtras) => S, fallback?: S): unknown {
  const extras = useTrueForgeRuntimeExtras();
  const hasFallback = arguments.length >= 2;
  if (extras == null) {
    if (hasFallback) {
      return fallback;
    }
    throw new Error('The current thread is not backed by the useTrueForgeAgentRuntime runtime.');
  }
  return select != null ? select(extras) : extras;
}

/**
 * Brand + provide/tryGet from assistant-ui; get/use walk ancestor AUI clients so
 * nested readonly sub-agent threads still resolve root TrueForge extras.
 */
export const trueForgeExtras = {
  provide: extrasBrand.provide,
  is: extrasBrand.is,
  tryGet: extrasBrand.tryGet,
  get: getTrueForgeExtras,
  use: useTrueForgeExtrasApi,
};
