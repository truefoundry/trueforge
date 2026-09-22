import type { AssistantClient } from '@assistant-ui/store';
import { describe, expect, it, vi } from 'vitest';

import {
  getTrueForgeExtras,
  trueForgeExtras,
  tryGetTrueForgeExtras,
  type TrueForgeRuntimeExtras,
} from '../src/trueforgeExtras.js';

function clientWithExtras(extras: unknown): AssistantClient {
  return {
    thread: () => ({
      getState: () => ({ extras }),
    }),
  } as unknown as AssistantClient;
}

describe('tryGetTrueForgeExtras', () => {
  it('reads extras from the current client', () => {
    const extras = trueForgeExtras.provide({
      pendingApprovals: [],
      pendingToolResponses: [],
      pendingMcpAuth: null,
      resumeUnavailable: false,
      sandboxId: undefined,
      respondToToolApproval: vi.fn(),
      respondToToolResponse: vi.fn(),
      resumeMcpAuth: vi.fn(),
      downloadSandboxFile: vi.fn(),
      cancel: vi.fn(),
      resetFromTurn: vi.fn(),
      reload: vi.fn(),
      hasOlderHistory: false,
      isLoadingOlderHistory: false,
      loadOlderHistory: vi.fn(),
      draft: null,
    } satisfies TrueForgeRuntimeExtras);

    expect(tryGetTrueForgeExtras(clientWithExtras(extras))).toBe(extras);
  });

  it('walks nested readonly clients (Object.create parent) to find root extras', () => {
    const respondToToolApproval = vi.fn();
    const extras = trueForgeExtras.provide({
      pendingApprovals: [{ approvalId: 'a1', threadId: 'child-1', toolName: 'bash', args: {}, argsText: '{}' }],
      pendingToolResponses: [],
      pendingMcpAuth: null,
      resumeUnavailable: false,
      sandboxId: undefined,
      respondToToolApproval,
      respondToToolResponse: vi.fn(),
      resumeMcpAuth: vi.fn(),
      downloadSandboxFile: vi.fn(),
      cancel: vi.fn(),
      resetFromTurn: vi.fn(),
      reload: vi.fn(),
      hasOlderHistory: false,
      isLoadingOlderHistory: false,
      loadOlderHistory: vi.fn(),
      draft: null,
    } satisfies TrueForgeRuntimeExtras);

    const root = clientWithExtras(extras);
    // Mirrors ReadonlyThreadProvider: nested AUI is Object.create(parent) with
    // thread overwritten to a readonly client that has no extras.
    const nested = Object.assign(Object.create(root), {
      thread: () => ({
        getState: () => ({ extras: undefined }),
      }),
    }) as AssistantClient;

    expect(tryGetTrueForgeExtras(nested)).toBe(extras);
    // Namespace .get must walk too (not only the named helper).
    expect(trueForgeExtras.get(nested)).toBe(extras);
    getTrueForgeExtras(nested).respondToToolApproval({
      approvalId: 'a1',
      approved: true,
    });
    expect(respondToToolApproval).toHaveBeenCalledWith({
      approvalId: 'a1',
      approved: true,
    });
  });

  it('returns undefined when no ancestor has TrueForge extras', () => {
    expect(tryGetTrueForgeExtras(clientWithExtras(undefined))).toBeUndefined();
  });

  it('survives RootAssistantClient-style proxies that throw on missing accessors', () => {
    const extras = trueForgeExtras.provide({
      pendingApprovals: [],
      pendingToolResponses: [],
      pendingMcpAuth: null,
      resumeUnavailable: false,
      sandboxId: undefined,
      respondToToolApproval: vi.fn(),
      respondToToolResponse: vi.fn(),
      resumeMcpAuth: vi.fn(),
      downloadSandboxFile: vi.fn(),
      cancel: vi.fn(),
      resetFromTurn: vi.fn(),
      reload: vi.fn(),
      hasOlderHistory: false,
      isLoadingOlderHistory: false,
      loadOlderHistory: vi.fn(),
      draft: null,
    } satisfies TrueForgeRuntimeExtras);

    // Mirrors @assistant-ui/store createRootAssistantClient: empty proxy that
    // throws on any get (e.g. "subscribe" / "thread").
    const rootProto = new Proxy(
      {},
      {
        get(_, prop) {
          throw new Error(`The current scope does not have a "${String(prop)}" property.`);
        },
      },
    );
    const root = Object.assign(Object.create(rootProto), {
      subscribe: (cb: () => void) => {
        cb();
        return () => {};
      },
      thread: () => ({
        getState: () => ({ extras }),
      }),
    }) as AssistantClient;

    expect(tryGetTrueForgeExtras(root)).toBe(extras);

    // useTrueForgeRuntimeExtras walks .subscribe up the same chain.
    const nested = Object.assign(Object.create(root), {
      thread: () => ({
        getState: () => ({ extras: undefined }),
      }),
    }) as AssistantClient;
    expect(tryGetTrueForgeExtras(nested)).toBe(extras);
    expect(() => {
      let current: object | null = nested;
      const seen = new Set<object>();
      while (current != null && !seen.has(current)) {
        seen.add(current);
        try {
          const subscribe = (current as { subscribe?: (cb: () => void) => () => void }).subscribe;
          if (typeof subscribe === 'function') {
            subscribe(() => {});
          }
        } catch {
          break;
        }
        current = Object.getPrototypeOf(current);
      }
    }).not.toThrow();
  });
});
