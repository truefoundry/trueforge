// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAuiState = vi.hoisted(() => vi.fn());
const useToolResponses = vi.hoisted(() => vi.fn());

vi.mock('@assistant-ui/react', () => ({
  useAuiState,
}));

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryToolResponses: useToolResponses,
}));

import { threadHasPendingMcpAuth, type ThreadPauseState, useComposerPauseView } from '@/hooks/useComposerPauseView.js';

describe('threadHasPendingMcpAuth', () => {
  it('recognizes MCP authorization only on the latest requiring-action assistant message', () => {
    const pendingState = {
      thread: {
        messages: [
          { role: 'user' },
          {
            role: 'assistant',
            status: { type: 'requires-action' },
            metadata: { custom: { pendingMcpAuth: true } },
          },
        ],
      },
    } satisfies ThreadPauseState;

    expect(threadHasPendingMcpAuth(pendingState)).toBe(true);
    expect(
      threadHasPendingMcpAuth({
        thread: {
          messages: [...pendingState.thread.messages, { role: 'user' }],
        },
      }),
    ).toBe(false);
  });

  it('rejects assistant messages without both the required status and metadata flag', () => {
    expect(
      threadHasPendingMcpAuth({
        thread: {
          messages: [
            {
              role: 'assistant',
              status: { type: 'running' },
              metadata: { custom: { pendingMcpAuth: true } },
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      threadHasPendingMcpAuth({
        thread: {
          messages: [
            {
              role: 'assistant',
              status: { type: 'requires-action' },
              metadata: { custom: { pendingMcpAuth: false } },
            },
          ],
        },
      }),
    ).toBe(false);
    expect(threadHasPendingMcpAuth({ thread: { messages: [] } })).toBe(false);
  });
});

describe('useComposerPauseView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuiState.mockReturnValue(false);
    useToolResponses.mockReturnValue({ pending: [] });
  });

  it('returns the normal composer when no pause source is pending', () => {
    const { result } = renderHook(() => useComposerPauseView());

    expect(result.current).toEqual({ kind: 'compose' });
    expect(useAuiState).toHaveBeenCalledWith(threadHasPendingMcpAuth);
  });

  it('shows the ask-user view while tool responses are pending', () => {
    useToolResponses.mockReturnValue({ pending: [{ toolCallId: 'question-1' }] });

    const { result } = renderHook(() => useComposerPauseView());

    expect(result.current).toEqual({ kind: 'ask-user' });
  });

  it('gives MCP authorization precedence over pending tool responses', () => {
    useAuiState.mockReturnValue(true);
    useToolResponses.mockReturnValue({ pending: [{ toolCallId: 'question-1' }] });

    const { result } = renderHook(() => useComposerPauseView());

    expect(result.current).toEqual({ kind: 'mcp' });
  });
});
