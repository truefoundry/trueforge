// @vitest-environment jsdom
import { onlineManager } from '@tanstack/react-query';
import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useServerQueryClient } from '@/server/queryClient.js';
import { ServerProvider, useOptionalRefreshServerCapabilities, useServerCapabilities } from '@/server/ServerContext.js';
import type { AgentBuilderCapabilitiesResponse } from '@/server/types.js';

import { createMockAgentUIServer } from './mockServer.js';

function capabilitiesResponse(settingsEnabled: boolean): AgentBuilderCapabilitiesResponse {
  return {
    data: { sandbox: { enabled: true }, skill: { enabled: true }, settings: { enabled: settingsEnabled } },
  };
}

function CapabilitiesProbe() {
  const capabilities = useServerCapabilities();
  return <output>{capabilities == null ? 'pending' : String(capabilities.settings?.enabled)}</output>;
}

function RefreshProbe() {
  const refresh = useOptionalRefreshServerCapabilities();
  return (
    <button type="button" onClick={() => refresh?.()}>
      refresh
    </button>
  );
}

describe('ServerProvider query cache', () => {
  it('resumes a request paused while the browser was offline', async () => {
    const getCapabilities = vi.fn(async () => capabilitiesResponse(true));
    onlineManager.setOnline(false);
    try {
      render(
        <ServerProvider server={createMockAgentUIServer({ getCapabilities })}>
          <CapabilitiesProbe />
        </ServerProvider>,
      );
      expect(screen.getByText('pending')).toBeTruthy();
      expect(getCapabilities).not.toHaveBeenCalled();

      act(() => onlineManager.setOnline(true));

      await screen.findByText('true');
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('keeps one isolated client per consumer outside ServerProvider', () => {
    const { result, rerender } = renderHook(() => useServerQueryClient());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('does not reuse the previous server cache after a server swap', async () => {
    const firstCapabilities = vi.fn(async () => capabilitiesResponse(true));
    const secondCapabilities = vi.fn(async () => capabilitiesResponse(false));
    const { rerender } = render(
      <ServerProvider server={createMockAgentUIServer({ getCapabilities: firstCapabilities })}>
        <CapabilitiesProbe />
      </ServerProvider>,
    );
    await screen.findByText('true');

    rerender(
      <ServerProvider server={createMockAgentUIServer({ getCapabilities: secondCapabilities })}>
        <CapabilitiesProbe />
      </ServerProvider>,
    );

    await screen.findByText('false');
    expect(firstCapabilities).toHaveBeenCalledTimes(1);
    expect(secondCapabilities).toHaveBeenCalledTimes(1);
  });

  it('starts a new capabilities request when refresh runs during the first load', async () => {
    let resolveFirst!: (value: AgentBuilderCapabilitiesResponse) => void;
    const firstPending = new Promise<AgentBuilderCapabilitiesResponse>(resolve => {
      resolveFirst = resolve;
    });
    const getCapabilities = vi
      .fn()
      .mockImplementationOnce(() => firstPending)
      .mockImplementationOnce(async () => capabilitiesResponse(false));

    render(
      <ServerProvider server={createMockAgentUIServer({ getCapabilities })}>
        <CapabilitiesProbe />
        <RefreshProbe />
      </ServerProvider>,
    );

    expect(screen.getByText('pending')).toBeTruthy();
    expect(getCapabilities).toHaveBeenCalledTimes(1);

    act(() => {
      screen.getByRole('button', { name: 'refresh' }).click();
    });

    await act(async () => {
      resolveFirst(capabilitiesResponse(true));
      await Promise.resolve();
    });

    await screen.findByText('false');
    expect(getCapabilities).toHaveBeenCalledTimes(2);
  });
});
