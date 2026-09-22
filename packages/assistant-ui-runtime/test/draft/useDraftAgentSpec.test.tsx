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
});
