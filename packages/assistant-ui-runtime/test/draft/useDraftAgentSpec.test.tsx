// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DraftSessionBridge } from '../../src/draft/draftSessionBridge.js';
import { useDraftAgentSpec } from '../../src/draft/useDraftAgentSpec.js';

const defaultAgentSpec = { model: { name: 'anthropic/claude-sonnet-4-6' } };

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useDraftAgentSpec', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores updatedAt from sync and returns it once from takeTurnHeaderTimestamp', async () => {
    const syncAgentSpec = vi.fn().mockResolvedValue('2026-06-30T12:00:00.000Z');
    const draftBridge: DraftSessionBridge = {
      getDraftAgentSpec: vi.fn().mockResolvedValue(defaultAgentSpec),
      syncAgentSpec,
    };

    const { result } = renderHook(() =>
      useDraftAgentSpec({
        draftSessionId: 'draft-1',
        draftBridge,
        defaultAgentSpec,
      }),
    );

    await flushMicrotasks();
    expect(draftBridge.getDraftAgentSpec).toHaveBeenCalledWith('draft-1');

    act(() => {
      result.current.updateAgentSpec({ instructions: 'be brief' });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await flushMicrotasks();

    expect(syncAgentSpec).toHaveBeenCalledOnce();

    let first: string | undefined;
    await act(async () => {
      first = await result.current.takeTurnHeaderTimestamp();
    });
    expect(first).toBe('2026-06-30T12:00:00.000Z');

    let second: string | undefined;
    await act(async () => {
      second = await result.current.takeTurnHeaderTimestamp();
    });
    expect(second).toBeUndefined();
  });

  it('flushes a pending debounced sync before returning the timestamp', async () => {
    const syncAgentSpec = vi.fn().mockResolvedValue('2026-06-30T13:00:00.000Z');
    const draftBridge: DraftSessionBridge = {
      getDraftAgentSpec: vi.fn().mockResolvedValue(defaultAgentSpec),
      syncAgentSpec,
    };

    const { result } = renderHook(() =>
      useDraftAgentSpec({
        draftSessionId: 'draft-1',
        draftBridge,
        defaultAgentSpec,
      }),
    );

    await flushMicrotasks();
    expect(draftBridge.getDraftAgentSpec).toHaveBeenCalledWith('draft-1');

    act(() => {
      result.current.updateAgentSpec({ instructions: 'new' });
    });
    expect(syncAgentSpec).not.toHaveBeenCalled();

    let timestamp: string | undefined;
    await act(async () => {
      timestamp = await result.current.takeTurnHeaderTimestamp();
    });

    expect(syncAgentSpec).toHaveBeenCalledOnce();
    expect(timestamp).toBe('2026-06-30T13:00:00.000Z');
  });

  it('drops pending sync state and stored timestamp when draftSessionId changes', async () => {
    const syncAgentSpec = vi.fn().mockResolvedValue('2026-06-30T14:00:00.000Z');
    const draftBridge: DraftSessionBridge = {
      getDraftAgentSpec: vi.fn().mockResolvedValue(defaultAgentSpec),
      syncAgentSpec,
    };

    const { result, rerender } = renderHook(
      ({ draftSessionId }: { draftSessionId: string }) =>
        useDraftAgentSpec({
          draftSessionId,
          draftBridge,
          defaultAgentSpec,
        }),
      { initialProps: { draftSessionId: 'draft-1' } },
    );

    await flushMicrotasks();

    // A completed sync stores a timestamp for draft-1...
    act(() => {
      result.current.updateAgentSpec({ instructions: 'for draft-1' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await flushMicrotasks();
    expect(syncAgentSpec).toHaveBeenCalledWith('draft-1', expect.anything());

    // ...and another edit leaves a pending debounced flush for draft-1.
    act(() => {
      result.current.updateAgentSpec({ instructions: 'pending for draft-1' });
    });

    rerender({ draftSessionId: 'draft-2' });
    await flushMicrotasks();

    let timestamp: string | undefined;
    await act(async () => {
      timestamp = await result.current.takeTurnHeaderTimestamp();
    });

    // Neither draft-1's stored timestamp nor its pending flush leaks into draft-2.
    expect(timestamp).toBeUndefined();
    expect(syncAgentSpec).toHaveBeenCalledOnce();
    expect(result.current.isSpecSyncing).toBe(false);
  });

  it('flushes pending work before a coordinated save', async () => {
    const syncAgentSpec = vi.fn().mockResolvedValue('2026-06-30T15:00:00.000Z');
    const draftBridge: DraftSessionBridge = {
      getDraftAgentSpec: vi.fn().mockResolvedValue(defaultAgentSpec),
      syncAgentSpec,
    };
    const { result } = renderHook(() =>
      useDraftAgentSpec({
        draftSessionId: 'draft-1',
        draftBridge,
        defaultAgentSpec,
      }),
    );
    await flushMicrotasks();

    act(() => {
      result.current.updateAgentSpec({ instructions: 'latest draft' });
    });
    await act(async () => {
      await result.current.flushAgentSpec();
    });

    expect(syncAgentSpec).toHaveBeenCalledWith('draft-1', {
      model: defaultAgentSpec.model,
      instructions: 'latest draft',
    });
  });

  it('adopts an atomically persisted spec without scheduling another sync', async () => {
    const syncAgentSpec = vi.fn().mockResolvedValue('unused');
    const draftBridge: DraftSessionBridge = {
      getDraftAgentSpec: vi.fn().mockResolvedValue(defaultAgentSpec),
      syncAgentSpec,
    };
    const { result } = renderHook(() =>
      useDraftAgentSpec({
        draftSessionId: 'draft-1',
        draftBridge,
        defaultAgentSpec,
      }),
    );
    await flushMicrotasks();

    act(() => {
      result.current.adoptAgentSpec({
        agentSpec: {
          model: { name: 'openai/gpt-5' },
          config: { generativeUi: { enabled: false } },
        },
        updatedAt: '2026-06-30T16:00:00.000Z',
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(result.current.agentSpec).toEqual({
      model: { name: 'openai/gpt-5' },
      config: { generativeUi: { enabled: false } },
    });
    expect(syncAgentSpec).not.toHaveBeenCalled();
    await expect(result.current.takeTurnHeaderTimestamp()).resolves.toBe('2026-06-30T16:00:00.000Z');
  });

  it('preserves the last sync timestamp when adopt omits updatedAt', async () => {
    const syncAgentSpec = vi.fn().mockResolvedValue('2026-06-30T17:00:00.000Z');
    const draftBridge: DraftSessionBridge = {
      getDraftAgentSpec: vi.fn().mockResolvedValue(defaultAgentSpec),
      syncAgentSpec,
    };
    const { result } = renderHook(() =>
      useDraftAgentSpec({
        draftSessionId: 'draft-1',
        draftBridge,
        defaultAgentSpec,
      }),
    );
    await flushMicrotasks();

    act(() => {
      result.current.updateAgentSpec({ instructions: 'synced' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await flushMicrotasks();
    expect(syncAgentSpec).toHaveBeenCalledOnce();

    act(() => {
      result.current.adoptAgentSpec({
        agentSpec: {
          model: { name: 'openai/gpt-5' },
        },
      });
    });

    await expect(result.current.takeTurnHeaderTimestamp()).resolves.toBe('2026-06-30T17:00:00.000Z');
  });

  it('falls back to defaultAgentSpec and does not error when getDraftAgentSpec resolves to null', async () => {
    const onError = vi.fn();
    const draftBridge: DraftSessionBridge = {
      getDraftAgentSpec: vi.fn().mockResolvedValue(null),
      syncAgentSpec: vi.fn().mockResolvedValue('2026-06-30T17:00:00.000Z'),
    };
    const { result } = renderHook(() =>
      useDraftAgentSpec({
        draftSessionId: 'session-no-spec',
        draftBridge,
        defaultAgentSpec,
        onError,
      }),
    );
    await flushMicrotasks();

    expect(draftBridge.getDraftAgentSpec).toHaveBeenCalledWith('session-no-spec');
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.agentSpec).toEqual(defaultAgentSpec);
    expect(result.current.specError).toBeNull();
    expect(result.current.isSpecLoading).toBe(false);
  });

  it('does not sync dirty edits if the loaded session returns null agentSpec', async () => {
    const syncAgentSpec = vi.fn().mockResolvedValue('2026-06-30T17:00:00.000Z');
    const draftBridge: DraftSessionBridge = {
      getDraftAgentSpec: vi.fn().mockResolvedValue(null),
      syncAgentSpec,
    };
    const initialProps: { draftSessionId: string | undefined } = { draftSessionId: undefined };
    const { result, rerender } = renderHook(
      ({ draftSessionId }) =>
        useDraftAgentSpec({
          draftSessionId,
          draftBridge,
          defaultAgentSpec,
        }),
      { initialProps },
    );
    await flushMicrotasks();

    // User makes a local edit in New Chat (draftSessionId is undefined)
    act(() => {
      result.current.updateAgentSpec({ instructions: 'local edit' });
    });

    // Chat navigates or attaches to a named/immutable session where getDraftAgentSpec returns null
    rerender({ draftSessionId: 'immutable-session-1' });
    await flushMicrotasks();

    expect(draftBridge.getDraftAgentSpec).toHaveBeenCalledWith('immutable-session-1');
    expect(syncAgentSpec).not.toHaveBeenCalled();
  });

  it('adopts a resumed session spec instead of PATCHing dirty New Chat edits onto it', async () => {
    const resumedSpec = {
      model: { name: 'openai/gpt-5-6-terra' },
      config: { sandbox: { enabled: true, environmentName: 'python-dev' } },
    };
    const syncAgentSpec = vi.fn().mockResolvedValue('2026-06-30T18:00:00.000Z');
    const draftBridge: DraftSessionBridge = {
      getDraftAgentSpec: vi.fn().mockResolvedValue(resumedSpec),
      syncAgentSpec,
    };
    const initialProps: { draftSessionId: string | undefined } = { draftSessionId: undefined };
    const { result, rerender } = renderHook(
      ({ draftSessionId }) =>
        useDraftAgentSpec({
          draftSessionId,
          draftBridge,
          defaultAgentSpec,
        }),
      { initialProps },
    );
    await flushMicrotasks();

    act(() => {
      result.current.updateAgentSpec({
        model: { name: 'openai/gpt-4.1' },
        config: { sandbox: { enabled: true } },
      });
    });

    rerender({ draftSessionId: 'existing-session-1' });
    await flushMicrotasks();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await flushMicrotasks();

    expect(draftBridge.getDraftAgentSpec).toHaveBeenCalledWith('existing-session-1');
    expect(result.current.agentSpec).toEqual(resumedSpec);
    expect(syncAgentSpec).not.toHaveBeenCalled();
  });

  it('does not PATCH New Chat seed while a resumed session spec is still loading', async () => {
    const resumedSpec = {
      model: { name: 'openai/gpt-5-6-terra' },
      config: { sandbox: { enabled: true, environmentName: 'python-dev' } },
    };
    let resolveLoad: ((spec: typeof resumedSpec) => void) | undefined;
    const syncAgentSpec = vi.fn().mockResolvedValue('2026-06-30T19:00:00.000Z');
    const draftBridge: DraftSessionBridge = {
      getDraftAgentSpec: vi.fn(
        () =>
          new Promise<typeof resumedSpec>(resolve => {
            resolveLoad = resolve;
          }),
      ),
      syncAgentSpec,
    };
    const initialProps: { draftSessionId: string | undefined } = { draftSessionId: undefined };
    const { result, rerender } = renderHook(
      ({ draftSessionId }) =>
        useDraftAgentSpec({
          draftSessionId,
          draftBridge,
          defaultAgentSpec,
        }),
      { initialProps },
    );
    await flushMicrotasks();

    act(() => {
      result.current.updateAgentSpec({
        config: { sandbox: { enabled: true }, webSearch: { enabled: true } },
      });
    });

    // sameMutable history switch: draftSessionId appears before getDraftAgentSpec resolves.
    rerender({ draftSessionId: 'existing-session-2' });
    await flushMicrotasks();
    expect(result.current.isSpecLoading).toBe(true);

    // Preference bridges call updateAgentSpec while the New Chat seed is still mounted.
    act(() => {
      result.current.updateAgentSpec({
        mcpServers: [],
        skills: [],
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await flushMicrotasks();
    expect(syncAgentSpec).not.toHaveBeenCalled();

    await act(async () => {
      resolveLoad?.(resumedSpec);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await flushMicrotasks();

    expect(result.current.agentSpec).toEqual(resumedSpec);
    expect(syncAgentSpec).not.toHaveBeenCalled();
  });
});
